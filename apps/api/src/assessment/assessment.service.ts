import { Injectable } from '@nestjs/common';
import {
  Prisma,
  AssessmentSessionState,
  AssessmentTemplateStatus,
} from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { DOMAIN_METRICS, metrics } from '../observability/metrics';
import {
  assessmentConcurrency,
  assessmentForbidden,
  assessmentInvalid,
  assessmentNotFound,
  assessmentStateConflict,
} from './assessment.errors';

export type AssessmentTemplateInput = {
  canonicalId: string;
  versionNumber: number;
  title: string;
  assessmentType: string;
  syllabusVersionId: string;
  examId: string;
  subjectId: string;
  durationSeconds: number;
  structure: Prisma.InputJsonValue;
  configurationReference?: string;
  status?: AssessmentTemplateStatus;
};

@Injectable()
export class AssessmentService {
  constructor(private readonly db: DatabaseService) {}

  async createTemplate(actorUserId: string, input: AssessmentTemplateInput) {
    if (
      !actorUserId ||
      !input.canonicalId ||
      !input.title ||
      !input.assessmentType ||
      !Number.isInteger(input.versionNumber) ||
      input.versionNumber < 1 ||
      !Number.isInteger(input.durationSeconds) ||
      input.durationSeconds <= 0 ||
      !input.structure ||
      typeof input.structure !== 'object'
    )
      assessmentInvalid('Template metadata is invalid.');
    const syllabus = await this.db.syllabusVersion.findUnique({
      where: { canonicalId: input.syllabusVersionId },
    });
    if (
      !syllabus ||
      syllabus.examId !== input.examId ||
      syllabus.subjectId !== input.subjectId ||
      syllabus.status !== 'ACTIVE'
    )
      assessmentInvalid('Template academic version is invalid.');
    return this.db.assessmentTemplate.create({
      data: {
        ...input,
        createdByUserId: actorUserId,
        status: input.status ?? 'DRAFT',
      },
    });
  }

  async createSession(ownerUserId: string, assessmentTemplateId: string) {
    const template = await this.db.assessmentTemplate.findUnique({
      where: { assessmentTemplateId },
    });
    if (!template || template.status !== 'PUBLISHED') assessmentNotFound();
    const session = await this.db.assessmentSession.create({
      data: {
        ownerUserId,
        assessmentTemplateId,
        syllabusVersionId: template!.syllabusVersionId,
      },
    });
    await this.audit(
      ownerUserId,
      ownerUserId,
      'ASSESSMENT_SESSION_CREATED',
      session.assessmentSessionId,
      {
        templateId: assessmentTemplateId,
        templateVersion: template!.versionNumber,
      },
    );
    return session;
  }

  async getSession(ownerUserId: string, assessmentSessionId: string) {
    const session = await this.db.assessmentSession.findUnique({
      where: { assessmentSessionId },
      include: { template: true, placements: { orderBy: { ordinal: 'asc' } } },
    });
    if (!session) assessmentNotFound();
    if (session!.ownerUserId !== ownerUserId) assessmentForbidden();
    if (
      session!.state === 'ACTIVE' &&
      session!.expiresAt &&
      session!.expiresAt <= new Date()
    )
      return this.expire(
        ownerUserId,
        assessmentSessionId,
        session!.lockVersion,
      );
    return session;
  }

