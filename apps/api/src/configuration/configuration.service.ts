import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ConfigurationCache } from './configuration.cache';
import {
  configError,
  forbiddenConfig,
  unknownConfig,
} from './configuration.errors';

type Input = {
  examId: string;
  subjectId: string;
  reason: string;
  correlationId?: string;
};
@Injectable()
export class ConfigurationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: ConfigurationCache,
  ) {}
  private async authorize(
    userId: string,
    scopeKey: string,
    action: 'WRITE' | 'APPROVE' | 'PUBLISH' | 'ROLLBACK',
  ) {
    const roles = await this.db.userRole.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { role: true, scope: true },
    });
    const allowed =
      action === 'WRITE'
        ? ['CONTENT_REVIEWER', 'ACADEMIC_ADMIN', 'PLATFORM_ADMIN']
        : action === 'APPROVE'
          ? ['CONTENT_REVIEWER', 'ACADEMIC_ADMIN', 'PLATFORM_ADMIN']
          : ['ACADEMIC_ADMIN', 'PLATFORM_ADMIN'];
    if (
      !roles.some(
        (r) =>
          allowed.includes(r.role) &&
          (!r.scope || JSON.stringify(r.scope).includes(scopeKey)),
      )
    )
      forbiddenConfig();
    if (action === 'APPROVE' && roles.some((r) => r.role === 'STUDENT'))
      forbiddenConfig();
  }
  private async audit(
    actorUserId: string,
    action: string,
    resourceId: string,
    metadata: object,
    subjectUserId = actorUserId,
  ) {
    return this.db.auditEvent.create({
      data: {
        actorUserId,
        subjectUserId,
        action,
        resourceType: 'ConfigurationVersion',
        resourceId,
        metadata,
      },
    });
  }
  private async setFor(input: Input) {
    const scopeKey = `${input.examId}:${input.subjectId}`;
    return this.db.configurationSet.upsert({
      where: { scopeKey },
      create: { scopeKey, examId: input.examId, subjectId: input.subjectId },
      update: {},
    });
  }
  async createDraft(userId: string, input: Input) {
    const set = await this.setFor(input);
    await this.authorize(userId, set.scopeKey, 'WRITE');
    const latest = await this.db.configurationVersion.findFirst({
      where: { configurationSetId: set.configurationSetId },
      orderBy: { versionNumber: 'desc' },
    });
    const v = await this.db.configurationVersion.create({
      data: {
        configurationSetId: set.configurationSetId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        createdByUserId: userId,
        reason: input.reason,
      },
    });
    await this.audit(
      userId,
      'CONFIGURATION_DRAFT_CREATED',
      v.configurationVersionId,
      { scopeKey: set.scopeKey, reason: input.reason },
    );
    return v;
  }
  private async version(userId: string, id: string) {
    const v = await this.db.configurationVersion.findUnique({
      where: { configurationVersionId: id },
      include: { configurationSet: true, changes: true, approvals: true },
    });
    if (!v) unknownConfig();
    await this.authorize(userId, v!.configurationSet.scopeKey, 'WRITE');
    return v!;
  }
  async upsertChange(
    userId: string,
    versionId: string,
    changeKey: string,
    afterValue: unknown,
    reason: string,
    beforeValue?: unknown,
  ) {
    const v = await this.version(userId, versionId);
    if (v.status !== 'DRAFT')
      configError(
        'PUBLISHED_VERSION_IMMUTABLE',
        'Only draft versions can be edited.',
      );
    const c = await this.db.configurationChange.upsert({
      where: {
        configurationVersionId_changeKey: {
          configurationVersionId: versionId,
          changeKey,
        },
      },
      create: {
        configurationVersionId: versionId,
        changeKey,
        afterValue: afterValue as object,
        beforeValue: beforeValue as object,
        actorUserId: userId,
        reason,
      },
      update: { afterValue: afterValue as object, actorUserId: userId, reason },
    });
    await this.audit(userId, 'CONFIGURATION_CHANGED', versionId, {
      changeKey,
      beforeValue,
      afterValue,
      reason,
    });
    return c;
  }
  async submit(userId: string, id: string) {
    const v = await this.version(userId, id);
    if (v.status !== 'DRAFT' || !v.changes.length)
      configError('INVALID_STATE_TRANSITION', 'A non-empty draft is required.');
    return this.db.configurationVersion.update({
      where: { configurationVersionId: id },
      data: { status: 'APPROVED' },
    });
  }
  async decide(
    userId: string,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string,
    correlationId: string,
  ) {
    const v = await this.version(userId, id);
    await this.authorize(userId, v.configurationSet.scopeKey, 'APPROVE');
    if (v.status !== 'APPROVED')
      configError(
        'INVALID_STATE_TRANSITION',
        'Version is not awaiting approval.',
      );
    if (v.createdByUserId === userId) forbiddenConfig();
    await this.db.configurationApproval.create({
      data: {
        configurationVersionId: id,
        actorUserId: userId,
        decision,
        reason,
        correlationId,
      },
    });
    if (decision === 'REJECTED')
      return this.db.configurationVersion.update({
        where: { configurationVersionId: id },
        data: { status: 'DRAFT' },
      });
    return v;
  }
  async publish(
    userId: string,
    id: string,
    reason: string,
    correlationId: string,
  ) {
    const v = await this.version(userId, id);
    await this.authorize(userId, v.configurationSet.scopeKey, 'PUBLISH');
    if (v.status !== 'APPROVED')
      configError(
        'INVALID_STATE_TRANSITION',
        'Only approved versions may be published.',
      );
    if (!v.approvals.some((a) => a.decision === 'APPROVED'))
      configError('APPROVAL_REQUIRED', 'An approval is required.');
    const current = await this.db.configurationVersion.findFirst({
      where: { configurationSetId: v.configurationSetId, status: 'PUBLISHED' },
    });
    const result = await this.db.$transaction(async (tx) => {
      if (current)
        await tx.configurationVersion.update({
          where: { configurationVersionId: current.configurationVersionId },
          data: { status: 'SUPERSEDED' },
        });
      const published = await tx.configurationVersion.update({
        where: { configurationVersionId: id },
        data: { status: 'PUBLISHED' },
      });
      await tx.configurationPublication.create({
        data: {
          configurationVersionId: id,
          actorUserId: userId,
          previousVersionId: current?.configurationVersionId,
          reason,
          correlationId,
        },
      });
      return published;
    });
    this.cache.invalidate(v.configurationSet.scopeKey);
    await this.audit(userId, 'CONFIGURATION_PUBLISHED', id, {
      beforeVersionId: current?.configurationVersionId,
      afterVersionId: id,
      reason,
      correlationId,
    });
    return result;
  }
  async current(userId: string, examId: string, subjectId: string) {
    const set = await this.setFor({ examId, subjectId, reason: 'read' });
    const v = await this.db.configurationVersion.findFirst({
      where: {
        configurationSetId: set.configurationSetId,
        status: 'PUBLISHED',
      },
      include: { changes: true },
    });
    if (!v) unknownConfig();
    return v;
  }
  async byId(userId: string, id: string) {
    const v = await this.version(userId, id);
    return v;
  }

  async reviewDetail(userId: string, id: string) {
    const v = await this.version(userId, id);
    return {
      configurationVersionId: v.configurationVersionId,
      versionNumber: v.versionNumber,
      status: v.status,
      createdAt: v.createdAt,
      context: {
        examId: v.configurationSet.examId,
        subjectId: v.configurationSet.subjectId,
      },
      changeCount: v.changes.length,
    };
  }
  async rollback(
    userId: string,
    targetId: string,
    reason: string,
    correlationId: string,
  ) {
    const target = await this.byId(userId, targetId);
    if (!['PUBLISHED', 'SUPERSEDED'].includes(target.status))
      configError(
        'INVALID_ROLLBACK_TARGET',
        'Rollback target is not a valid historical version.',
      );
    const current = await this.current(
      userId,
      target.configurationSet.examId,
      target.configurationSet.subjectId,
    );
    const draft = await this.createDraft(userId, {
      examId: target.configurationSet.examId,
      subjectId: target.configurationSet.subjectId,
      reason,
    });
    for (const c of target.changes)
      await this.upsertChange(
        userId,
        draft.configurationVersionId,
        c.changeKey,
        c.afterValue,
        reason,
        c.beforeValue,
      );
    await this.submit(userId, draft.configurationVersionId);
    await this.decide(
      userId,
      draft.configurationVersionId,
      'APPROVED',
      reason,
      correlationId,
    );
    const published = await this.publish(
      userId,
      draft.configurationVersionId,
      reason,
      correlationId,
    );
    await this.db.configurationRollback.create({
      data: {
        sourceVersionId: current!.configurationVersionId,
        targetVersionId: targetId,
        actorUserId: userId,
        reason,
        correlationId,
      },
    });
    return published;
  }
}
