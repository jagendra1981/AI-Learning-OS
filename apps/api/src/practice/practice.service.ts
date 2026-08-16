import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { QuestionSelectionService } from '../question-selection/question-selection.service';
import { AssessmentService } from '../assessment/assessment.service';
import { ResponseService } from '../assessment/response.service';
import { LearningEventService } from '../learning-event/learning-event.service';
import { AcademicScopeService } from '../academic/academic-scope.service';
import { AdaptiveService } from '../adaptive/adaptive.service';
import {
  practiceForbidden,
  practiceInvalid,
  practiceNotFound,
  practiceState,
} from './practice.errors';

type Goal =
  | 'CONCEPT_PRACTICE'
  | 'OBJECTIVE_PRACTICE'
  | 'REMEDIAL_PRACTICE'
  | 'MIXED_REVIEW';
type Diff = 'EASY' | 'MEDIUM' | 'HARD';
type PracticeRow = {
  practiceSessionId: string;
  ownerUserId: string;
  academicVersionId: string;
  goalType: Goal;
  targetIds: string[];
  status: string;
  currentDifficulty: string;
  consecutiveCorrect: number;
  questionCount: number;
  currentPlacementId: string | null;
  currentQuestionVersionId: string | null;
  currentAttempt: number;
  retryCount: number;
  retryAvailable: boolean;
  hintUsed: boolean;
  processedResponseIds: string[];
  stopReason: string | null;
  lockVersion: number;
  startedAt: Date | null;
};
const lower = (d: Diff): Diff =>
  d === 'HARD' ? 'MEDIUM' : d === 'MEDIUM' ? 'EASY' : 'EASY';
const higher = (d: Diff): Diff => (d === 'EASY' ? 'MEDIUM' : 'HARD');

