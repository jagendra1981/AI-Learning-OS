/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { AssessmentService } from '../assessment/assessment.service';
import { QuestionSelectionService } from '../question-selection/question-selection.service';
import {
  ResponseService,
  SubmitResponseInput,
} from '../assessment/response.service';
import { LearningEventService } from '../learning-event/learning-event.service';
import {
  testConflict,
  testForbidden,
  testInvalid,
  testNotFound,
} from './test.errors';

export type CreateTestInput = {
  testType: 'TOPIC' | 'CHAPTER' | 'CUSTOM';
  academicVersionId: string;
  examId: string;
  subjectId: string;
  targetScope: {
    syllabusNodeId?: string;
    chapterId?: string;
    conceptIds?: string[];
    objectiveIds?: string[];
  };
  requestedQuestionCount: number;
  durationSeconds: number;
};

@Injectable()
export class TestService {
  constructor(
    private readonly db: DatabaseService,
    private readonly assessments: AssessmentService,
    private readonly selection: QuestionSelectionService,
    @Optional() responses?: ResponseService,
    @Optional() learningEvents?: LearningEventService,
  ) {
    this.responses = responses;
    this.learningEvents = learningEvents ?? new LearningEventService(db);
  }
  private readonly responses?: ResponseService;
  private readonly learningEvents: LearningEventService;

