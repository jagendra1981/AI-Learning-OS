import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Inject,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import {
  AttachmentPurpose,
  AttachmentRecord,
  C033_LIMITS,
  LearnerAttachment,
} from './attachment.types';
import {
  createObjectKey,
  PrivateObjectAdapter,
  SafeStorageStub,
} from './private-object.adapter';
import {
  normalizeFilename,
  validateDeclaredMime,
  validateSize,
  checksum,
} from './attachment.validator';
import { inspectAndSanitize } from './image.processor';

@Injectable()
export class AttachmentService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(SafeStorageStub) private readonly storage: PrivateObjectAdapter,
  ) {}
  private fingerprint(
    owner: string,
    input: {
      purpose: AttachmentPurpose;
      originalFilename: string;
      declaredMimeType: string;
      sizeBytes: number;
      idempotencyKey: string;
    },
  ) {
    return createHash('sha256')
      .update(
        [
          owner,
          input.purpose,
          normalizeFilename(input.originalFilename),
          input.declaredMimeType,
          String(C033_LIMITS.maxBytes),
          input.idempotencyKey,
        ].join('|'),
      )
      .digest('hex');
  }
  async prepareUpload(
    ownerLearnerId: string,
    actorId: string,
    input: {
      purpose: AttachmentPurpose;
      originalFilename: string;
      declaredMimeType: string;
      sizeBytes: number;
      idempotencyKey: string;
      sessionId?: string;
      interactionId?: string;
    },
  ) {
    validateDeclaredMime(input.declaredMimeType);
    validateSize(input.sizeBytes);
    if (
      !input.idempotencyKey ||
      !/^[\x21-\x7e]{1,128}$/.test(input.idempotencyKey)
    )
      throw new Error('FILE_INVALID');
    const normalizedFilename = normalizeFilename(input.originalFilename);
    const fp = this.fingerprint(ownerLearnerId, input);
    const existing = await this.db.attachment.findUnique({
      where: {
        ownerLearnerId_idempotencyKey: {
          ownerLearnerId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing && existing.requestFingerprint !== fp)
      throw new ConflictException({
        code: 'FILE_IDEMPOTENCY_CONFLICT',
        message: 'This upload request conflicts with an earlier request.',
      });
    const attachmentId = existing?.attachmentId ?? randomUUID();
    const now = new Date();
    const objectKey =
      existing?.objectKey ?? createObjectKey(ownerLearnerId, attachmentId);
    let record = existing;
    if (!record) {
      try {
        record = await this.db.attachment.create({
          data: {
            attachmentId,
            ownerLearnerId,
            createdByActorId: actorId,
            purpose: input.purpose,
            objectKey,
            originalFilename: normalizedFilename,
            declaredMimeType: input.declaredMimeType,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fp,
            sessionId: input.sessionId,
            interactionId: input.interactionId,
            sizeBytes: input.sizeBytes,
            status: 'PENDING_UPLOAD',
          },
        });
      } catch (error: unknown) {
        const prismaError = error as { code?: string };
        if (prismaError.code !== 'P2002') throw error;
        record = await this.db.attachment.findUnique({
          where: {
            ownerLearnerId_idempotencyKey: {
              ownerLearnerId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (!record) throw error;
        if (record.requestFingerprint !== fp)
          throw new ConflictException({
            code: 'FILE_IDEMPOTENCY_CONFLICT',
            message: 'This upload request conflicts with an earlier request.',
          });
      }
    }
    const upload = await this.storage.prepareUpload({
      objectKey: record.objectKey,
      contentType: record.declaredMimeType,
      maxBytes: C033_LIMITS.maxBytes,
      expiresAt: new Date(now.getTime() + C033_LIMITS.uploadTtlSeconds * 1000),
    });
    return {
      attachmentId: record.attachmentId,
      uploadUrl: upload.url,
      method: upload.method,
      expiresAt: upload.expiresAt,
      requiredHeaders: upload.requiredHeaders,
      idempotencyFingerprint: fp,
    };
  }
  private async owned(owner: string, id: string) {
    const r = await this.db.attachment.findUnique({
      where: { attachmentId: id },
    });
    if (!r)
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: 'Attachment not found.',
      });
    if (r.ownerLearnerId !== owner)
      throw new ForbiddenException({
        code: 'FILE_ACCESS_DENIED',
        message: 'Attachment access denied.',
      });
    return r;
  }
  async complete(owner: string, id: string): Promise<LearnerAttachment> {
    const r = await this.owned(owner, id);
    if (r.status === 'AVAILABLE')
      return this.safe(r as unknown as AttachmentRecord);
    if (r.status !== 'PENDING_UPLOAD') throw new Error('FILE_NOT_READY');
    const head = await this.storage.headObject(r.objectKey);
    if (!head) throw new Error('FILE_NOT_READY');
    const claimed = await this.db.attachment.updateMany({
      where: { attachmentId: id, status: 'PENDING_UPLOAD' },
      data: { status: 'VALIDATING' },
    });
    if (claimed.count !== 1) return this.complete(owner, id);
    try {
      if (head.sizeBytes > C033_LIMITS.maxBytes)
        throw new Error('FILE_TOO_LARGE');
      if (head.sizeBytes !== r.sizeBytes)
        throw new Error('FILE_SIZE_MISMATCH');
      if (head.contentType && head.contentType !== r.declaredMimeType)
        throw new Error('FILE_TYPE_MISMATCH');
      const bytes = await this.storage.readPrefix(
        r.objectKey,
        C033_LIMITS.maxBytes,
      );
      const sanitized = await inspectAndSanitize(bytes, r.declaredMimeType);
      const updated = await this.db.attachment.update({
        where: { attachmentId: id },
        data: {
          status: 'AVAILABLE',
          detectedMimeType: r.declaredMimeType,
          sizeBytes: head.sizeBytes,
          sha256: checksum(bytes),
          width: sanitized.width,
          height: sanitized.height,
          validatedAt: new Date(),
        },
      });
      return this.safe(updated as unknown as AttachmentRecord);
    } catch (error) {
      await this.db.attachment.update({
        where: { attachmentId: id },
        data: { status: 'REJECTED' },
      });
      await this.storage.deleteObject(r.objectKey);
      throw error;
    }
  }
  async read(owner: string, id: string): Promise<LearnerAttachment> {
    return this.safe(
      (await this.owned(owner, id)) as unknown as AttachmentRecord,
    );
  }
  async signedRead(owner: string, id: string) {
    const r = await this.owned(owner, id);
    if (r.status !== 'AVAILABLE') throw new Error('FILE_NOT_READY');
    return this.storage.createSignedRead({
      objectKey: r.objectKey,
      expiresAt: new Date(Date.now() + C033_LIMITS.readTtlSeconds * 1000),
    });
  }
  async consumeForTutor(
    owner: string,
    id: string,
    purpose: AttachmentPurpose,
    assessmentAllows = true,
    sessionId?: string,
    interactionId?: string,
  ) {
    const r = await this.owned(owner, id);
    if (
      !assessmentAllows ||
      r.status !== 'AVAILABLE' ||
      r.purpose !== purpose ||
      !r.sessionId ||
      !r.interactionId ||
      r.sessionId !== sessionId ||
      r.interactionId !== interactionId
    )
      throw new ForbiddenException({
        code: 'FILE_ACCESS_DENIED',
        message: 'Attachment is not available for Tutor use.',
      });
    const bytes = await this.storage.readPrefix(
      r.objectKey,
      C033_LIMITS.maxBytes,
    );
    const normalized = await inspectAndSanitize(bytes, r.declaredMimeType);
    return {
      attachmentId: r.attachmentId,
      purpose: r.purpose,
      mimeType: `image/${normalized.format}`,
      width: normalized.width,
      height: normalized.height,
      bytes: normalized.bytes,
    };
  }
  async bindForTutor(
    owner: string,
    id: string,
    sessionId: string,
    interactionId: string,
  ) {
    if (!sessionId || !interactionId)
      throw new ForbiddenException({
        code: 'FILE_ACCESS_DENIED',
        message: 'Attachment context is required.',
      });
    const r = await this.owned(owner, id);
    if (
      r.sessionId &&
      r.interactionId &&
      (r.sessionId !== sessionId || r.interactionId !== interactionId)
    )
      throw new ForbiddenException({
        code: 'FILE_ACCESS_DENIED',
        message: 'Attachment context is not authorized.',
      });
    if (!r.sessionId && !r.interactionId) {
      await this.db.attachment.updateMany({
        where: {
          attachmentId: id,
          ownerLearnerId: owner,
          sessionId: null,
          interactionId: null,
        },
        data: { sessionId, interactionId },
      });
    }
    const bound = await this.owned(owner, id);
    if (bound.sessionId !== sessionId || bound.interactionId !== interactionId)
      throw new ForbiddenException({
        code: 'FILE_ACCESS_DENIED',
        message: 'Attachment context is not authorized.',
      });
    return bound;
  }
  async delete(owner: string, id: string) {
    const r = await this.owned(owner, id);
    if (r.status === 'DELETED') return;
    await this.storage.deleteObject(r.objectKey);
    await this.db.attachment.updateMany({
      where: {
        attachmentId: id,
        ownerLearnerId: owner,
        status: { not: 'DELETED' },
      },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
  }
  async expirePending(now = new Date()) {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const rows = await this.db.attachment.findMany({
      where: { status: 'PENDING_UPLOAD', createdAt: { lt: cutoff } },
      select: { attachmentId: true, objectKey: true },
    });
    let expired = 0;
    for (const row of rows) {
      const result = await this.db.attachment.updateMany({
        where: { attachmentId: row.attachmentId, status: 'PENDING_UPLOAD' },
        data: { status: 'EXPIRED' },
      });
      if (result.count === 1) {
        expired++;
        try {
          await this.storage.deleteObject(row.objectKey);
        } catch {
          /* best effort cleanup */
        }
      }
    }
    return expired;
  }
  private safe(r: AttachmentRecord): LearnerAttachment {
    const rest = { ...r } as Record<string, unknown>;
    delete rest.objectKey;
    delete rest.sha256;
    delete rest.sessionId;
    delete rest.interactionId;
    return {
      ...rest,
      safeDisplayName: r.originalFilename,
    } as LearnerAttachment;
  }
}
