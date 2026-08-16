import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import {
  selectionConflict,
  selectionUnknownVersion,
  selectionValidation,
} from './question-selection.errors';

const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];
const MAX_STAGE_ROWS = 200;
const MAX_HISTORY = 20;
const idPattern = /^[A-Z][A-Z0-9_-]{1,127}$/;
const userIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidPattern = userIdPattern;
const reasonCodes = [
  'SELECT_EXACT',
  'SELECT_DIFFICULTY_FALLBACK_1',
  'SELECT_DIFFICULTY_FALLBACK_2',
  'SELECT_EXPOSURE_RELAXED',
  'SELECT_EXPOSURE_DIFFICULTY_FALLBACK_1',
  'SELECT_EXPOSURE_DIFFICULTY_FALLBACK_2',
] as const;

export type SelectionRequest = {
  userId: string;
  syllabusVersionId: string;
  examId: string;
  subjectId: string;
  syllabusNodeId?: string;
  conceptIds?: string[];
  objectiveIds?: string[];
  questionType?: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'NUMERIC' | 'SUBJECTIVE';
  targetDifficulty?: Difficulty;
  excludeQuestionVersionIds?: string[];
  sessionId?: string;
  count?: 1;
  selectionSeed?: number | string;
};

function validId(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value);
}
function validOpaqueId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (idPattern.test(value) || uuidPattern.test(value))
  );
}
function difficultyOrder(target: Difficulty): Difficulty[] {
  return target === 'EASY'
    ? ['EASY', 'MEDIUM', 'HARD']
    : target === 'HARD'
      ? ['HARD', 'MEDIUM', 'EASY']
      : ['MEDIUM', 'EASY', 'HARD'];
}
function difficulty(value: number | null | undefined): Difficulty | null {
  return value === 1
    ? 'EASY'
    : value === 2
      ? 'MEDIUM'
      : value === 3
        ? 'HARD'
        : null;
}

@Injectable()
export class QuestionSelectionService {
  constructor(private readonly db: DatabaseService) {}

  private validate(request: SelectionRequest) {
    if (
      !request ||
      typeof request.userId !== 'string' ||
      !userIdPattern.test(request.userId) ||
      !validId(request.syllabusVersionId) ||
      !validId(request.examId) ||
      !validId(request.subjectId)
    )
      selectionValidation('Invalid selection request.');
    if (request.count !== undefined && request.count !== 1)
      selectionValidation('Only one question may be selected.');
    if (
      request.targetDifficulty !== undefined &&
      !DIFFICULTIES.includes(request.targetDifficulty)
    )
      selectionValidation('Unsupported difficulty.');
    for (const key of [
      request.syllabusNodeId,
      ...(request.conceptIds ?? []),
      ...(request.objectiveIds ?? []),
      ...(request.excludeQuestionVersionIds ?? []),
    ].filter((value): value is string => value !== undefined))
      if (!validOpaqueId(key))
        selectionValidation('Invalid canonical identifier.');
    if (
      (request.conceptIds?.length ?? 0) > 20 ||
      (request.objectiveIds?.length ?? 0) > 20 ||
      (request.excludeQuestionVersionIds?.length ?? 0) > 100
    )
      selectionValidation('Selection list exceeds its bound.');
    if (
      new Set(request.excludeQuestionVersionIds ?? []).size !==
      (request.excludeQuestionVersionIds ?? []).length
    )
      selectionValidation('Malformed exclusion list.');
  }

