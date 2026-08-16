import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { QuestionSelectionService } from '../question-selection/question-selection.service';
import { GraphService } from '../academic/graph.service';
import { ResponseService } from '../assessment/response.service';
import { AssessmentService } from '../assessment/assessment.service';
import { LearningEventService } from '../learning-event/learning-event.service';
import {
  diagnosticConcurrency,
  diagnosticForbidden,
  diagnosticInvalid,
  diagnosticNotFound,
  diagnosticState,
} from './diagnostic.errors';
// Prisma's generated JSON/enum union is intentionally narrowed at the persistence boundary.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
type Evidence = {
  correct: number;
  incorrect: number;
  unanswered: number;
  classification: 'SUPPORTED' | 'GAP_INDICATED' | 'INSUFFICIENT_EVIDENCE';
};
const POLICY = 'C016-DEP-GC-V1';
const MAX = 12;
const empty = (): Evidence => ({
  correct: 0,
  incorrect: 0,
  unanswered: 0,
  classification: 'INSUFFICIENT_EVIDENCE',
});
const lower = (d: Difficulty): Difficulty =>
  d === 'HARD' ? 'MEDIUM' : d === 'MEDIUM' ? 'EASY' : 'EASY';
const higher = (d: Difficulty): Difficulty =>
  d === 'EASY' ? 'MEDIUM' : 'HARD';
type DiagnosticStartBody = {
  academicVersionId: string;
  examId: string;
  subjectId: string;
  targetConceptId: string;
  sessionId?: string;
};

@Injectable()
export class DiagnosticService {
  constructor(
    private readonly db: DatabaseService,
    private readonly selection: QuestionSelectionService,
    private readonly graph: GraphService,
    private readonly responses: ResponseService,
    private readonly assessments: AssessmentService,
    private readonly learningEvents?: LearningEventService,
  ) {}

  async entry(userId: string) {
    const profile = await this.db.studentProfile.findUnique({
      where: { userId },
    });
    if (!profile || profile.onboardingState !== 'READY_FOR_DIAGNOSTIC')
      diagnosticState('Diagnostic entry requires completed onboarding.');
    const readyProfile = profile!;
    if (!readyProfile.targetExamId || !readyProfile.targetYear)
      diagnosticState('Diagnostic entry is not configured.');
    const goal = await this.db.examGoal.findFirst({
      where: {
        userId,
        examId: readyProfile.targetExamId!,
        targetYear: readyProfile.targetYear!,
      },
    });
    if (!goal) diagnosticState('Diagnostic entry is not configured.');
    const version = await this.db.syllabusVersion.findFirst({
      where: {
        examId: readyProfile.targetExamId!,
        effectiveYear: readyProfile.targetYear!,
        status: 'ACTIVE',
        current: true,
      },
      orderBy: { canonicalId: 'asc' },
    });
    if (!version) diagnosticNotFound();
    const mappings = await this.db.syllabusVersionConcept.findMany({
      where: {
        versionId: version!.canonicalId,
        concept: {
          questionMappings: {
            some: {
              approved: true,
              questionVersion: { status: 'PUBLISHED' },
            },
          },
        },
      },
      select: { conceptId: true },
    });
    if (!mappings.length) diagnosticNotFound();
    const relationships = await this.db.conceptRelationship.findMany({
      where: { versionId: version!.canonicalId, type: 'PREREQUISITE_OF' },
      select: { sourceId: true, targetId: true },
    });
    const ids = mappings.map((m) => m.conceptId);
    const depth = (id: string, seen = new Set<string>()): number => {
      if (seen.has(id)) return 0;
      const next = relationships
        .filter((r) => r.targetId === id)
        .map((r) => r.sourceId);
      if (!next.length) return 0;
      const branch = new Set(seen).add(id);
      return 1 + Math.max(...next.map((n) => depth(n, branch)));
    };
    const targetConceptId = ids.sort(
      (a, b) => depth(a) - depth(b) || a.localeCompare(b),
    )[0];
    const active = await this.db.diagnosticRun.findFirst({
      where: {
        userId,
        academicVersionId: version!.canonicalId,
        rootTargetConceptId: targetConceptId,
        status: 'ACTIVE',
      },
      select: { diagnosticRunId: true, sessionId: true },
    });
    return {
      readiness: 'READY_FOR_DIAGNOSTIC',
      academicVersionId: version!.canonicalId,
      examId: version!.examId,
      subjectId: version!.subjectId,
      targetConceptId,
      sessionId: active?.sessionId ?? null,
      existingDiagnosticId: active?.diagnosticRunId ?? null,
    };
  }

