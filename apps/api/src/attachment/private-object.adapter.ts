import { randomBytes } from 'node:crypto';

export type PreparedUpload = {
  url: string;
  method: 'PUT';
  expiresAt: Date;
  requiredHeaders: Record<string, string>;
};

export type ObjectHead = {
  sizeBytes: number;
  contentType?: string;
  etag?: string;
};

export interface PrivateObjectAdapter {
  prepareUpload(input: {
    objectKey: string;
    contentType: string;
    maxBytes: number;
    expiresAt: Date;
  }): Promise<PreparedUpload>;
  headObject(objectKey: string): Promise<ObjectHead | null>;
  readPrefix(objectKey: string, maxBytes: number): Promise<Buffer>;
  createSignedRead(input: {
    objectKey: string;
    expiresAt: Date;
  }): Promise<{ url: string; expiresAt: Date }>;
  deleteObject(objectKey: string): Promise<void>;
}

export class SafeStorageStub implements PrivateObjectAdapter {
  private readonly objects = new Map<
    string,
    { bytes: Buffer; contentType: string }
  >();
  private readonly uploadTokens = new Map<
    string,
    {
      objectKey: string;
      contentType: string;
      maxBytes: number;
      expiresAt: Date;
    }
  >();
  put(objectKey: string, bytes: Buffer, contentType: string) {
    this.objects.set(objectKey, { bytes, contentType });
  }
  async prepareUpload(input: {
    objectKey: string;
    contentType: string;
    maxBytes: number;
    expiresAt: Date;
  }): Promise<PreparedUpload> {
    const token = randomBytes(24).toString('base64url');
    this.uploadTokens.set(token, {
      objectKey: input.objectKey,
      contentType: input.contentType,
      maxBytes: input.maxBytes,
      expiresAt: input.expiresAt,
    });
    return {
      url: `http://localhost:${process.env.API_PORT ?? 3001}/api/v1/attachments/local-upload/${token}`,
      method: 'PUT',
      expiresAt: input.expiresAt,
      requiredHeaders: { 'content-type': input.contentType },
    };
  }
  async upload(token: string, bytes: Buffer, contentType: string) {
    const target = this.uploadTokens.get(token);
    if (!target || target.expiresAt.getTime() < Date.now())
      throw new Error('UPLOAD_TARGET_INVALID');
    if (bytes.length > target.maxBytes || contentType !== target.contentType)
      throw new Error('UPLOAD_VALIDATION_FAILED');
    this.objects.set(target.objectKey, {
      bytes: Buffer.from(bytes),
      contentType,
    });
    this.uploadTokens.delete(token);
  }
  async headObject(objectKey: string) {
    const o = this.objects.get(objectKey);
    return o ? { sizeBytes: o.bytes.length, contentType: o.contentType } : null;
  }
  async readPrefix(objectKey: string, maxBytes: number) {
    return (this.objects.get(objectKey)?.bytes ?? Buffer.alloc(0)).subarray(
      0,
      maxBytes,
    );
  }
  async createSignedRead(input: { objectKey: string; expiresAt: Date }) {
    return {
      url: `safe-storage://read/${encodeURIComponent(input.objectKey)}`,
      expiresAt: input.expiresAt,
    };
  }
  async deleteObject(objectKey: string) {
    this.objects.delete(objectKey);
  }
}

export const createObjectKey = (learnerId: string, attachmentId: string) =>
  `c033/${learnerId}/${attachmentId}/${randomBytes(16).toString('hex')}`;