  async create(ownerUserId: string, input: CreateTestInput) {
    if (
      !ownerUserId ||
      !input ||
      !['TOPIC', 'CHAPTER', 'CUSTOM'].includes(input.testType) ||
      !Number.isInteger(input.requestedQuestionCount) ||
      input.requestedQuestionCount < 1 ||
      input.requestedQuestionCount > 100 ||
      !Number.isInteger(input.durationSeconds) ||
      input.durationSeconds <= 0
    )
      testInvalid();
    const version = await this.db.syllabusVersion.findUnique({
      where: { canonicalId: input.academicVersionId },
    });
    if (
      !version ||
      version.status !== 'ACTIVE' ||
      version.examId !== input.examId ||
      version.subjectId !== input.subjectId
    )
      testInvalid('Academic version is invalid.');
    const scope = input.targetScope ?? {};
    if (
      input.testType === 'TOPIC' &&
      (!scope.syllabusNodeId ||
        scope.chapterId ||
        scope.conceptIds?.length ||
        scope.objectiveIds?.length)
    )
      testInvalid('Topic scope is invalid.');
    if (
      input.testType === 'CHAPTER' &&
      (!scope.chapterId ||
        scope.syllabusNodeId ||
        scope.conceptIds?.length ||
        scope.objectiveIds?.length)
    )
      testInvalid('Chapter scope is invalid.');
    if (
      input.testType === 'CUSTOM' &&
      !((scope.conceptIds?.length ?? 0) || (scope.objectiveIds?.length ?? 0))
    )
      testInvalid('Custom scope must contain approved targets.');
    await this.validateScope(input);
    const template = await this.assessments.createTemplate(ownerUserId, {
      canonicalId: `C018-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      versionNumber: 1,
      title: 'C018 test',
      assessmentType: input.testType,
      syllabusVersionId: input.academicVersionId,
      examId: input.examId,
      subjectId: input.subjectId,
      durationSeconds: input.durationSeconds,
      structure: {
        testType: input.testType,
        requestedQuestionCount: input.requestedQuestionCount,
      },
      status: 'PUBLISHED',
    });
    const session = await this.assessments.createSession(
      ownerUserId,
      template.assessmentTemplateId,
    );
    const ids: string[] = [];
    const chapterNodes =
      input.testType === 'CHAPTER'
        ? (
            await this.db.syllabusVersionNode.findMany({
              where: {
                versionId: input.academicVersionId,
                syllabusNode: { chapterId: scope.chapterId! },
              },
              orderBy: { syllabusNodeId: 'asc' },
              select: { syllabusNodeId: true },
            })
          ).map((n: any) => n.syllabusNodeId)
        : [];
    for (let ordinal = 0; ordinal < input.requestedQuestionCount; ordinal++) {
      const selected = await this.selection.select({
        userId: ownerUserId,
        syllabusVersionId: input.academicVersionId,
        examId: input.examId,
        subjectId: input.subjectId,
        syllabusNodeId:
          input.testType === 'CHAPTER'
            ? chapterNodes[ordinal % chapterNodes.length]
            : scope.syllabusNodeId,
        conceptIds: scope.conceptIds,
        objectiveIds: scope.objectiveIds,
        questionType: 'MULTIPLE_CHOICE',
        count: 1,
        excludeQuestionVersionIds: ids,
        sessionId: session.assessmentSessionId,
      });
      if (!selected) testInvalid('Question selection failed.');
      ids.push(selected!.questionVersionId);
      await this.assessments.placeQuestion(
        ownerUserId,
        session.assessmentSessionId,
        {
          questionVersionId: selected!.questionVersionId,
          ordinal,
          selectionReference: selected!.explanation.selectionReasonCode,
        },
      );
    }
    const test = await this.db.testDefinition.create({
      data: {
        ownerUserId,
        assessmentSessionId: session.assessmentSessionId,
        academicVersionId: input.academicVersionId,
        testType: input.testType,
        targetScope: scope,
        requestedQuestionCount: input.requestedQuestionCount,
        durationSeconds: input.durationSeconds,
        selectionContext: { pinnedQuestionVersionIds: ids },
      },
    });
    await this.audit(ownerUserId, 'TEST_CREATED', test.testId, {
      testType: input.testType,
      academicVersionId: input.academicVersionId,
      questionCount: ids.length,
    });
    return test;
  }

  private async validateScope(input: CreateTestInput) {
    const s = input.targetScope;
    if (input.testType === 'TOPIC') {
      const n = await this.db.syllabusVersionNode.findUnique({
        where: {
          versionId_syllabusNodeId: {
            versionId: input.academicVersionId,
            syllabusNodeId: s.syllabusNodeId!,
          },
        },
        include: { syllabusNode: true },
      });
      if (!n) testInvalid('Topic is not in the academic version.');
    } else if (input.testType === 'CHAPTER') {
      const count = await this.db.syllabusVersionNode.count({
        where: {
          versionId: input.academicVersionId,
          syllabusNode: { chapterId: s.chapterId! },
        },
      });
      if (!count) testInvalid('Chapter is not in the academic version.');
    } else {
      const concepts = s.conceptIds ?? [],
        objectives = s.objectiveIds ?? [];
      const [c, o] = await Promise.all([
        this.db.syllabusVersionConcept.count({
          where: {
            versionId: input.academicVersionId,
            conceptId: { in: concepts },
          },
        }),
        this.db.objectiveConceptMapping.count({
          where: {
            versionId: input.academicVersionId,
            objectiveId: { in: objectives },
          },
        }),
      ]);
      if (c !== new Set(concepts).size || o < objectives.length)
        testInvalid(
          'Custom scope contains an unapproved or cross-version target.',
        );
    }
  }

  async get(ownerUserId: string, testId: string) {
    const t = await this.db.testDefinition.findUnique({
      where: { testId },
      include: {
        assessmentSession: {
          include: { placements: { orderBy: { ordinal: 'asc' } } },
        },
      },
    });
    if (!t) testNotFound();
    if (t!.ownerUserId !== ownerUserId) testForbidden();
    return this.safe(t);
  }
  async start(ownerUserId: string, testId: string) {
    const operation = async (tx: Prisma.TransactionClient) => {
      const t = await tx.testDefinition.findUnique({
        where: { testId },
      });
      if (!t) testNotFound();
      if (t!.ownerUserId !== ownerUserId) testForbidden();
      if (t!.state !== 'READY') testConflict();
      const s = await this.assessments.start(
        ownerUserId,
        t!.assessmentSessionId,
        tx,
      );
      await tx.testDefinition.update({
        where: { testId },
        data: {
          state: 'ACTIVE',
          startedAt: s!.startedAt,
          expiresAt: s!.expiresAt,
        },
      });
      await this.audit(
        ownerUserId,
        'TEST_STARTED',
        testId,
        {
          state: 'READY',
          nextState: 'ACTIVE',
          assessmentSessionId: t!.assessmentSessionId,
          academicVersionId: t!.academicVersionId,
          testType: t!.testType,
          scopeType: t!.testType,
          scopeId: t!.targetScope,
          questionCount: t!.requestedQuestionCount,
        },
        tx,
      );
    };
    await this.db.$transaction(operation);
    return this.get(ownerUserId, testId);
  }

  async respond(
    ownerUserId: string,
    testId: string,
    input: SubmitResponseInput,
  ) {
    if (!this.responses) testInvalid();
    const operation = async (tx: Prisma.TransactionClient) => {
      const test = await tx.testDefinition.findUnique({
        where: { testId },
        include: { assessmentSession: true },
      });
      if (!test) testNotFound();
      if (test!.ownerUserId !== ownerUserId) testForbidden();
      if (test!.state !== 'ACTIVE') testConflict();
      if (input.sessionId !== test!.assessmentSessionId)
        testInvalid('Assessment session is not bound to this test.');

      const placement = await tx.assessmentSessionPlacement.findUnique({
        where: { assessmentSessionPlacementId: input.placementId },
        select: {
          assessmentSessionId: true,
          questionVersionId: true,
          attemptNumber: true,
        },
      });
      if (
        !placement ||
        placement.assessmentSessionId !== test!.assessmentSessionId ||
        (input.questionVersionId &&
          input.questionVersionId !== placement.questionVersionId)
      )
        testInvalid('Placement is not bound to this test.');

      const response = await this.responses!.submit(ownerUserId, input, tx);
      const row = await tx.assessmentResponse.findUnique({
        where: { assessmentResponseId: response.responseId },
        select: {
          assessmentResponseId: true,
          correctness: true,
          score: true,
          questionVersionId: true,
          submittedAt: true,
        },
      });
      if (!row) testInvalid('Response was not persisted.');
      const scored = await tx.learningEvent.findFirst({
        where: {
          eventType: 'RESPONSE_SCORED',
          sourceComponent: 'C015',
          sourceAggregateId: response.responseId,
          learnerUserId: ownerUserId,
        },
        orderBy: { recordedAt: 'asc' },
        select: { eventId: true },
      });
      if (!scored) testInvalid('Authoritative scoring evidence is missing.');
      const eventInput = {
        eventType: 'TEST_RESPONSE_PROCESSED',
        schemaVersion: 1,
        occurredAt: row!.submittedAt,
        learnerUserId: ownerUserId,
        actorUserId: ownerUserId,
        sourceComponent: 'C018',
        sourceAggregateType: 'TestDefinition',
        sourceAggregateId: testId,
        correlationId: test!.assessmentSessionId,
        causationId: scored!.eventId,
        academicContext: {
          syllabusVersionId: test!.assessmentSession.syllabusVersionId,
          questionVersionId: row!.questionVersionId,
        },
        idempotencyKey: `C018:TEST_RESPONSE_PROCESSED:${testId}:${response.responseId}`,
        payload: {
          testDefinitionId: testId,
          assessmentSessionId: test!.assessmentSessionId,
          responseId: response.responseId,
          placementId: input.placementId,
          questionVersionId: row!.questionVersionId,
          correctness: row!.correctness,
          answered: row!.correctness !== 'UNANSWERED',
          awardedScore: row!.score,
          maximumScore: 4,
        },
      } as const;
      const eventKey = eventInput.idempotencyKey;
      const existingEvent = await tx.learningEvent.findUnique({
        where: { idempotencyKey: eventKey },
      });
      const event =
        existingEvent ?? (await this.learningEvents!.append(eventInput, tx));
      return { response, event };
    };
    const result = await this.db.$transaction(operation);
    return result.response;
  }
  async complete(ownerUserId: string, testId: string) {
    const operation = async (tx: Prisma.TransactionClient) => {
      const t = await tx.testDefinition.findUnique({
        where: { testId },
      });
      if (!t) testNotFound();
      if (t!.ownerUserId !== ownerUserId) testForbidden();
      if (t!.state === 'COMPLETED') return;
      if (t!.state !== 'ACTIVE') testConflict();
      const s = await this.assessments.complete(
        ownerUserId,
        t!.assessmentSessionId,
        tx,
      );
      await tx.testDefinition.update({
        where: { testId },
        data: { state: 'COMPLETED', completedAt: s!.endedAt },
      });
      const [placements, responses, started] = await Promise.all([
        tx.assessmentSessionPlacement.count({
          where: { assessmentSessionId: t!.assessmentSessionId },
        }),
        tx.assessmentResponse.findMany({
          where: { assessmentSessionId: t!.assessmentSessionId },
          select: { correctness: true, score: true },
        }),
        tx.learningEvent.findFirst({
          where: {
            eventType: 'TEST_STARTED',
            sourceAggregateId: testId,
            learnerUserId: ownerUserId,
          },
          orderBy: { recordedAt: 'asc' },
          select: { eventId: true },
        }),
      ]);
      const answered = responses.filter(
        (r) => r.correctness !== 'UNANSWERED',
      ).length;
      const correct = responses.filter(
        (r) => r.correctness === 'CORRECT',
      ).length;
      const incorrect = responses.filter(
        (r) => r.correctness === 'INCORRECT',
      ).length;
      const awarded = responses.reduce((sum, r) => sum + r.score, 0);
      await this.audit(
        ownerUserId,
        'TEST_COMPLETED',
        testId,
        {
          state: 'ACTIVE',
          nextState: 'COMPLETED',
          assessmentSessionId: t!.assessmentSessionId,
          academicVersionId: t!.academicVersionId,
          questionCount: placements,
          answeredCount: answered,
          correctCount: correct,
          incorrectCount: incorrect,
          unansweredCount: placements - answered,
          awardedScore: awarded,
          maximumScore: placements * 4,
        },
        tx,
        false,
      );
      const eventInput = {
        eventType: 'TEST_COMPLETED',
        schemaVersion: 1,
        occurredAt: s!.endedAt!,
        learnerUserId: ownerUserId,
        actorUserId: ownerUserId,
        sourceComponent: 'C018',
        sourceAggregateType: 'TestDefinition',
        sourceAggregateId: testId,
        correlationId: testId,
        causationId: started?.eventId ?? null,
        academicContext: { academicVersionId: t!.academicVersionId },
        idempotencyKey: `C018:TEST_COMPLETED:${testId}`,
        payload: {
          testDefinitionId: testId,
          assessmentSessionId: t!.assessmentSessionId,
          completionReasonCode: 'COMPLETED',
          questionCount: placements,
          answeredCount: answered,
          correctCount: correct,
          incorrectCount: incorrect,
          unansweredCount: placements - answered,
          awardedScore: awarded,
          maximumScore: placements * 4,
        },
      } as const;
      const existing = await tx.learningEvent.findUnique({
        where: { idempotencyKey: eventInput.idempotencyKey },
      });
      if (!existing) await this.learningEvents.append(eventInput, tx);
    };
    await this.db.$transaction(operation);
    return this.get(ownerUserId, testId);
  }
  async result(ownerUserId: string, testId: string) {
    const t = await this.get(ownerUserId, testId);
    const session = await this.db.assessmentSession.findUnique({
      where: { assessmentSessionId: t.assessmentSessionId },
      include: {
        placements: {
          orderBy: { ordinal: 'asc' },
          include: {
            questionVersion: {
              select: {
                questionVersionId: true,
                syllabusNodeId: true,
                learningObjectiveId: true,
                concepts: {
                  where: { approved: true },
                  select: { conceptId: true },
                },
                difficulty: { select: { authorDifficulty: true } },
              },
            },
          },
        },
      },
    });
    const rows = await this.db.assessmentResponse.findMany({
      where: { assessmentSessionId: t.assessmentSessionId },
      select: {
        correctness: true,
        score: true,
        placementId: true,
        questionVersionId: true,
        submittedAt: true,
      },
    });
    const total = t.placements.length,
      answered = rows.filter((r: any) => r.correctness !== 'UNANSWERED').length,
      correct = rows.filter((r: any) => r.correctness === 'CORRECT').length,
      incorrect = rows.filter((r: any) => r.correctness === 'INCORRECT').length,
      awarded = rows.reduce((n: number, r: any) => n + r.score, 0),
      maximum = total * 4;
    const responseByPlacement = new Map(
      rows.map((row: any) => [row.placementId, row]),
    );
    const buckets = new Map<string, any>();
    const add = (dimension: string, key: string, row: any) => {
      const id = `${dimension}:${key}`;
      const b = buckets.get(id) ?? {
        dimension,
        key,
        questionCount: 0,
        answeredCount: 0,
        correctCount: 0,
        incorrectCount: 0,
        unansweredCount: 0,
        awardedScore: 0,
        maximumPossibleScore: 0,
      };
      b.questionCount++;
      b.maximumPossibleScore += 4;
      if (!row) b.unansweredCount++;
      else {
        b.answeredCount += row.correctness === 'UNANSWERED' ? 0 : 1;
        b.correctCount += row.correctness === 'CORRECT' ? 1 : 0;
        b.incorrectCount += row.correctness === 'INCORRECT' ? 1 : 0;
        b.unansweredCount += row.correctness === 'UNANSWERED' ? 1 : 0;
        b.awardedScore += row.score;
      }
      buckets.set(id, b);
    };
    for (const placement of session?.placements ?? []) {
      const row = responseByPlacement.get(
        placement.assessmentSessionPlacementId,
      );
      const q: any = placement.questionVersion;
      add('scope', 'TEST', row);
      add('topic', q.syllabusNodeId, row);
      for (const c of q.concepts) add('concept', c.conceptId, row);
      if (q.learningObjectiveId) add('objective', q.learningObjectiveId, row);
      if (q.difficulty?.authorDifficulty)
        add('difficulty', String(q.difficulty.authorDifficulty), row);
    }
    const breakdown = [...buckets.values()].map((b) => ({
      ...b,
      accuracy: b.answeredCount ? (b.correctCount / b.answeredCount) * 100 : 0,
    }));
    const releasedBreakdown =
      t.state === 'ACTIVE' && rows.length > 0
        ? breakdown.map((b) => ({
            dimension: b.dimension,
            key: b.key,
            questionCount: b.questionCount,
            answeredCount: 0,
            correctCount: 0,
            incorrectCount: 0,
            unansweredCount: b.questionCount,
            awardedScore: null,
            maximumPossibleScore: null,
            accuracy: null,
          }))
        : breakdown;
    return {
      testId,
      questionCount: total,
      answeredCount: t.state === 'ACTIVE' && rows.length > 0 ? 0 : answered,
      correctCount: t.state === 'ACTIVE' && rows.length > 0 ? 0 : correct,
      incorrectCount: t.state === 'ACTIVE' && rows.length > 0 ? 0 : incorrect,
      unansweredCount: t.state === 'ACTIVE' && rows.length > 0 ? total : total - answered,
      totalAwardedScore: t.state === 'COMPLETED' ? awarded : null,
      maximumPossibleScore: t.state === 'COMPLETED' ? maximum : null,
      percentage: t.state === 'COMPLETED' ? (maximum ? (awarded / maximum) * 100 : 0) : null,
      state: t.state,
      breakdown: releasedBreakdown,
    };
  }
  async autopsy(ownerUserId: string, testId: string) {
    const t = await this.get(ownerUserId, testId);
    const r = await this.result(ownerUserId, testId);
    if (t.state === 'ACTIVE') return { ...r, scope: t.targetScope, questions: [] };
    const rows = await this.db.assessmentResponse.findMany({
      where: { assessmentSessionId: t.assessmentSessionId },
      select: {
        questionVersionId: true,
        correctness: true,
        score: true,
        submittedAt: true,
      },
    });
    return {
      ...r,
      scope: t.targetScope,
      questions: rows.map((x: any) => ({
        questionVersionId: x.questionVersionId,
        outcome: x.correctness,
        awardedScore: x.score,
        submittedAt: x.submittedAt,
      })),
    };
  }
  private async audit(
    ownerUserId: string,
    action: string,
    resourceId: string,
    metadata: any,
    transactionClient?: Prisma.TransactionClient,
    emitLearningEvent = true,
  ) {
    const db = transactionClient ?? this.db;
    await db.auditEvent.create({
      data: {
        actorUserId: ownerUserId,
        subjectUserId: ownerUserId,
        action,
        resourceType: 'TEST',
        resourceId,
        metadata,
      },
    });
    if (emitLearningEvent && db.learningEvent?.create) {
      const eventType =
        action === 'TEST_STARTED'
          ? 'TEST_STARTED'
          : action === 'TEST_COMPLETED'
            ? 'TEST_COMPLETED'
            : undefined;
      if (eventType) {
        const payload: any =
          eventType === 'TEST_STARTED'
            ? {
                testDefinitionId: resourceId,
                assessmentSessionId: metadata.assessmentSessionId ?? resourceId,
                testType: metadata.testType ?? 'UNKNOWN',
                scopeType: metadata.scopeType ?? 'UNKNOWN',
                scopeId: metadata.scopeId ?? null,
                questionCount: metadata.questionCount ?? 0,
              }
            : {
                testDefinitionId: resourceId,
                assessmentSessionId: metadata.assessmentSessionId ?? resourceId,
                completionReasonCode: metadata.reason ?? action,
                questionCount: metadata.questionCount ?? 0,
                answeredCount: metadata.answeredCount ?? 0,
                correctCount: metadata.correctCount ?? 0,
                incorrectCount: metadata.incorrectCount ?? 0,
                unansweredCount: metadata.unansweredCount ?? 0,
                awardedScore: metadata.awardedScore ?? 0,
                maximumScore: metadata.maximumScore ?? 0,
              };
        await db.learningEvent
          .create({
            data: {
              eventType,
              schemaVersion: 1,
              occurredAt: new Date(),
              learnerUserId: ownerUserId,
              actorUserId: ownerUserId,
              sourceComponent: 'C018',
              sourceAggregateType: 'TestDefinition',
              sourceAggregateId: resourceId,
              correlationId: resourceId,
              idempotencyKey: `C018:${eventType}:${resourceId}`,
              academicContext: {
                academicVersionId: metadata.academicVersionId ?? null,
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
  private safe(t: any) {
    return {
      testId: t.testId,
      ownerUserId: t.ownerUserId,
      assessmentSessionId: t.assessmentSessionId,
      academicVersionId: t.academicVersionId,
      testType: t.testType,
      targetScope: t.targetScope,
      requestedQuestionCount: t.requestedQuestionCount,
      durationSeconds: t.durationSeconds,
      state: t.state,
      createdAt: t.createdAt,
      startedAt: t.startedAt,
      expiresAt: t.expiresAt,
      completedAt: t.completedAt,
      placements:
        t.assessmentSession?.placements?.map((p: any) => ({
          placementId: p.assessmentSessionPlacementId,
          questionVersionId: p.questionVersionId,
          ordinal: p.ordinal,
        })) ?? [],
    };
  }
}