  async question(userId: string, id: string) {
    const run = await this.owned(userId, id);
    if (!run.currentPlacementId || !run.currentQuestionVersionId)
      return { diagnosticId: id, status: run.status, question: null };
    const placement = await this.db.assessmentSessionPlacement.findUnique({
      where: { assessmentSessionPlacementId: run.currentPlacementId },
      include: {
        questionVersion: { include: { question: true } },
        session: true,
      },
    });
    if (!placement || placement.assessmentSessionId !== run.sessionId)
      diagnosticNotFound();
    const q = placement!.questionVersion;
    return {
      diagnosticId: id,
      sessionId: run.sessionId,
      status: run.status,
      question: {
        placementId: placement!.assessmentSessionPlacementId,
        questionId: q.questionId,
        questionVersionId: q.questionVersionId,
        sequence: placement!.ordinal,
        progress: { completed: run.questionCount, maximum: MAX },
        stem: q.stem,
        options: q.options,
        instructions: null,
        timer: placement!.session.expiresAt
          ? { expiresAt: placement!.session.expiresAt }
          : null,
      },
    };
  }

  async startFromEntry(userId: string, input: DiagnosticStartBody) {
    const current = await this.entry(userId);
    if (
      input.academicVersionId !== current.academicVersionId ||
      input.examId !== current.examId ||
      input.subjectId !== current.subjectId ||
      input.targetConceptId !== current.targetConceptId ||
      (input.sessionId ?? null) !== current.sessionId
    )
      diagnosticInvalid('Diagnostic entry scope is stale or invalid.');
    return this.start(userId, input);
  }

  async result(userId: string, id: string) {
    const run = await this.owned(userId, id);
    if (!run.sessionId || !run.completedAt)
      return {
        diagnosticId: id,
        status: 'PENDING',
        projectionStatus: 'NOT_REQUIRED',
      };
    const rows = await this.db.assessmentResponse.findMany({
      where: { userId, assessmentSessionId: run.sessionId },
      select: { correctness: true, score: true },
    });
    if (!rows.length)
      return {
        diagnosticId: id,
        status: 'PENDING',
        projectionStatus: 'NOT_REQUIRED',
      };
    if (run.processedResponseIds.length !== rows.length)
      return {
        diagnosticId: id,
        status: 'UNAVAILABLE',
        projectionStatus: 'UNAVAILABLE',
      };
    const correctCount = rows.filter((r) => r.correctness === 'CORRECT').length;
    const incorrectCount = rows.filter(
      (r) => r.correctness === 'INCORRECT',
    ).length;
    const unansweredCount = rows.filter(
      (r) => r.correctness === 'UNANSWERED',
    ).length;
    const score = rows.reduce((sum, r) => sum + r.score, 0);
    const maximumScore = rows.length * 4;
    const projectionStatus = await this.projectionStatus(
      userId,
      run.processedResponseIds,
    );
    return {
      diagnosticId: id,
      status:
        projectionStatus === 'CURRENT'
          ? 'COMPLETED'
          : projectionStatus === 'UNAVAILABLE'
            ? 'UNAVAILABLE'
            : 'PROVISIONAL',
      completedAt: run.completedAt,
      score,
      maximumScore,
      percentage: maximumScore > 0 ? (score / maximumScore) * 100 : null,
      correctCount,
      incorrectCount,
      unansweredCount,
      projectionStatus,
    };
  }