@Injectable()
export class PracticeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly selection: QuestionSelectionService,
    private readonly assessments: AssessmentService,
    private readonly responses: ResponseService,
    private readonly learningEvents?: LearningEventService,
    private readonly scopes?: AcademicScopeService,
    private readonly adaptive?: AdaptiveService,
  ) {}
  async acquire(
    userId: string,
    input?: { practiceSessionId?: string; idempotencyKey?: string },
  ) {
    if (!userId) practiceForbidden();
    if (input?.practiceSessionId) {
      const referenced = await this.db.practiceSession.findUnique({
        where: { practiceSessionId: input.practiceSessionId },
      });
      if (!referenced) {
        practiceForbidden();
        return { status: 'UNAVAILABLE' as const, reasonCode: 'NOT_FOUND' };
      }
      if (referenced.ownerUserId !== userId) practiceForbidden();
      if (referenced.status === 'READY' || referenced.status === 'ACTIVE')
        return {
          status: 'CONTINUE',
          practiceSessionId: referenced.practiceSessionId,
          academicVersionId: referenced.academicVersionId,
        };
    }
    const resolved = await this.resolveEntry(userId);
    if (!resolved) return { status: 'UNAVAILABLE', reasonCode: 'NO_SCOPE' };
    return this.db.$transaction(async (tx) => {
      const lockKey = `C017:practice-acquire:${userId}:${resolved.academicVersionId}:${resolved.targetConceptId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const existing = await tx.practiceSession.findFirst({
        where: {
          ownerUserId: userId,
          academicVersionId: resolved.academicVersionId,
          goalType: 'CONCEPT_PRACTICE',
          targetIds: { has: resolved.targetConceptId },
          status: { in: ['READY', 'ACTIVE'] },
        },
        orderBy: { createdAt: 'asc' },
      });
      if (existing)
        return {
          status: 'CONTINUE' as const,
          practiceSessionId: existing.practiceSessionId,
          academicVersionId: existing.academicVersionId,
          examId: resolved.examId,
          subjectId: resolved.subjectId,
          targetConceptId: resolved.targetConceptId,
        };
      if (!resolved.assessmentSessionId)
        return {
          status: 'UNAVAILABLE' as const,
          reasonCode: 'ASSESSMENT_UNAVAILABLE',
        };
      const created = await this.create(userId, {
        academicVersionId: resolved.academicVersionId,
        examId: resolved.examId,
        subjectId: resolved.subjectId,
        goalType: 'CONCEPT_PRACTICE',
        targetIds: [resolved.targetConceptId],
        assessmentSessionId: resolved.assessmentSessionId,
      });
      return {
        status: 'ACQUIRED' as const,
        practiceSessionId: created.practiceSessionId,
        academicVersionId: resolved.academicVersionId,
        examId: resolved.examId,
        subjectId: resolved.subjectId,
        targetConceptId: resolved.targetConceptId,
      };
    });
  }
  private async resolveEntry(userId: string) {
    const profile = await this.db.studentProfile.findUnique({
      where: { userId },
    });
    if (
      !profile ||
      profile.onboardingState !== 'READY_FOR_DIAGNOSTIC' ||
      !profile.targetExamId ||
      !profile.targetYear
    )
      return null;
    const scope = await this.db.academicScope.findFirst({
      where: { learnerId: userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!scope || !this.scopes || !this.adaptive) return null;
    if (
      (await this.scopes.resolve({
        learnerId: userId,
        contextId: scope.contextId,
        academicVersionId: scope.academicVersionId,
      })) !== 'VISIBLE'
    )
      return null;
    const version = await this.db.syllabusVersion.findUnique({
      where: { canonicalId: scope.academicVersionId },
    });
    if (
      !version ||
      version.status !== 'ACTIVE' ||
      version.examId !== profile.targetExamId ||
      version.effectiveYear !== profile.targetYear
    )
      return null;
    const recommendation = await this.adaptive.current(userId, {
      learnerId: userId,
      contextId: scope.contextId,
      academicVersionId: scope.academicVersionId,
    });
    const target = recommendation.selected?.targetRefId;
    if (!target) return null;
    const assessment = await this.db.assessmentSession.findFirst({
      where: {
        ownerUserId: userId,
        syllabusVersionId: scope.academicVersionId,
        state: { in: ['READY', 'ACTIVE'] },
      },
      orderBy: { createdAt: 'asc' },
      select: { assessmentSessionId: true },
    });
    return {
      academicVersionId: scope.academicVersionId,
      examId: version.examId,
      subjectId: version.subjectId,
      targetConceptId: target,
      assessmentSessionId: assessment?.assessmentSessionId ?? null,
    };
  }
  async create(
    userId: string,
    input: {
      academicVersionId: string;
      examId: string;
      subjectId: string;
      goalType: Goal;
      targetIds: string[];
      assessmentSessionId?: string;
    },
  ) {
    if (
      !userId ||
      !input?.academicVersionId ||
      !input.examId ||
      !input.subjectId ||
      ![
        'CONCEPT_PRACTICE',
        'OBJECTIVE_PRACTICE',
        'REMEDIAL_PRACTICE',
        'MIXED_REVIEW',
      ].includes(input.goalType) ||
      !Array.isArray(input.targetIds)
    )
      practiceInvalid();
    const expected =
      input.goalType === 'CONCEPT_PRACTICE' ||
      input.goalType === 'OBJECTIVE_PRACTICE' ||
      input.goalType === 'REMEDIAL_PRACTICE'
        ? 1
        : 5;
    if (
      input.targetIds.length < 1 ||
      input.targetIds.length > expected ||
      (expected === 1 && input.targetIds.length !== 1) ||
      new Set(input.targetIds).size !== input.targetIds.length
    )
      practiceInvalid('Practice goal targets are invalid.');
    const v = await this.db.syllabusVersion.findUnique({
      where: { canonicalId: input.academicVersionId },
    });
    if (
      !v ||
      v.status !== 'ACTIVE' ||
      v.examId !== input.examId ||
      v.subjectId !== input.subjectId
    )
      practiceInvalid('Practice academic version is invalid.');
    if (input.assessmentSessionId) {
      const a = await this.assessments.getSession(
        userId,
        input.assessmentSessionId,
      );
      if (
        !a ||
        a.syllabusVersionId !== input.academicVersionId ||
        (a.state !== 'READY' && a.state !== 'ACTIVE')
      )
        practiceInvalid('Practice assessment session is invalid.');
    }
    const ids =
      input.goalType === 'OBJECTIVE_PRACTICE'
        ? await this.db.learningObjective.count({
            where: { canonicalId: { in: input.targetIds } },
          })
        : await this.db.syllabusVersionConcept.count({
            where: {
              versionId: input.academicVersionId,
              conceptId: { in: input.targetIds },
            },
          });
    if (
      ids !== input.targetIds.length &&
      input.goalType !== 'REMEDIAL_PRACTICE'
    )
      practiceInvalid('Practice target is not approved for this version.');
    const createInTransaction = async (tx: Prisma.TransactionClient) => {
      const s = await tx.practiceSession.create({
        data: {
          ownerUserId: userId,
          academicVersionId: input.academicVersionId,
          assessmentSessionId: input.assessmentSessionId,
          goalType: input.goalType,
          targetIds: input.targetIds,
        },
      });
      await this.audit(
        userId,
        'PRACTICE_SESSION_CREATED',
        s.practiceSessionId,
        {
          goalType: s.goalType,
          versionId: s.academicVersionId,
          targetCount: s.targetIds.length,
          assessmentSessionId: s.assessmentSessionId,
        },
        tx,
      );
      return s;
    };
    const s = await this.db.$transaction(createInTransaction);
    return this.safe(s);
  }
  async get(userId: string, id: string) {
    return this.safe(await this.owned(userId, id));
  }
  async solution(userId: string, id: string) {
    const s = await this.owned(userId, id);
    if (
      !s.currentQuestionVersionId ||
      !s.assessmentSessionId ||
      !s.currentPlacementId
    )
      return { practiceSessionId: id, solutionStatus: 'UNAVAILABLE' };
    const placement = await this.db.assessmentSessionPlacement.findUnique({
      where: { assessmentSessionPlacementId: s.currentPlacementId ?? '' },
      select: {
        assessmentSessionId: true,
        questionVersionId: true,
        responses: {
          select: { assessmentResponseId: true },
          take: 1,
        },
        session: { select: { ownerUserId: true } },
      },
    });
    if (
      !placement ||
      placement.assessmentSessionId !== s.assessmentSessionId ||
      placement.questionVersionId !== s.currentQuestionVersionId ||
      placement.session.ownerUserId !== userId ||
      placement.responses.length === 0
    )
      return {
        practiceSessionId: id,
        questionVersionId: s.currentQuestionVersionId,
        solutionStatus: 'LOCKED',
      };
    const assessment = await this.db.assessmentSession.findUnique({
      where: { assessmentSessionId: s.assessmentSessionId },
      select: { state: true },
    });
    if (assessment?.state !== 'COMPLETED')
      return {
        practiceSessionId: id,
        questionVersionId: s.currentQuestionVersionId,
        solutionStatus: 'LOCKED',
      };
    const q = await this.db.questionVersion.findUnique({
      where: { questionVersionId: s.currentQuestionVersionId },
      select: {
        questionId: true,
        questionVersionId: true,
        correctAnswerRef: true,
        solutions: {
          select: { content: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });
    if (!q) return { practiceSessionId: id, solutionStatus: 'UNAVAILABLE' };
    return {
      practiceSessionId: id,
      questionId: q.questionId,
      questionVersionId: q.questionVersionId,
      solutionStatus: 'AVAILABLE',
      correctAnswer: q.correctAnswerRef,
      explanation: q.solutions[0]?.content ?? null,
    };
  }
  async next(userId: string, id: string) {
    const s = await this.owned(userId, id);
    if (s.status === 'COMPLETED' || s.status === 'STOPPED') return this.safe(s);
    if (s.currentQuestionVersionId) return this.question(s);
    if (s.questionCount >= 20)
      return this.finish(userId, id, 'MAX_QUESTIONS_REACHED');
    const v = await this.db.syllabusVersion.findUniqueOrThrow({
      where: { canonicalId: s.academicVersionId },
    });
    let selected;
    try {
      selected = await this.selection.select({
        userId,
        syllabusVersionId: s.academicVersionId,
        examId: v.examId,
        subjectId: v.subjectId,
        count: 1,
        questionType: 'MULTIPLE_CHOICE',
        conceptIds:
          s.goalType === 'OBJECTIVE_PRACTICE' ? undefined : s.targetIds,
        objectiveIds: ['OBJECTIVE_PRACTICE', 'MIXED_REVIEW'].includes(
          s.goalType,
        )
          ? s.targetIds
          : undefined,
        targetDifficulty: s.currentDifficulty as Diff,
        excludeQuestionVersionIds: await this.used(id),
        sessionId: id,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        (error as { status?: number })?.status === 404 ||
        (error as { response?: { code?: string } })?.response?.code ===
          'NO_ELIGIBLE_CANDIDATE'
      )
        return this.finish(userId, id, 'NO_ELIGIBLE_CANDIDATE');
      throw error;
    }
    if (!selected) return this.finish(userId, id, 'NO_ELIGIBLE_CANDIDATE');
    if (!s.assessmentSessionId)
      practiceInvalid('Practice assessment session is required.');
    const assessment = await this.assessments.getSession(
      userId,
      s.assessmentSessionId!,
    );
    if (assessment?.state === 'READY')
      await this.assessments.start(userId, s.assessmentSessionId!);
    const presentation = async (tx: Prisma.TransactionClient) => {
      const placement = await this.assessments
        .placeQuestion(
          userId,
          s.assessmentSessionId!,
          {
            questionVersionId: selected.questionVersionId,
            ordinal: s.questionCount,
            selectionReference: selected.explanation.selectionReasonCode,
          },
          tx,
        )
        .catch(() => null);
      if (!placement)
        practiceInvalid('Practice assessment placement is unavailable.');
      const updated = await tx.practiceSession.updateMany({
        where: {
          practiceSessionId: id,
          ownerUserId: userId,
          status: { in: ['READY', 'ACTIVE'] },
          currentQuestionVersionId: null,
          lockVersion: s.lockVersion,
        },
        data: {
          status: 'ACTIVE',
          startedAt: s.startedAt ?? new Date(),
          currentQuestionVersionId: selected.questionVersionId,
          currentPlacementId: placement!.assessmentSessionPlacementId,
          currentAttempt: 0,
          hintUsed: false,
          lockVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) practiceState('Practice changed concurrently.');
      await this.audit(
        userId,
        'PRACTICE_QUESTION_SELECTED',
        id,
        {
          questionVersionId: selected.questionVersionId,
          selectionReason: selected.explanation.selectionReasonCode,
          placementId: placement!.assessmentSessionPlacementId,
          ordinal: s.questionCount,
          difficulty: s.currentDifficulty,
          versionId: s.academicVersionId,
        },
        tx,
      );
      return { updated, placement };
    };
    await this.db.$transaction(presentation);
    return this.question(await this.owned(userId, id));
  }
  async respond(
    userId: string,
    id: string,
    input: {
      sessionId: string;
      placementId: string;
      idempotencyKey: string;
      selectedOption?: string | null;
      questionVersionId?: string;
      score?: unknown;
      isCorrect?: unknown;
      answerKey?: unknown;
    },
  ) {
    const s = await this.owned(userId, id);
    if (
      s.status !== 'ACTIVE' ||
      !s.currentPlacementId ||
      s.currentPlacementId !== input.placementId
    )
      practiceState();
    if (
      input.questionVersionId &&
      input.questionVersionId !== s.currentQuestionVersionId
    )
      practiceInvalid('Question version is invalid.');
    if ('score' in input || 'isCorrect' in input || 'answerKey' in input)
      practiceInvalid('Client scoring fields are not accepted.');
    const operation = async (tx: Prisma.TransactionClient) => {
      const result = await this.responses.submit(
        userId,
        {
          ...input,
          sessionId: s.assessmentSessionId ?? input.sessionId,
        },
        tx,
      );
      if (s.processedResponseIds.includes(result.responseId))
        return this.feedback(s, result.responseId);
      const row = await tx.assessmentResponse.findUniqueOrThrow({
        where: { assessmentResponseId: result.responseId },
        select: { correctness: true },
      });
      const retry = row.correctness === 'INCORRECT' && s.currentAttempt === 0;
      const nextDiff =
        row.correctness === 'CORRECT' &&
        s.currentAttempt === 0 &&
        !s.hintUsed &&
        s.consecutiveCorrect + 1 >= 2
          ? higher(s.currentDifficulty as Diff)
          : row.correctness === 'INCORRECT' && s.currentAttempt === 0
            ? lower(s.currentDifficulty as Diff)
            : s.currentDifficulty;
      const updated = await tx.practiceSession.updateMany({
        where: {
          practiceSessionId: id,
          ownerUserId: userId,
          status: 'ACTIVE',
          lockVersion: s.lockVersion,
        },
        data: {
          processedResponseIds: { push: result.responseId },
          questionCount:
            s.currentAttempt === 0 ? s.questionCount + 1 : s.questionCount,
          currentAttempt: s.currentAttempt + 1,
          retryAvailable: retry,
          retryCount: retry ? 0 : s.retryCount,
          consecutiveCorrect:
            row.correctness === 'CORRECT' &&
            s.currentAttempt === 0 &&
            !s.hintUsed
              ? s.consecutiveCorrect + 1
              : 0,
          currentDifficulty: nextDiff,
          currentQuestionVersionId: retry ? s.currentQuestionVersionId : null,
          currentPlacementId: retry ? s.currentPlacementId : null,
          lockVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const latest = await this.owned(userId, id);
        if (latest.processedResponseIds.includes(result.responseId))
          return this.feedback(latest, result.responseId);
        practiceState('Practice changed concurrently.');
      }
      await this.audit(
        userId,
        'PRACTICE_RESPONSE_CONSUMED',
        id,
        {
          responseId: result.responseId,
          correctness: row.correctness,
          placementId: input.placementId,
          questionVersionId: s.currentQuestionVersionId,
          answered: row.correctness !== 'UNANSWERED',
          difficultyBefore: s.currentDifficulty,
          difficultyAfter: nextDiff,
          versionId: s.academicVersionId,
        },
        tx,
      );
      return {
        ...result,
        feedback: { correctness: row.correctness, score: undefined },
        retryAvailable: retry,
      };
    };
    try {
      return await this.db.$transaction(operation);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return this.db.$transaction(operation);
      throw error;
    }
  }
  async stop(userId: string, id: string) {
    const s = await this.owned(userId, id);
    if (s.status === 'STOPPED') return this.safe(s);
    if (s.status === 'COMPLETED') practiceState();
    const u = await this.db.practiceSession.update({
      where: { practiceSessionId: id },
      data: {
        status: 'STOPPED',
        stopReason: 'USER_STOPPED',
        completedAt: new Date(),
        lockVersion: { increment: 1 },
      },
    });
    await this.audit(userId, 'PRACTICE_SESSION_STOPPED', id, {
      reason: 'USER_STOPPED',
    });
    return this.safe(u);
  }
  async complete(userId: string, id: string) {
    const s = await this.owned(userId, id);
    if (
      s.status !== 'ACTIVE' ||
      s.currentQuestionVersionId ||
      s.questionCount < 5
    )
      practiceState(
        'Practice requires five answered questions and no active question.',
      );
    const operation = async (tx: Prisma.TransactionClient) => {
      const u = await tx.practiceSession.updateMany({
        where: {
          practiceSessionId: id,
          ownerUserId: userId,
          status: 'ACTIVE',
          lockVersion: s.lockVersion,
        },
        data: {
          status: 'COMPLETED',
          stopReason: 'USER_COMPLETED',
          completedAt: new Date(),
          lockVersion: { increment: 1 },
        },
      });
      if (u.count !== 1) practiceState('Practice changed concurrently.');
      const out = await tx.practiceSession.findUniqueOrThrow({
        where: { practiceSessionId: id },
      });
      await this.audit(
        userId,
        'PRACTICE_SESSION_COMPLETED',
        id,
        {
          reason: 'USER_COMPLETED',
          questionCount: out.questionCount,
          versionId: out.academicVersionId,
          assessmentSessionId: out.assessmentSessionId,
        },
        tx,
      );
      return this.safe(out);
    };
    return typeof this.db.$transaction === 'function'
      ? this.db.$transaction(operation)
      : operation(this.db as unknown as Prisma.TransactionClient);
  }
  async retry(userId: string, id: string) {
    const s = await this.owned(userId, id);
    if (
      s.status !== 'ACTIVE' ||
      !s.retryAvailable ||
      s.retryCount >= 1 ||
      !s.currentQuestionVersionId
    )
      practiceState('Retry is not available.');
    const operation = async (tx: Prisma.TransactionClient) => {
      const originalPlacement = await tx.assessmentSessionPlacement.findUnique({
        where: { assessmentSessionPlacementId: s.currentPlacementId! },
        select: {
          assessmentSessionId: true,
          questionVersionId: true,
          ordinal: true,
        },
      });
      if (
        !originalPlacement ||
        originalPlacement.assessmentSessionId !== s.assessmentSessionId ||
        originalPlacement.questionVersionId !== s.currentQuestionVersionId
      )
        practiceState('Retry placement is invalid.');
      const existingRetry = await tx.assessmentSessionPlacement.findFirst({
        where: { retryOfPlacementId: s.currentPlacementId! },
        select: { assessmentSessionPlacementId: true },
      });
      if (existingRetry)
        return this.question({
          ...s,
          currentPlacementId: existingRetry.assessmentSessionPlacementId,
        });
      const retryPlacement = await this.assessments.placeQuestion(
        userId,
        s.assessmentSessionId!,
        {
          questionVersionId: originalPlacement!.questionVersionId,
          ordinal: originalPlacement!.ordinal,
          attemptNumber: 2,
          retryOfPlacementId: s.currentPlacementId!,
          selectionReference: 'PRACTICE_RETRY',
        },
        tx,
      );
      const u = await tx.practiceSession.updateMany({
        where: {
          practiceSessionId: id,
          ownerUserId: userId,
          status: 'ACTIVE',
          lockVersion: s.lockVersion,
          retryAvailable: true,
          retryCount: 0,
        },
        data: {
          retryAvailable: false,
          retryCount: 1,
          currentAttempt: 1,
          currentPlacementId: retryPlacement.assessmentSessionPlacementId,
          lockVersion: { increment: 1 },
        },
      });
      if (u.count !== 1) {
        const latest = await tx.practiceSession.findUnique({
          where: { practiceSessionId: id },
        });
        if (latest?.currentPlacementId) return this.question(latest);
        practiceState('Practice changed concurrently.');
      }
      await this.audit(
        userId,
        'PRACTICE_RETRY_GRANTED',
        id,
        {
          placementId: retryPlacement.assessmentSessionPlacementId,
          questionVersionId: originalPlacement!.questionVersionId,
          retryOrdinal: 1,
          versionId: s.academicVersionId,
        },
        tx,
      );
      return this.question({
        ...s,
        retryAvailable: false,
        retryCount: 1,
        currentAttempt: 1,
        currentPlacementId: retryPlacement.assessmentSessionPlacementId,
        currentQuestionVersionId: originalPlacement!.questionVersionId,
      });
    };
    const result =
      typeof this.db.$transaction === 'function'
        ? await this.db.$transaction(operation)
        : await operation(this.db as unknown as Prisma.TransactionClient);
    return result;
  }
  async hint(userId: string, id: string) {
    const s = await this.owned(userId, id);
    if (s.status !== 'ACTIVE' || !s.currentQuestionVersionId)
      practiceState('Hint is not available.');
    const qv = s.currentQuestionVersionId as string;
    const h = await this.db.questionHint.findFirst({
      where: { questionVersionId: qv },
      orderBy: { sequence: 'asc' },
      select: { content: true },
    });
    if (!h) practiceInvalid('HINT_NOT_AVAILABLE');
    if (s.hintUsed)
      return {
        practiceSessionId: id,
        hintUsed: true,
        hintAvailable: false,
        hint: h!.content,
      };
    const operation = async (tx: Prisma.TransactionClient) => {
      const u = await tx.practiceSession.updateMany({
        where: {
          practiceSessionId: id,
          ownerUserId: userId,
          status: 'ACTIVE',
          currentQuestionVersionId: qv,
          hintUsed: false,
          lockVersion: s.lockVersion,
        },
        data: { hintUsed: true, lockVersion: { increment: 1 } },
      });
      if (u.count !== 1) {
        const latest = await this.owned(userId, id);
        if (latest.hintUsed)
          return {
            practiceSessionId: id,
            hintUsed: true,
            hintAvailable: false,
            hint: h!.content,
          };
        practiceState('Practice changed concurrently.');
      }
      await this.audit(
        userId,
        'PRACTICE_HINT_USED',
        id,
        {
          placementId: s.currentPlacementId,
          questionVersionId: qv,
          versionId: s.academicVersionId,
        },
        tx,
      );
      return null;
    };
    const replay =
      typeof this.db.$transaction === 'function'
        ? await this.db.$transaction(operation)
        : await operation(this.db as unknown as Prisma.TransactionClient);
    if (replay) return replay;
    return {
      practiceSessionId: id,
      hintUsed: true,
      hintAvailable: false,
      hint: h!.content,
    };
  }
  private async owned(userId: string, id: string) {
    const s = await this.db.practiceSession.findUnique({
      where: { practiceSessionId: id },
    });
    if (!s) practiceNotFound();
    if (s!.ownerUserId !== userId) practiceForbidden();
    return s!;
  }
  private async used(id: string) {
    const s = await this.db.practiceSession.findUnique({
      where: { practiceSessionId: id },
      select: { assessmentSessionId: true },
    });
    if (!s?.assessmentSessionId) return [];
    const rows = await this.db.assessmentSessionPlacement.findMany({
      where: { assessmentSessionId: s.assessmentSessionId },
      select: { questionVersionId: true },
    });
    return [...new Set(rows.map((x) => x.questionVersionId))];
  }
  private async finish(
    userId: string,
    id: string,
    reason: 'MAX_QUESTIONS_REACHED' | 'NO_ELIGIBLE_CANDIDATE',
  ) {
    const s = await this.db.practiceSession.update({
      where: { practiceSessionId: id },
      data: {
        status: 'COMPLETED',
        stopReason: reason,
        completedAt: new Date(),
        lockVersion: { increment: 1 },
      },
    });
    await this.audit(userId, 'PRACTICE_SESSION_COMPLETED', id, { reason });
    return this.safe(s);
  }
  private async question(s: PracticeRow) {
    const q = s.currentQuestionVersionId
      ? await this.db.questionVersion?.findUnique?.({
          where: { questionVersionId: s.currentQuestionVersionId },
          select: {
            questionVersionId: true,
            questionId: true,
            questionType: true,
            stem: true,
            options: true,
          },
        })
      : null;
    const hint = s.currentQuestionVersionId
      ? await this.db.questionHint?.findFirst?.({
          where: { questionVersionId: s.currentQuestionVersionId },
          orderBy: { sequence: 'asc' },
          select: { questionHintId: true },
        })
      : null;
    return {
      practiceSessionId: s.practiceSessionId,
      status: s.status,
      question: {
        questionId: q?.questionId ?? null,
        questionVersionId: s.currentQuestionVersionId,
        placementId: s.currentPlacementId,
        questionType: q?.questionType ?? null,
        stem: q?.stem ?? null,
        options: q?.options ?? null,
      },
      progress: { answered: s.questionCount, maximum: 20 },
      attemptState: {
        attempt: s.currentAttempt,
        retryAvailable: s.retryAvailable,
      },
      hintState: {
        state: s.hintUsed ? 'USED' : hint ? 'AVAILABLE' : 'UNAVAILABLE',
      },
      difficulty: s.currentDifficulty,
      retryAvailable: s.retryAvailable,
      hintUsed: s.hintUsed,
    };
  }
  private async feedback(s: PracticeRow, responseId: string) {
    const row = await this.db.assessmentResponse.findUnique({
      where: { assessmentResponseId: responseId },
      select: { correctness: true, score: true },
    });
    return {
      responseId,
      feedback: { correctness: row?.correctness, score: row?.score },
      retryAvailable: s.retryAvailable,
    };
  }
  private safe(s: PracticeRow) {
    return {
      practiceSessionId: s.practiceSessionId,
      academicVersionId: s.academicVersionId,
      goalType: s.goalType,
      targetIds: s.targetIds,
      status: s.status,
      currentDifficulty: s.currentDifficulty,
      questionCount: s.questionCount,
      retryAvailable: s.retryAvailable,
      retryCount: s.retryCount,
      hintUsed: s.hintUsed,
      stopReason: s.stopReason,
    };
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  private async audit(
    userId: string,
    action: string,
    id: string,
    metadata: any,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.db;
    await db.auditEvent.create({
      data: {
        actorUserId: userId,
        subjectUserId: userId,
        action,
        resourceType: 'PRACTICE_SESSION',
        resourceId: id,
        metadata,
      },
    });
    if (this.learningEvents) {
      const map: Record<string, string> = {
        PRACTICE_SESSION_CREATED: 'PRACTICE_STARTED',
        PRACTICE_QUESTION_SELECTED: 'PRACTICE_QUESTION_PRESENTED',
        PRACTICE_RESPONSE_CONSUMED: 'PRACTICE_RESPONSE_PROCESSED',
        PRACTICE_HINT_USED: 'PRACTICE_HINT_CONSUMED',
        PRACTICE_RETRY_GRANTED: 'PRACTICE_RETRY_CONSUMED',
        PRACTICE_SESSION_COMPLETED: 'PRACTICE_COMPLETED',
      };
      const eventType = map[action];
      if (eventType) {
        const payload: any =
          eventType === 'PRACTICE_STARTED'
            ? {
                practiceSessionId: id,
                assessmentSessionId: metadata.assessmentSessionId ?? null,
                goalType: metadata.goalType ?? 'UNKNOWN',
              }
            : eventType === 'PRACTICE_QUESTION_PRESENTED'
              ? {
                  practiceSessionId: id,
                  placementId: metadata.placementId ?? id,
                  questionVersionId: metadata.questionVersionId ?? 'unknown',
                  ordinal: metadata.ordinal ?? 0,
                  difficulty: metadata.difficulty ?? 'UNKNOWN',
                }
              : eventType === 'PRACTICE_RESPONSE_PROCESSED'
                ? {
                    practiceSessionId: id,
                    responseId: metadata.responseId ?? id,
                    placementId: metadata.placementId ?? id,
                    questionVersionId: metadata.questionVersionId ?? 'unknown',
                    correctness: metadata.correctness ?? 'UNKNOWN',
                    answered: metadata.answered ?? false,
                    difficultyBefore: metadata.difficultyBefore ?? 'UNKNOWN',
                    difficultyAfter: metadata.difficultyAfter ?? 'UNKNOWN',
                  }
                : eventType === 'PRACTICE_HINT_CONSUMED'
                  ? {
                      practiceSessionId: id,
                      placementId: metadata.placementId ?? id,
                      questionVersionId:
                        metadata.questionVersionId ?? 'unknown',
                      hintId: metadata.hintId ?? id,
                    }
                  : eventType === 'PRACTICE_RETRY_CONSUMED'
                    ? {
                        practiceSessionId: id,
                        placementId: metadata.placementId ?? id,
                        questionVersionId:
                          metadata.questionVersionId ?? 'unknown',
                        retryOrdinal: metadata.retryOrdinal ?? 1,
                      }
                    : {
                        practiceSessionId: id,
                        assessmentSessionId:
                          metadata.assessmentSessionId ?? null,
                        stopReasonCode: metadata.reason ?? action,
                        questionCount: metadata.questionCount ?? 0,
                      };
        await this.learningEvents.append(
          {
            eventType,
            schemaVersion: 1,
            occurredAt: new Date(),
            learnerUserId: userId,
            actorUserId: userId,
            sourceComponent: 'C017',
            sourceAggregateType: 'PracticeSession',
            sourceAggregateId: id,
            correlationId: id,
            idempotencyKey: `C017:${eventType}:${id}:${metadata.responseId ?? metadata.placementId ?? metadata.reason ?? 'root'}`,
            academicContext: { academicVersionId: metadata.versionId ?? null },
            payload,
          },
          tx,
        );
      }
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
