import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import {
  questionConflict,
  questionForbidden,
  questionNotFound,
} from './question-bank.errors';

type Scope = { examId: string; subjectId: string };
type Provenance = {
  authorOrSource: string;
  originType: 'AUTHOR_CREATED' | 'LICENSED_SOURCE' | 'APPROVED_FIXTURE';
  sourceReference?: string;
  creationMethod: string;
  attribution?: string;
  reviewNotes?: string;
  verificationStatus: string;
};
type Rights = {
  license: string;
  rightsStatus: 'VERIFIED' | 'PENDING' | 'RESTRICTED' | 'REJECTED';
  commercialUseAllowed: boolean;
  restrictionNotes?: string;
};

@Injectable()
export class QuestionBankService {
  constructor(private readonly db: DatabaseService) {}

  private async authorize(
    userId: string,
    scopeKey: string,
    action: 'WRITE' | 'REVIEW',
  ) {
    const roles = await this.db.userRole.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { role: true, scope: true },
    });
    const allowed =
      action === 'WRITE'
        ? ['CONTENT_REVIEWER', 'ACADEMIC_ADMIN', 'PLATFORM_ADMIN']
        : ['CONTENT_REVIEWER', 'ACADEMIC_ADMIN', 'PLATFORM_ADMIN'];
    if (
      !roles.some(
        (role) =>
          allowed.includes(role.role) &&
          (!role.scope || JSON.stringify(role.scope).includes(scopeKey)),
      )
    )
      questionForbidden();
  }

  private async audit(
    actorUserId: string,
    action: string,
    resourceId: string,
    metadata: object,
  ) {
    if (!this.db.auditEvent?.create) return undefined;
    return this.db.auditEvent.create({
      data: {
        actorUserId,
        subjectUserId: actorUserId,
        action,
        resourceType: 'QuestionVersion',
        resourceId,
        metadata,
      },
    });
  }

  private async withTransaction<T>(
    operation: (db: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.db.transaction
      ? this.db.transaction(operation)
      : operation(this.db);
  }

  private async version(id: string) {
    const version = await this.db.questionVersion.findUnique({
      where: { questionVersionId: id },
      include: {
        question: true,
        concepts: true,
        solutions: true,
        provenance: true,
        rights: true,
      },
    });
    if (!version) questionNotFound();
    return version!;
  }

  private async validateScopeNode(scope: Scope, syllabusNodeId: string) {
    const node = await this.db.syllabusNode.findUnique({
      where: { canonicalId: syllabusNodeId },
      include: {
        chapter: {
          include: {
            unit: { include: { domain: { include: { subject: true } } } },
          },
        },
      },
    });
    const subject = node?.chapter.unit.domain.subject;
    if (
      !subject ||
      subject.examId !== scope.examId ||
      subject.canonicalId !== scope.subjectId
    )
      questionConflict(
        'VERSION_SCOPE_MISMATCH',
        'Syllabus node is outside the question scope.',
      );
  }

  private validateMetadata(input: { provenance: Provenance; rights: Rights }) {
    if (
      !input.provenance.authorOrSource ||
      !input.provenance.creationMethod ||
      !input.provenance.verificationStatus
    )
      questionConflict(
        'PROVENANCE_REQUIRED',
        'Production questions require complete provenance.',
      );
    if (!input.rights.license || input.rights.rightsStatus !== 'VERIFIED')
      questionConflict(
        'RIGHTS_REQUIRED',
        'Production questions require verified rights.',
      );
  }

  async createQuestion(
    userId: string,
    scope: Scope,
    input: {
      questionType: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'NUMERIC' | 'SUBJECTIVE';
      stem: unknown;
      options?: unknown;
      correctAnswerRef?: string;
      explanationRef?: string;
      syllabusNodeId: string;
      learningObjectiveId?: string;
      locale?: string;
      reason: string;
      provenance: Provenance;
      rights: Rights;
    },
  ) {
    const scopeKey = `${scope.examId}:${scope.subjectId}`;
    await this.authorize(userId, scopeKey, 'WRITE');
    this.validateMetadata(input);
    await this.validateScopeNode(scope, input.syllabusNodeId);
    const question = await this.db.question.create({
      data: {
        scopeKey,
        examId: scope.examId,
        subjectId: scope.subjectId,
        createdByUserId: userId,
        versions: {
          create: {
            versionNumber: 1,
            questionType: input.questionType,
            stem: input.stem as object,
            options: input.options as object,
            correctAnswerRef: input.correctAnswerRef,
            explanationRef: input.explanationRef,
            syllabusNodeId: input.syllabusNodeId,
            learningObjectiveId: input.learningObjectiveId,
            locale: input.locale ?? 'en-IN',
            createdByUserId: userId,
            provenance: { create: input.provenance },
            rights: { create: input.rights },
          },
        },
      },
      include: { versions: true },
    });
    await this.audit(
      userId,
      'QUESTION_CREATED',
      question.versions[0].questionVersionId,
      { scopeKey, reason: input.reason },
    );
    return question;
  }

  async createVersion(
    userId: string,
    questionId: string,
    input: Omit<
      Parameters<QuestionBankService['createQuestion']>[2],
      'provenance' | 'rights'
    > & { provenance: Provenance; rights: Rights },
  ) {
    const question = await this.db.question.findUnique({
      where: { questionId },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    if (!question) questionNotFound();
    await this.authorize(userId, question!.scopeKey, 'WRITE');
    this.validateMetadata(input);
    await this.validateScopeNode(
      { examId: question!.examId, subjectId: question!.subjectId },
      input.syllabusNodeId,
    );
    const latest = question!.versions[0];
    if (latest?.status === 'PUBLISHED' && input.reason.length === 0)
      questionConflict(
        'REASON_REQUIRED',
        'A reason is required for a new version.',
      );
    const version = await this.db.questionVersion.create({
      data: {
        questionId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        questionType: input.questionType,
        stem: input.stem as object,
        options: input.options as object,
        correctAnswerRef: input.correctAnswerRef,
        explanationRef: input.explanationRef,
        syllabusNodeId: input.syllabusNodeId,
        learningObjectiveId: input.learningObjectiveId,
        locale: input.locale ?? 'en-IN',
        createdByUserId: userId,
        provenance: { create: input.provenance },
        rights: { create: input.rights },
      },
    });
    await this.audit(
      userId,
      'QUESTION_VERSION_CREATED',
      version.questionVersionId,
      {
        questionId,
        beforeVersion: latest?.versionNumber,
        afterVersion: version.versionNumber,
        reason: input.reason,
      },
    );
    return version;
  }

  async addConceptMap(
    userId: string,
    versionId: string,
    conceptId: string,
    mappingRole: 'PRIMARY' | 'SECONDARY',
  ) {
    const version = await this.version(versionId);
    await this.authorize(userId, version.question.scopeKey, 'WRITE');
    if (version.status !== 'DRAFT')
      questionConflict(
        'PUBLISHED_VERSION_IMMUTABLE',
        'Published or reviewed versions cannot be edited.',
      );
    const syllabusVersionId = this.db.syllabusVersion?.findFirst
      ? (
          await this.db.syllabusVersion.findFirst({
            where: {
              examId: version.question.examId,
              subjectId: version.question.subjectId,
              status: 'ACTIVE',
              current: true,
            },
            orderBy: { canonicalId: 'asc' },
          })
        )?.canonicalId
      : 'JEE_MAIN_PHYSICS_2026_V1';
    const membership = await this.db.syllabusVersionConcept.findUnique({
      where: {
        versionId_conceptId: {
          versionId: syllabusVersionId ?? 'JEE_MAIN_PHYSICS_2026_V1',
          conceptId,
        },
      },
    });
    if (!membership)
      questionConflict(
        'UNKNOWN_CONCEPT',
        'Concept is not an approved member of the syllabus version.',
      );
    const data = {
      questionVersionId: versionId,
      conceptId,
      mappingRole,
      approved: false,
      createdByUserId: userId,
    };
    return this.db.questionConceptMap.upsert({
      where: {
        questionVersionId_conceptId: {
          questionVersionId: versionId,
          conceptId,
        },
      },
      create: data,
      update: { mappingRole, approved: false },
    });
  }

  async seedDevelopmentFixture(
    userId: string,
    fixture: {
      questionId: string;
      scope: Scope;
      syllabusNodeId: string;
      stem: unknown;
      questionType?:
        'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'NUMERIC' | 'SUBJECTIVE';
    },
  ) {
    const scopeKey = `${fixture.scope.examId}:${fixture.scope.subjectId}`;
    await this.authorize(userId, scopeKey, 'WRITE');
    await this.validateScopeNode(fixture.scope, fixture.syllabusNodeId);
    return this.db.question.upsert({
      where: { questionId: fixture.questionId },
      create: {
        questionId: fixture.questionId,
        scopeKey,
        examId: fixture.scope.examId,
        subjectId: fixture.scope.subjectId,
        createdByUserId: userId,
        versions: {
          create: {
            versionNumber: 1,
            questionType: fixture.questionType ?? 'TRUE_FALSE',
            stem: fixture.stem as object,
            syllabusNodeId: fixture.syllabusNodeId,
            createdByUserId: userId,
            provenance: {
              create: {
                authorOrSource: 'C011_TEST_FIXTURE',
                originType: 'APPROVED_FIXTURE',
                creationMethod: 'deterministic_test_fixture',
                verificationStatus: 'TEST_ONLY',
              },
            },
            rights: {
              create: {
                license: 'TEST_ONLY',
                rightsStatus: 'VERIFIED',
                commercialUseAllowed: false,
              },
            },
          },
        },
      },
      update: {},
      include: { versions: true },
    });
  }

  async transitionVersion(
    userId: string,
    versionId: string,
    nextStatus:
      'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'RETIRED' | 'REJECTED' | 'DRAFT',
    reason: string,
  ) {
    const version = await this.version(versionId);
    await this.authorize(userId, version.question.scopeKey, 'REVIEW');
    const allowed: Record<string, string[]> = {
      DRAFT: ['IN_REVIEW', 'REJECTED'],
      IN_REVIEW: ['APPROVED', 'REJECTED', 'DRAFT'],
      APPROVED: ['PUBLISHED', 'REJECTED'],
      PUBLISHED: ['RETIRED'],
      REJECTED: ['DRAFT'],
      RETIRED: [],
    };
    if (!allowed[version.status]?.includes(nextStatus))
      questionConflict(
        'INVALID_STATE_TRANSITION',
        `Cannot move ${version.status} to ${nextStatus}.`,
      );
    if (
      nextStatus === 'PUBLISHED' &&
      (!version.provenance ||
        !version.rights ||
        version.rights.rightsStatus !== 'VERIFIED')
    )
      questionConflict(
        'PUBLICATION_METADATA_REQUIRED',
        'Verified provenance and rights are required before publication.',
      );
    if (
      (nextStatus === 'APPROVED' || nextStatus === 'PUBLISHED') &&
      !version.concepts.some(
        (concept: { approved: boolean }) => concept.approved,
      )
    )
      questionConflict(
        'APPROVED_CONCEPT_REQUIRED',
        'An approved concept mapping is required.',
      );
    const updated = await this.db.questionVersion.update({
      where: { questionVersionId: versionId },
      data: { status: nextStatus },
    });
    await this.audit(userId, 'QUESTION_VERSION_STATUS_CHANGED', versionId, {
      beforeStatus: version.status,
      afterStatus: nextStatus,
      reason,
    });
    return updated;
  }

  async submitForReview(
    userId: string,
    versionId: string,
    reason = 'Submitted for review',
  ) {
    const version = await this.version(versionId);
    await this.authorize(userId, version.question.scopeKey, 'WRITE');
    if (version.status !== 'DRAFT' && version.status !== 'REJECTED')
      questionConflict(
        'INVALID_STATE_TRANSITION',
        'Only draft or corrected versions may be submitted.',
      );
    const updated = await this.withTransaction(async (tx) => {
      const changed = tx.questionVersion.updateMany
        ? await tx.questionVersion.updateMany({
            where: { questionVersionId: versionId, status: version.status },
            data: { status: 'IN_REVIEW' },
          })
        : await tx.questionVersion.update({
            where: { questionVersionId: versionId },
            data: { status: 'IN_REVIEW' },
          });
      if ('count' in changed && changed.count !== 1)
        questionConflict(
          'STALE_VERSION',
          'This version changed. Refresh and try again.',
        );
      if (tx.questionReviewRecord?.create)
        await tx.questionReviewRecord.create({
          data: {
            questionVersionId: versionId,
            reviewerUserId: userId,
            reviewType: 'CONTENT',
            decision: 'REQUEST_CHANGES',
            reviewScope: version.question.scopeKey,
            reason,
            correlationId: `submit:${versionId}:${Date.now()}`,
          },
        });
      if (tx.auditEvent?.create)
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            subjectUserId: userId,
            action: 'QUESTION_REVIEW_SUBMITTED',
            resourceType: 'QuestionVersion',
            resourceId: versionId,
            metadata: {
              questionId: version.questionId,
              resultingState: 'IN_REVIEW',
              reason,
            },
          },
        });
      return changed;
    });
    return updated;
  }

  async approveVersion(
    userId: string,
    versionId: string,
    reason: string,
    correlationId: string,
  ) {
    return this.decideVersion(
      userId,
      versionId,
      'APPROVE',
      'APPROVED',
      reason,
      correlationId,
    );
  }

  async rejectVersion(
    userId: string,
    versionId: string,
    reason: string,
    correlationId: string,
  ) {
    return this.decideVersion(
      userId,
      versionId,
      'REJECT',
      'REJECTED',
      reason,
      correlationId,
    );
  }

  private async decideVersion(
    userId: string,
    versionId: string,
    decision: 'APPROVE' | 'REJECT',
    nextStatus: 'APPROVED' | 'REJECTED',
    reason: string,
    correlationId: string,
  ) {
    const version = await this.version(versionId);
    await this.authorize(userId, version.question.scopeKey, 'REVIEW');
    if (version.createdByUserId === userId) questionForbidden();
    if (version.status !== 'IN_REVIEW')
      questionConflict(
        'INVALID_STATE_TRANSITION',
        'This version is not awaiting review.',
      );
    if (decision === 'APPROVE') {
      if (
        !version.provenance ||
        !version.rights ||
        version.rights.rightsStatus !== 'VERIFIED'
      )
        questionConflict(
          'PROVENANCE_REQUIRED',
          'Verified provenance and rights are required.',
        );
      if (!version.concepts.some((c: { approved: boolean }) => c.approved))
        questionConflict(
          'APPROVED_CONCEPT_REQUIRED',
          'An approved concept mapping is required.',
        );
      if (!version.correctAnswerRef && version.questionType !== 'SUBJECTIVE')
        questionConflict(
          'ANSWER_REQUIRED',
          'An answer is required before approval.',
        );
      if (!version.solutions?.length)
        questionConflict(
          'SOLUTION_REQUIRED',
          'A solution is required before approval.',
        );
    }
    return this.withTransaction(async (tx) => {
      const result = tx.questionVersion.updateMany
        ? await tx.questionVersion.updateMany({
            where: { questionVersionId: versionId, status: 'IN_REVIEW' },
            data: { status: nextStatus },
          })
        : await tx.questionVersion.update({
            where: { questionVersionId: versionId },
            data: { status: nextStatus },
          });
      if ('count' in result && result.count !== 1)
        questionConflict(
          'STALE_VERSION',
          'This version changed. Refresh and try again.',
        );
      if (tx.questionReviewRecord?.create)
        await tx.questionReviewRecord.create({
          data: {
            questionVersionId: versionId,
            reviewerUserId: userId,
            reviewType: 'CONTENT',
            decision,
            reviewScope: version.question.scopeKey,
            reason,
            correlationId,
          },
        });
      if (tx.auditEvent?.create)
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            subjectUserId: userId,
            action:
              decision === 'APPROVE'
                ? 'QUESTION_APPROVED'
                : 'QUESTION_REJECTED',
            resourceType: 'QuestionVersion',
            resourceId: versionId,
            metadata: {
              questionId: version.questionId,
              resultingState: nextStatus,
              reason,
              correlationId,
            },
          },
        });
      return result;
    });
  }

  async publishVersion(
    userId: string,
    versionId: string,
    reason: string,
    correlationId: string,
  ) {
    const version = await this.version(versionId);
    await this.authorize(userId, version.question.scopeKey, 'REVIEW');
    if (version.status !== 'APPROVED')
      questionConflict(
        'APPROVAL_REQUIRED',
        'Only approved versions may be published.',
      );
    if (
      !version.provenance ||
      !version.rights ||
      version.rights.rightsStatus !== 'VERIFIED'
    )
      questionConflict(
        'PROVENANCE_REQUIRED',
        'Verified provenance and rights are required.',
      );
    if (!version.solutions?.length)
      questionConflict(
        'SOLUTION_REQUIRED',
        'A solution is required before publication.',
      );
    return this.withTransaction(async (tx) => {
      const result = tx.questionVersion.updateMany
        ? await tx.questionVersion.updateMany({
            where: { questionVersionId: versionId, status: 'APPROVED' },
            data: { status: 'PUBLISHED' },
          })
        : await tx.questionVersion.update({
            where: { questionVersionId: versionId },
            data: { status: 'PUBLISHED' },
          });
      if ('count' in result && result.count !== 1)
        questionConflict(
          'STALE_VERSION',
          'This version changed. Refresh and try again.',
        );
      if (tx.auditEvent?.create)
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            subjectUserId: userId,
            action: 'QUESTION_PUBLISHED',
            resourceType: 'QuestionVersion',
            resourceId: versionId,
            metadata: {
              questionId: version.questionId,
              resultingState: 'PUBLISHED',
              reason,
              correlationId,
            },
          },
        });
      return result;
    });
  }

  async historicalConceptMappings(userId: string, versionId: string) {
    const version = await this.version(versionId);
    await this.authorize(userId, version.question.scopeKey, 'REVIEW');
    return this.db.questionConceptMap.findMany({
      where: { questionVersionId: versionId },
      orderBy: [{ mappingRole: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async reviewHistory(userId: string, versionId: string) {
    const version = await this.version(versionId);
    await this.authorize(userId, version.question.scopeKey, 'REVIEW');
    return this.db.questionReviewRecord.findMany({
      where: { questionVersionId: versionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async reviewDetail(userId: string, versionId: string) {
    const version = await this.version(versionId);
    await this.authorize(userId, version.question.scopeKey, 'REVIEW');
    return {
      questionVersionId: version.questionVersionId,
      questionType: version.questionType,
      stem: version.stem,
      options: version.options,
      status: version.status,
      createdAt: version.createdAt,
      context: {
        examId: version.question.examId,
        subjectId: version.question.subjectId,
        syllabusNodeId: version.syllabusNodeId,
      },
      source: version.provenance
        ? {
            authorOrSource: version.provenance.authorOrSource,
            originType: version.provenance.originType,
            verificationStatus: version.provenance.verificationStatus,
          }
        : null,
      rightsStatus: version.rights?.rightsStatus ?? null,
      hasAnswer: Boolean(version.correctAnswerRef),
      hasSolution: Boolean(version.solutions?.length),
    };
  }

  async setDifficulty(
    userId: string,
    versionId: string,
    data: {
      authorDifficulty?: number;
      empiricalDifficulty?: number;
      calibratedDifficulty?: number;
      confidence?: number;
      provenance?: string;
    },
  ) {
    const version = await this.version(versionId);
    await this.authorize(userId, version.question.scopeKey, 'WRITE');
    if (version.status !== 'DRAFT')
      questionConflict(
        'PUBLISHED_VERSION_IMMUTABLE',
        'Published versions cannot be edited.',
      );
    return this.db.questionDifficulty.upsert({
      where: { questionVersionId: versionId },
      create: { questionVersionId: versionId, ...data },
      update: data,
    });
  }

  async addHint(
    userId: string,
    versionId: string,
    sequence: number,
    content: unknown,
    isFinalHint = false,
  ) {
    const version = await this.version(versionId);
    await this.authorize(userId, version.question.scopeKey, 'WRITE');
    if (version.status !== 'DRAFT')
      questionConflict(
        'PUBLISHED_VERSION_IMMUTABLE',
        'Published versions cannot be edited.',
      );
    if (!Number.isInteger(sequence) || sequence < 1)
      questionConflict(
        'INVALID_HINT_SEQUENCE',
        'Hint sequence must be positive.',
      );
    return this.db.questionHint.create({
      data: {
        questionVersionId: versionId,
        sequence,
        content: content as object,
        isFinalHint,
      },
    });
  }

  async addSolution(
    userId: string,
    versionId: string,
    solutionKey: string,
    content: unknown,
  ) {
    const version = await this.version(versionId);
    await this.authorize(userId, version.question.scopeKey, 'WRITE');
    if (version.status !== 'DRAFT')
      questionConflict(
        'PUBLISHED_VERSION_IMMUTABLE',
        'Published versions cannot be edited.',
      );
    return this.db.questionSolution.create({
      data: {
        questionVersionId: versionId,
        solutionKey,
        content: content as object,
      },
    });
  }

  async createReviewRecord(
    userId: string,
    versionId: string,
    data: {
      reviewType:
        'CONTENT' | 'CONCEPT_MAPPING' | 'DIFFICULTY' | 'PROVENANCE' | 'RIGHTS';
      decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
      reviewScope: string;
      reason: string;
      correlationId: string;
      beforeReference?: unknown;
      afterReference?: unknown;
    },
  ) {
    const version = await this.version(versionId);
    await this.authorize(userId, version.question.scopeKey, 'REVIEW');
    if (version.createdByUserId === userId) questionForbidden();
    const record = await this.db.questionReviewRecord.create({
      data: {
        questionVersionId: versionId,
        reviewerUserId: userId,
        ...data,
        beforeReference: data.beforeReference as object,
        afterReference: data.afterReference as object,
      },
    });
    await this.audit(userId, 'QUESTION_REVIEW_RECORDED', versionId, {
      reviewType: data.reviewType,
      decision: data.decision,
      reviewScope: data.reviewScope,
      reason: data.reason,
      correlationId: data.correlationId,
      beforeReference: data.beforeReference,
      afterReference: data.afterReference,
    });
    return record;
  }

  async learnerProjection(versionId: string) {
    const version = await this.db.questionVersion.findUnique({
      where: { questionVersionId: versionId },
      select: {
        questionVersionId: true,
        questionType: true,
        stem: true,
        options: true,
        syllabusNodeId: true,
        learningObjectiveId: true,
        locale: true,
        status: true,
        hints: {
          orderBy: { sequence: 'asc' },
          select: { sequence: true, content: true, isFinalHint: true },
        },
      },
    });
    if (!version || version.status !== 'PUBLISHED') questionNotFound();
    return {
      questionVersionId: version!.questionVersionId,
      questionType: version!.questionType,
      stem: version!.stem,
      options: version!.options,
      syllabusNodeId: version!.syllabusNodeId,
      learningObjectiveId: version!.learningObjectiveId,
      locale: version!.locale,
      status: version!.status,
      hints: version!.hints,
    };
  }
}