  private async projectionStatus(
    learnerId: string,
    responseIds: string[],
  ): Promise<'CURRENT' | 'PENDING' | 'UNAVAILABLE'> {
    try {
      const evidence = await this.db.evidenceRecord.findMany({
        where: { learnerId, sourceAggregateId: { in: responseIds } },
        select: { evidenceId: true },
      });
      if (evidence.length !== responseIds.length) return 'PENDING';
      const snapshots = await this.db.digitalTwinSnapshot.findMany({
        where: { learnerId },
        select: { snapshotId: true, appliedInputIds: true },
      });
      if (
        snapshots.some(
          (row: { appliedInputIds: unknown }) =>
            !Array.isArray(row.appliedInputIds),
        )
      )
        return 'UNAVAILABLE';
      const required = new Set(
        evidence.map((row: { evidenceId: string }) => row.evidenceId),
      );
      const snapshot = snapshots.find(
        (row: { snapshotId: string; appliedInputIds: unknown }) =>
          Array.isArray(row.appliedInputIds) &&
          [...required].every((id) =>
            (row.appliedInputIds as unknown[]).includes(id),
          ),
      );
      return snapshot ? 'CURRENT' : 'PENDING';
    } catch {
      return 'UNAVAILABLE';
    }
  }

  async start(
    userId: string,
    input: {
      academicVersionId: string;
      examId: string;
      subjectId: string;
      targetConceptId: string;
      sessionId?: string;
    },
  ) {
    if (
      !userId ||
      !input?.academicVersionId ||
      !input.examId ||
      !input.subjectId ||
      !input.targetConceptId
    )
      diagnosticInvalid('Diagnostic scope is invalid.');
    const version = await this.db.syllabusVersion.findUnique({
      where: { canonicalId: input.academicVersionId },
    });
    const member =
      version &&
      (await this.db.syllabusVersionConcept.findUnique({
        where: {
          versionId_conceptId: {
            versionId: input.academicVersionId,
            conceptId: input.targetConceptId,
          },
        },
      }));
    if (
      !version ||
      version.status !== 'ACTIVE' ||
      version.examId !== input.examId ||
      version.subjectId !== input.subjectId ||
      !member
    )
      diagnosticInvalid('Diagnostic academic scope is invalid.');
    if (input.sessionId) {
      const session = await this.assessments.getSession(
        userId,
        input.sessionId,
      );
      if (!session || session.syllabusVersionId !== input.academicVersionId)
        diagnosticInvalid('Diagnostic session scope is invalid.');
      if (!session || (session.state !== 'READY' && session.state !== 'ACTIVE'))
        diagnosticState();
    }
    const active = await this.db.diagnosticRun.findFirst({
      where: {
        userId,
        academicVersionId: input.academicVersionId,
        rootTargetConceptId: input.targetConceptId,
        status: 'ACTIVE',
      },
    });
    if (active) return this.safe(active);
    const run = await (this.db.$transaction
      ? this.db.$transaction(async (tx) => {
          const created = await tx.diagnosticRun.create({
            data: {
              userId,
              academicVersionId: input.academicVersionId,
              rootTargetConceptId: input.targetConceptId,
              currentTargetConceptId: input.targetConceptId,
              currentDifficulty: 'MEDIUM',
              sessionId: input.sessionId,
              processedResponseIds: [],
              conceptEvidence: { [input.targetConceptId]: empty() },
              path: [input.targetConceptId],
              policyVersion: POLICY,
            },
          });
          if (this.learningEvents) {
            await this.learningEvents.append(
              {
                eventType: 'DIAGNOSTIC_STARTED',
                schemaVersion: 1,
                occurredAt: created.createdAt,
                learnerUserId: userId,
                actorUserId: userId,
                sourceComponent: 'C016',
                sourceAggregateType: 'DiagnosticRun',
                sourceAggregateId: created.diagnosticRunId,
                correlationId: created.diagnosticRunId,
                academicContext: { syllabusVersionId: input.academicVersionId },
                idempotencyKey: `C016:DIAGNOSTIC_STARTED:${created.diagnosticRunId}`,
                payload: {
                  diagnosticRunId: created.diagnosticRunId,
                  assessmentSessionId: input.sessionId ?? null,
                  initialTargetId: input.targetConceptId,
                  maximumLength: MAX,
                },
              },
              tx,
            );
          }
          return created;
        })
      : (async (fn: any) => fn(this.db))(async (tx: any) => {
          return tx.diagnosticRun.create({
            data: {
              userId,
              academicVersionId: input.academicVersionId,
              rootTargetConceptId: input.targetConceptId,
              currentTargetConceptId: input.targetConceptId,
              currentDifficulty: 'MEDIUM',
              sessionId: input.sessionId,
              processedResponseIds: [],
              conceptEvidence: { [input.targetConceptId]: empty() },
              path: [input.targetConceptId],
              policyVersion: POLICY,
            },
          });
        }));
    await this.audit(userId, 'DIAGNOSTIC_STARTED', run.diagnosticRunId, {
      versionId: input.academicVersionId,
      targetConceptId: input.targetConceptId,
      policyVersion: POLICY,
    });
    return this.next(userId, run.diagnosticRunId);
  }