  async placeQuestion(
    ownerUserId: string,
    assessmentSessionId: string,
    input: {
      questionVersionId: string;
      ordinal: number;
      attemptNumber?: number;
      retryOfPlacementId?: string;
      section?: string;
      placementMetadata?: Prisma.InputJsonValue;
      selectionReference?: string;
    },
    transactionClient?: Prisma.TransactionClient,
  ) {
    if (!Number.isInteger(input.ordinal) || input.ordinal < 0)
      assessmentInvalid('Placement ordinal is invalid.');
    const operation = async (tx: Prisma.TransactionClient) => {
      const session = await tx.assessmentSession.findUnique({
        where: { assessmentSessionId },
        include: { template: true },
      });
      if (!session) assessmentNotFound();
      if (session!.ownerUserId !== ownerUserId) assessmentForbidden();
      if (session!.state !== 'READY' && session!.state !== 'ACTIVE')
        assessmentStateConflict(
          'Questions can only be placed in an active assessment.',
        );
      const q = await tx.questionVersion.findFirst({
        where: {
          questionVersionId: input.questionVersionId,
          status: 'PUBLISHED',
          question: {
            examId: session!.template.examId,
            subjectId: session!.template.subjectId,
          },
          syllabusNode: {
            versionMemberships: {
              some: { versionId: session!.syllabusVersionId },
            },
          },
          rights: { rightsStatus: 'VERIFIED' },
          provenance: {
            verificationStatus: { in: ['verified', 'VERIFIED'] },
          },
        },
      });
      if (!q)
        assessmentInvalid(
          'Question version is not published or eligible for this session.',
        );
      const result = await tx.assessmentSessionPlacement.create({
        data: {
          assessmentSessionId,
          questionVersionId: input.questionVersionId,
          ordinal: input.ordinal,
          attemptNumber: input.attemptNumber ?? 1,
          retryOfPlacementId: input.retryOfPlacementId,
          section: input.section,
          placementMetadata: input.placementMetadata,
          selectionReference: input.selectionReference,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: ownerUserId,
          subjectUserId: ownerUserId,
          action: 'ASSESSMENT_QUESTION_PLACEMENT_COMMITTED',
          resourceType: 'ASSESSMENT_SESSION',
          resourceId: assessmentSessionId,
          metadata: {
            ordinal: input.ordinal,
            questionVersionId: input.questionVersionId,
          },
        },
      });
      return result;
    };
    return (
      transactionClient
        ? operation(transactionClient)
        : this.db.$transaction(operation)
    ).catch((error: unknown) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        assessmentConcurrency();
      throw error;
    });
  }

  async start(
    ownerUserId: string,
    assessmentSessionId: string,
    transactionClient?: Prisma.TransactionClient,
  ) {
    return this.transitionWithMetric(ownerUserId, assessmentSessionId, 'READY', 'ACTIVE', transactionClient);
  }
  async complete(
    ownerUserId: string,
    assessmentSessionId: string,
    transactionClient?: Prisma.TransactionClient,
  ) {
    return this.transitionWithMetric(ownerUserId, assessmentSessionId, 'ACTIVE', 'COMPLETED', transactionClient);
  }

  private async transitionWithMetric(
    ownerUserId: string,
    id: string,
    from: AssessmentSessionState,
    to: AssessmentSessionState,
    transactionClient?: Prisma.TransactionClient,
  ) {
    try {
      return await this.transition(ownerUserId, id, from, to, transactionClient);
    } catch (error) {
      metrics.increment(DOMAIN_METRICS.assessmentSessions, {
        outcome: error instanceof Prisma.PrismaClientKnownRequestError ? 'processing_error' : 'failed',
      });
      throw error;
    }
  }
  async expire(
    ownerUserId: string,
    assessmentSessionId: string,
    expectedVersion?: number,
  ) {
    const now = new Date();
    const result = await this.db.assessmentSession.updateMany({
      where: {
        assessmentSessionId,
        ownerUserId,
        state: 'ACTIVE',
        expiresAt: { lte: now },
        ...(expectedVersion === undefined
          ? {}
          : { lockVersion: expectedVersion }),
      },
      data: { state: 'EXPIRED', endedAt: now, lockVersion: { increment: 1 } },
    });
    if (result.count === 0) {
      const current = await this.db.assessmentSession.findUnique({
        where: { assessmentSessionId },
      });
      if (!current) assessmentNotFound();
      if (current!.ownerUserId !== ownerUserId) assessmentForbidden();
      return current;
    }
    await this.audit(
      ownerUserId,
      ownerUserId,
      'ASSESSMENT_SESSION_EXPIRED',
      assessmentSessionId,
      { state: 'ACTIVE', nextState: 'EXPIRED' },
    );
    return this.db.assessmentSession.findUnique({
      where: { assessmentSessionId },
    });
  }

  private async transition(
    ownerUserId: string,
    id: string,
    from: AssessmentSessionState,
    to: AssessmentSessionState,
    transactionClient?: Prisma.TransactionClient,
  ) {
    const db = transactionClient ?? this.db;
    const now = new Date();
    const current = await db.assessmentSession.findUnique({
      where: { assessmentSessionId: id },
      include: { template: true },
    });
    if (!current) assessmentNotFound();
    if (current!.ownerUserId !== ownerUserId) assessmentForbidden();
    if (from === 'ACTIVE' && current!.expiresAt && current!.expiresAt <= now) {
      await this.expire(ownerUserId, id, current!.lockVersion);
      assessmentStateConflict('Assessment session has expired.');
    }
    if (current!.state !== from) assessmentStateConflict();
    const data =
      to === 'ACTIVE'
        ? {
            state: to,
            startedAt: now,
            expiresAt: new Date(
              now.getTime() + current!.template.durationSeconds * 1000,
            ),
            lockVersion: { increment: 1 },
          }
        : { state: to, endedAt: now, lockVersion: { increment: 1 } };
    const updated = await db.assessmentSession.updateMany({
      where: {
        assessmentSessionId: id,
        ownerUserId,
        state: from,
        lockVersion: current!.lockVersion,
      },
      data,
    });
    if (updated.count !== 1) assessmentConcurrency();
    await this.audit(ownerUserId, ownerUserId, `ASSESSMENT_SESSION_${to}`, id, {
      state: from,
      nextState: to,
    });
    metrics.increment(DOMAIN_METRICS.assessmentSessions, { outcome: to.toLowerCase() });
    return db.assessmentSession.findUnique({
      where: { assessmentSessionId: id },
    });
  }

  private async audit(
    actorUserId: string,
    subjectUserId: string,
    action: string,
    resourceId: string,
    metadata: Prisma.InputJsonValue,
  ) {
    await this.db.auditEvent.create({
      data: {
        actorUserId,
        subjectUserId,
        action,
        resourceType: 'ASSESSMENT_SESSION',
        resourceId,
        metadata,
      },
    });
  }
}