  async select(request: SelectionRequest) {
    this.validate(request);
    const target = request.targetDifficulty ?? 'MEDIUM';
    const version = await this.db.syllabusVersion.findUnique({
      where: { canonicalId: request.syllabusVersionId },
    });
    if (
      !version ||
      version.status !== 'ACTIVE' ||
      version.examId !== request.examId ||
      version.subjectId !== request.subjectId
    )
      selectionUnknownVersion();
    const resolvedVersion = version!;
    if (request.conceptIds?.length) {
      const concepts = await this.db.academicConcept.findMany({
        where: { canonicalId: { in: request.conceptIds } },
        select: { canonicalId: true },
      });
      if (concepts.length !== new Set(request.conceptIds).size)
        selectionValidation('Unknown concept identifier.');
    }
    if (request.objectiveIds?.length) {
      const objectives = await this.db.learningObjective.findMany({
        where: { canonicalId: { in: request.objectiveIds } },
        select: { canonicalId: true },
      });
      if (objectives.length !== new Set(request.objectiveIds).size)
        selectionValidation('Unknown learning objective identifier.');
    }
    const recent = await this.db.questionExposure.findMany({
      where: {
        userId: request.userId,
        syllabusVersionId: resolvedVersion.canonicalId,
      },
      orderBy: [{ selectedAt: 'desc' }, { questionExposureId: 'desc' }],
      take: MAX_HISTORY,
      select: { questionVersionId: true, selectedAt: true },
    });
    const recentMap = new Map(
      recent.map((row) => [row.questionVersionId, row.selectedAt]),
    );
    const base: Prisma.QuestionVersionWhereInput = {
      status: 'PUBLISHED',
      question: { examId: request.examId, subjectId: request.subjectId },
      syllabusNode: {
        versionMemberships: {
          some: { versionId: resolvedVersion.canonicalId },
        },
      },
      rights: { rightsStatus: 'VERIFIED' },
      provenance: { verificationStatus: { in: ['verified', 'VERIFIED'] } },
      solutions: { some: {} },
      concepts: {
        some: {
          approved: true,
          ...(request.conceptIds?.length
            ? { conceptId: { in: request.conceptIds } }
            : {}),
        },
      },
      ...(request.syllabusNodeId
        ? { syllabusNodeId: request.syllabusNodeId }
        : {}),
      ...(request.objectiveIds?.length
        ? { learningObjectiveId: { in: request.objectiveIds } }
        : {}),
      ...(request.questionType ? { questionType: request.questionType } : {}),
      ...(request.excludeQuestionVersionIds?.length
        ? { questionVersionId: { notIn: request.excludeQuestionVersionIds } }
        : {}),
    };
    const rows = await this.db.questionVersion.findMany({
      where: base,
      orderBy: { questionVersionId: 'asc' },
      take: MAX_STAGE_ROWS,
      select: {
        questionVersionId: true,
        difficulty: { select: { authorDifficulty: true } },
      },
    });
    const candidates = rows
      .map((r) => ({
        id: r.questionVersionId,
        difficulty: difficulty(r.difficulty?.authorDifficulty),
        exposedAt: recentMap.get(r.questionVersionId) ?? null,
      }))
      .filter((r) => r.difficulty);
    const order = difficultyOrder(target);
    const stages = [
      ...order.map((d, i) => ({ d, relaxed: false, i })),
      ...order.map((d, i) => ({ d, relaxed: true, i })),
    ];
    for (const stage of stages) {
      const pool = candidates.filter(
        (c) => c.difficulty === stage.d && (stage.relaxed || !c.exposedAt),
      );
      if (!pool.length) continue;
      pool.sort((a, b) =>
        stage.relaxed
          ? (a.exposedAt ? a.exposedAt.getTime() : -Infinity) -
              (b.exposedAt ? b.exposedAt.getTime() : -Infinity) ||
            a.id.localeCompare(b.id)
          : a.id.localeCompare(b.id),
      );
      const reason = reasonCodes[stage.relaxed ? 3 + stage.i : stage.i];
      const selected = pool[0];
      return this.db.$transaction(async (tx) => {
        await tx.questionExposure.create({
          data: {
            userId: request.userId,
            questionVersionId: selected.id,
            syllabusVersionId: resolvedVersion.canonicalId,
            sessionId: request.sessionId,
            selectionReasonCode: reason,
          },
        });
        return {
          questionVersionId: selected.id,
          explanation: {
            selectionReasonCode: reason,
            resolvedSyllabusVersionId: resolvedVersion.canonicalId,
            selectedQuestionVersionId: selected.id,
            requestedDifficulty: target,
            selectedDifficulty: selected.difficulty,
            fallbackStage: `F${stage.relaxed ? stage.i + 3 : stage.i}`,
            recentlyExposed: Boolean(selected.exposedAt),
            candidateCountAtStage: pool.length,
            appliedFilterCodes: [
              'PUBLISHED',
              'VERSION_MATCH',
              'EXAM_MATCH',
              'SUBJECT_MATCH',
              'PROVENANCE_VALID',
              'EXPLICIT_EXCLUSIONS',
              'EXPOSURE_POLICY',
            ],
          },
        };
      });
    }
    selectionConflict();
  }
}