  async get(userId: string, id: string) {
    const run = await this.owned(userId, id);
    return this.safe(run);
  }

  async next(userId: string, id: string) {
    const run = await this.owned(userId, id);
    if (run.status !== 'ACTIVE') return this.safe(run);
    if (run.questionCount >= MAX)
      return this.finish(userId, run.diagnosticRunId, 'MAX_QUESTIONS_REACHED');
    if (run.currentQuestionVersionId) return this.safe(run);
    let selected: NonNullable<
      Awaited<ReturnType<QuestionSelectionService['select']>>
    >;
    try {
      selected = (await this.selection.select({
        userId,
        syllabusVersionId: run.academicVersionId,
        examId: (
          await this.db.syllabusVersion.findUniqueOrThrow({
            where: { canonicalId: run.academicVersionId },
          })
        ).examId,
        subjectId: (
          await this.db.syllabusVersion.findUniqueOrThrow({
            where: { canonicalId: run.academicVersionId },
          })
        ).subjectId,
        conceptIds: [run.currentTargetConceptId],
        questionType: 'MULTIPLE_CHOICE',
        targetDifficulty: run.currentDifficulty as Difficulty,
        sessionId: run.sessionId ?? undefined,
        excludeQuestionVersionIds: await this.usedQuestions(id),
      }))!;
    } catch {
      return this.finish(userId, id, 'NO_ELIGIBLE_CANDIDATE');
    }
    let placementId: string | null = null;
    if (run.sessionId) {
      const placement = await this.assessments.placeQuestion(
        userId,
        run.sessionId,
        {
          questionVersionId: selected.questionVersionId,
          ordinal: run.questionCount,
          section: 'diagnostic',
          selectionReference: selected.explanation.selectionReasonCode,
        },
      );
      placementId = placement.assessmentSessionPlacementId;
      const session = await this.assessments.getSession(userId, run.sessionId);
      if (session?.state === 'READY')
        await this.assessments.start(userId, run.sessionId);
    }
    const updated = await this.db.diagnosticRun.updateMany({
      where: {
        diagnosticRunId: id,
        userId,
        status: 'ACTIVE',
        lockVersion: run.lockVersion,
        currentQuestionVersionId: null,
      },
      data: {
        currentQuestionVersionId: selected.questionVersionId,
        currentPlacementId: placementId,
        lockVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) diagnosticConcurrency();
    await this.audit(userId, 'DIAGNOSTIC_TARGET_SELECTED', id, {
      targetConceptId: run.currentTargetConceptId,
      questionVersionId: selected.questionVersionId,
      requestedDifficulty: run.currentDifficulty,
      selectionReason: selected.explanation.selectionReasonCode,
    });
    return this.safe(
      await this.db.diagnosticRun.findUniqueOrThrow({
        where: { diagnosticRunId: id },
      }),
    );
  }

  async answer(
    userId: string,
    id: string,
    input: {
      sessionId: string;
      placementId: string;
      idempotencyKey: string;
      selectedOption?: string | null;
      questionVersionId?: string;
    },
  ) {
    const run = await this.owned(userId, id);
    if (run.status !== 'ACTIVE') diagnosticState();
    if (
      input.sessionId !== run.sessionId ||
      input.placementId !== run.currentPlacementId
    )
      diagnosticInvalid('Diagnostic placement is invalid.');
    if (
      !run.currentQuestionVersionId ||
      (input.questionVersionId &&
        input.questionVersionId !== run.currentQuestionVersionId)
    )
      diagnosticInvalid('Unexpected diagnostic question.');
    const transaction = async (tx: any) => {
      const scored = await this.responses.submit(userId, input, tx);
      if (run.processedResponseIds.includes(scored.responseId))
        return this.safe(run);
      const response = await tx.assessmentResponse.findUnique({
        where: { assessmentResponseId: scored.responseId },
        select: { correctness: true, questionVersionId: true },
      });
      if (!response) diagnosticInvalid('Scored response is unavailable.');
      const evidence = JSON.parse(
        JSON.stringify(run.conceptEvidence),
      ) as Record<string, Evidence>;
      const current = evidence[run.currentTargetConceptId] ?? empty();
      if (response!.correctness === 'CORRECT') current.correct += 1;
      else if (response!.correctness === 'INCORRECT') current.incorrect += 1;
      else current.unanswered += 1;
      current.classification =
        current.correct >= 2 &&
        current.classification !== 'GAP_INDICATED' &&
        (run.currentDifficulty === 'MEDIUM' || run.currentDifficulty === 'HARD')
          ? 'SUPPORTED'
          : current.incorrect >= 2
            ? 'GAP_INDICATED'
            : 'INSUFFICIENT_EVIDENCE';
      evidence[run.currentTargetConceptId] = current;
      const nextDifficulty =
        response!.correctness === 'CORRECT'
          ? higher(run.currentDifficulty as Difficulty)
          : response!.correctness === 'INCORRECT'
            ? lower(run.currentDifficulty as Difficulty)
            : (run.currentDifficulty as Difficulty);
      const count = run.questionCount + 1;
      let target = run.currentTargetConceptId;
      let path = JSON.parse(JSON.stringify(run.path)) as string[];
      let stop: any = null;
      if (
        current.classification === 'SUPPORTED' &&
        target === run.rootTargetConceptId
      )
        stop = 'SUFFICIENT_TARGET_EVIDENCE';
      else if (current.classification === 'GAP_INDICATED') {
        const prereqs = await this.graph.directPrerequisites(target, {
          versionId: run.academicVersionId,
        });
        const chosen = prereqs.find(
          (p) =>
            !evidence[p.canonicalId] ||
            evidence[p.canonicalId].classification === 'INSUFFICIENT_EVIDENCE',
        );
        if (chosen) {
          target = chosen.canonicalId;
          evidence[target] ??= empty();
          path = [...path, target];
        } else stop = 'GAP_LOCALIZED';
      }
      if (!stop && count >= MAX) stop = 'MAX_QUESTIONS_REACHED';
      const mutate = async (tx: any) => {
        const updated = await tx.diagnosticRun.updateMany({
          where: {
            diagnosticRunId: id,
            userId,
            status: 'ACTIVE',
            lockVersion: run.lockVersion,
          },
          data: {
            processedResponseIds: { push: scored.responseId },
            questionCount: count,
            conceptEvidence: evidence as Prisma.InputJsonValue,
            currentTargetConceptId: target,
            currentDifficulty: stop
              ? run.currentDifficulty
              : current.classification === 'GAP_INDICATED' ||
                  current.classification === 'SUPPORTED'
                ? 'MEDIUM'
                : nextDifficulty,
            path,
            currentQuestionVersionId: null,
            currentPlacementId: null,
            ...(stop
              ? {
                  status: stop === 'USER_STOPPED' ? 'STOPPED' : 'COMPLETED',
                  stopReason: stop,
                  completedAt: new Date(),
                }
              : {}),
            lockVersion: { increment: 1 },
          },
        });
        if (this.learningEvents && updated.count === 1) {
          const predecessor = await tx.learningEvent.findFirst({
            where: {
              sourceAggregateId: scored.responseId,
              eventType: 'RESPONSE_SCORED',
            },
            select: { eventId: true },
          });
          await this.learningEvents.append(
            {
              eventType: 'DIAGNOSTIC_ANSWER_PROCESSED',
              schemaVersion: 1,
              occurredAt: new Date(),
              learnerUserId: userId,
              actorUserId: userId,
              sourceComponent: 'C016',
              sourceAggregateType: 'DiagnosticRun',
              sourceAggregateId: id,
              correlationId: id,
              causationId: predecessor?.eventId ?? null,
              academicContext: {
                syllabusVersionId: run.academicVersionId,
                questionVersionId: response!.questionVersionId,
              },
              idempotencyKey: `C016:DIAGNOSTIC_ANSWER_PROCESSED:${id}:${scored.responseId}`,
              payload: {
                diagnosticRunId: id,
                responseId: scored.responseId,
                questionVersionId: response!.questionVersionId,
                correctness: response!.correctness,
                processedCount: count,
              },
            },
            tx,
          );
        }
        return updated;
      };
      const updated = await mutate(tx);
      if (updated.count !== 1) diagnosticConcurrency();
      if (stop)
        await this.audit(userId, 'DIAGNOSTIC_STOPPED', id, {
          stopReason: stop,
          questionCount: count,
        });
      else
        await this.audit(userId, 'DIAGNOSTIC_EVIDENCE_CONSUMED', id, {
          responseId: scored.responseId,
          correctness: response!.correctness,
          questionCount: count,
        });
      return { responseId: scored.responseId, count };
    };
    await (this.db.$transaction
      ? this.db.$transaction(transaction)
      : transaction(this.db));
    return this.next(userId, id);
  }

  async stop(userId: string, id: string) {
    const run = await this.owned(userId, id);
    if (run.status !== 'ACTIVE') return this.safe(run);
    await this.db.diagnosticRun.updateMany({
      where: {
        diagnosticRunId: id,
        userId,
        status: 'ACTIVE',
        lockVersion: run.lockVersion,
      },
      data: {
        status: 'STOPPED',
        stopReason: 'USER_STOPPED',
        completedAt: new Date(),
        lockVersion: { increment: 1 },
      },
    });
    return this.get(userId, id);
  }
  private async usedQuestions(id: string) {
    const run = await this.db.diagnosticRun.findUniqueOrThrow({
      where: { diagnosticRunId: id },
    });
    const rows = await this.db.assessmentResponse.findMany({
      where: { assessmentSessionId: run.sessionId ?? undefined },
      select: { questionVersionId: true },
    });
    return rows.map((r) => r.questionVersionId);
  }
  private async owned(userId: string, id: string) {
    const run = await this.db.diagnosticRun.findUnique({
      where: { diagnosticRunId: id },
    });
    if (!run) diagnosticNotFound();
    if (run!.userId !== userId) diagnosticForbidden();
    return run!;
  }
  private finish(userId: string, id: string, reason: any) {
    const operation = async (tx: any) => {
      const updated = await tx.diagnosticRun.update({
        where: { diagnosticRunId: id },
        data: {
          status: 'COMPLETED',
          stopReason: reason,
          completedAt: new Date(),
        },
      });
      if (this.learningEvents)
        await this.learningEvents.append(
          {
            eventType: 'DIAGNOSTIC_COMPLETED',
            schemaVersion: 1,
            occurredAt: updated.completedAt ?? new Date(),
            learnerUserId: userId,
            actorUserId: userId,
            sourceComponent: 'C016',
            sourceAggregateType: 'DiagnosticRun',
            sourceAggregateId: id,
            correlationId: id,
            academicContext: { syllabusVersionId: updated.academicVersionId },
            idempotencyKey: `C016:DIAGNOSTIC_COMPLETED:${id}:${String(reason)}`,
            payload: {
              diagnosticRunId: id,
              assessmentSessionId: updated.sessionId,
              stopReasonCode: reason,
              processedCount: updated.questionCount,
            },
          },
          tx,
        );
      await this.audit(userId, 'DIAGNOSTIC_STOPPED', id, {
        stopReason: reason,
        questionCount: updated.questionCount,
      });
      return this.safe(updated);
    };
    return this.db.$transaction
      ? this.db.$transaction(operation)
      : operation(this.db);
  }
  private safe(run: any) {
    return {
      diagnosticRunId: run.diagnosticRunId,
      status: run.status,
      academicVersionId: run.academicVersionId,
      rootTargetConceptId: run.rootTargetConceptId,
      currentTargetConceptId: run.currentTargetConceptId,
      currentDifficulty: run.currentDifficulty,
      currentQuestionVersionId: run.currentQuestionVersionId,
      questionCount: run.questionCount,
      conceptEvidence: run.conceptEvidence,
      stopReason: run.stopReason,
      policyVersion: run.policyVersion,
    };
  }
  private async audit(
    userId: string,
    action: string,
    id: string,
    metadata: any,
  ) {
    await this.db.auditEvent.create({
      data: {
        actorUserId: userId,
        subjectUserId: userId,
        action,
        resourceType: 'DIAGNOSTIC_RUN',
        resourceId: id,
        metadata,
      },
    });
    if (!this.learningEvents && this.db.learningEvent?.create) {
      const map: Record<string, string> = {
        DIAGNOSTIC_STARTED: 'DIAGNOSTIC_STARTED',
        DIAGNOSTIC_EVIDENCE_CONSUMED: 'DIAGNOSTIC_ANSWER_PROCESSED',
        DIAGNOSTIC_STOPPED: 'DIAGNOSTIC_COMPLETED',
      };
      const eventType = map[action];
      if (eventType) {
        const payload: any =
          eventType === 'DIAGNOSTIC_STARTED'
            ? {
                diagnosticRunId: id,
                assessmentSessionId:
                  metadata.sessionId ?? metadata.assessmentSessionId ?? null,
                initialTargetId: metadata.targetConceptId ?? null,
                maximumLength: 12,
              }
            : eventType === 'DIAGNOSTIC_ANSWER_PROCESSED'
              ? {
                  diagnosticRunId: id,
                  responseId: metadata.responseId ?? id,
                  questionVersionId: metadata.questionVersionId ?? 'unknown',
                  correctness: metadata.correctness ?? 'UNKNOWN',
                  processedCount: metadata.processedCount ?? 0,
                }
              : {
                  diagnosticRunId: id,
                  assessmentSessionId: metadata.sessionId ?? null,
                  stopReasonCode: metadata.reason ?? action,
                  processedCount: metadata.processedCount ?? 0,
                };
        await this.db.learningEvent
          .create({
            data: {
              eventType,
              schemaVersion: 1,
              occurredAt: new Date(),
              learnerUserId: userId,
              actorUserId: userId,
              sourceComponent: 'C016',
              sourceAggregateType: 'DiagnosticRun',
              sourceAggregateId: id,
              correlationId: id,
              idempotencyKey: `C016:${eventType}:${id}:${metadata.responseId ?? metadata.reason ?? 'root'}`,
              academicContext: {
                syllabusVersionId:
                  metadata.versionId ?? metadata.academicVersionId ?? null,
              },
              payload,
            },
          })
          .catch((e: any) => {
            if (e?.code !== 'P2002') throw e;
          });
      }
    }
  }
}
