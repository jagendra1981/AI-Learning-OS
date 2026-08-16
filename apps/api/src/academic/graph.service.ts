import { Injectable } from '@nestjs/common';
import { AcademicRelationshipType, Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { GraphValidationError } from './graph.errors';

export const C009_MAX_TRAVERSAL_DEPTH = 8;
export type GraphConcept = { canonicalId: string; name: string };
export type GraphVersionOptions = {
  versionId?: unknown;
  examId?: unknown;
  subjectId?: unknown;
};

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_-]{1,127}$/.test(value))
    throw new GraphValidationError(
      'INVALID_CANONICAL_ID',
      'Invalid concept identifier.',
    );
  return value;
}

function depth(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) <= 0)
    throw new GraphValidationError(
      'INVALID_DEPTH',
      'Traversal depth must be a positive integer.',
    );
  if ((value as number) > C009_MAX_TRAVERSAL_DEPTH)
    throw new GraphValidationError(
      'DEPTH_LIMIT_EXCEEDED',
      'Traversal depth exceeds the server limit.',
    );
  return value as number;
}

@Injectable()
export class GraphService {
  constructor(private readonly db: DatabaseService) {}

  private async resolveVersion(options: GraphVersionOptions = {}) {
    const examId = options.examId ?? 'JEE_MAIN';
    const subjectId = options.subjectId ?? 'PHYSICS';
    if (typeof examId !== 'string' || typeof subjectId !== 'string')
      throw new GraphValidationError(
        'VERSION_SCOPE_MISMATCH',
        'Invalid version scope.',
      );
    if (options.versionId !== undefined) {
      if (
        typeof options.versionId !== 'string' ||
        !/^[A-Z][A-Z0-9_-]{1,127}$/.test(options.versionId)
      )
        throw new GraphValidationError(
          'INVALID_VERSION',
          'Invalid syllabus version.',
        );
      const version = await this.db.syllabusVersion.findUnique({
        where: { canonicalId: options.versionId },
      });
      if (!version)
        throw new GraphValidationError(
          'UNKNOWN_VERSION',
          'Syllabus version was not found.',
        );
      if (version.examId !== examId || version.subjectId !== subjectId)
        throw new GraphValidationError(
          'VERSION_SCOPE_MISMATCH',
          'Syllabus version is outside the requested scope.',
        );
      return version;
    }
    const version = await this.db.syllabusVersion.findFirst({
      where: { examId, subjectId, status: 'ACTIVE', current: true },
      orderBy: { canonicalId: 'asc' },
    });
    if (!version)
      throw new GraphValidationError(
        'UNKNOWN_VERSION',
        'No current active syllabus version is available.',
      );
    return version;
  }

  private async requireConcept(canonicalId: string) {
    const concept = await this.db.academicConcept.findUnique({
      where: { canonicalId },
    });
    if (!concept)
      throw new GraphValidationError(
        'CONCEPT_NOT_FOUND',
        'Concept was not found.',
      );
    return concept;
  }

  async directPrerequisites(
    rawId: unknown,
    options?: GraphVersionOptions,
  ): Promise<GraphConcept[]> {
    const canonicalId = id(rawId);
    const version = await this.resolveVersion(options);
    await this.requireConcept(canonicalId);
    const rows = await this.db.conceptRelationship.findMany({
      where: {
        versionId: version.canonicalId,
        targetId: canonicalId,
        type: AcademicRelationshipType.PREREQUISITE_OF,
      },
      orderBy: { sourceId: 'asc' },
      select: { source: { select: { canonicalId: true, name: true } } },
    });
    return rows.map(({ source }) => source);
  }

  async directDependents(
    rawId: unknown,
    options?: GraphVersionOptions,
  ): Promise<GraphConcept[]> {
    const canonicalId = id(rawId);
    const version = await this.resolveVersion(options);
    await this.requireConcept(canonicalId);
    const rows = await this.db.conceptRelationship.findMany({
      where: {
        versionId: version.canonicalId,
        sourceId: canonicalId,
        type: AcademicRelationshipType.PREREQUISITE_OF,
      },
      orderBy: { targetId: 'asc' },
      select: { target: { select: { canonicalId: true, name: true } } },
    });
    return rows.map(({ target }) => target);
  }

  private async traverse(
    startRaw: unknown,
    maxDepthRaw: unknown,
    upstream: boolean,
    options?: GraphVersionOptions,
  ) {
    const start = id(startRaw);
    const maxDepth = depth(maxDepthRaw);
    const version = await this.resolveVersion(options);
    await this.requireConcept(start);
    const seen = new Set([start]);
    const result = new Map<string, GraphConcept>();
    let frontier = [start];
    for (let level = 0; level < maxDepth && frontier.length; level += 1) {
      const rows = upstream
        ? await this.db.conceptRelationship.findMany({
            where: {
              versionId: version.canonicalId,
              targetId: { in: frontier },
              type: AcademicRelationshipType.PREREQUISITE_OF,
            },
            orderBy: { sourceId: 'asc' },
            select: { source: { select: { canonicalId: true, name: true } } },
          })
        : await this.db.conceptRelationship.findMany({
            where: {
              versionId: version.canonicalId,
              sourceId: { in: frontier },
              type: AcademicRelationshipType.PREREQUISITE_OF,
            },
            orderBy: { targetId: 'asc' },
            select: { target: { select: { canonicalId: true, name: true } } },
          });
      const next: string[] = [];
      for (const row of rows) {
        const concept = upstream
          ? (row as { source: GraphConcept }).source
          : (row as { target: GraphConcept }).target;
        if (!seen.has(concept.canonicalId)) {
          seen.add(concept.canonicalId);
          result.set(concept.canonicalId, concept);
          next.push(concept.canonicalId);
        }
      }
      frontier = next;
    }
    return [...result.values()].sort((a, b) =>
      a.canonicalId.localeCompare(b.canonicalId),
    );
  }

  upstreamPrerequisites(
    idValue: unknown,
    maxDepth: unknown,
    options?: GraphVersionOptions,
  ) {
    return this.traverse(idValue, maxDepth, true, options);
  }
  downstreamDependents(
    idValue: unknown,
    maxDepth: unknown,
    options?: GraphVersionOptions,
  ) {
    return this.traverse(idValue, maxDepth, false, options);
  }

  async validatePrerequisiteEdge(
    rawSource: unknown,
    rawTarget: unknown,
    tx: Prisma.TransactionClient | DatabaseService = this.db,
    options?: GraphVersionOptions,
  ) {
    const sourceId = id(rawSource);
    const targetId = id(rawTarget);
    const version = await this.resolveVersion(options);
    if (sourceId === targetId)
      throw new GraphValidationError(
        'SELF_EDGE',
        'A concept cannot prerequisite itself.',
      );
    await tx.academicConcept.findUniqueOrThrow({
      where: { canonicalId: sourceId },
    });
    await tx.academicConcept.findUniqueOrThrow({
      where: { canonicalId: targetId },
    });
    const members = await tx.syllabusVersionConcept.findMany({
      where: {
        versionId: version.canonicalId,
        conceptId: { in: [sourceId, targetId] },
      },
      select: { conceptId: true },
    });
    if (new Set(members.map((member) => member.conceptId)).size !== 2)
      throw new GraphValidationError(
        'VERSION_SCOPE_MISMATCH',
        'Relationship endpoints must belong to the same syllabus version.',
      );
    const reachable = await this.traverseFrom(
      tx,
      targetId,
      sourceId,
      version.canonicalId,
    );
    if (reachable)
      throw new GraphValidationError(
        'CYCLE_DETECTED',
        'The prerequisite edge would create a cycle.',
      );
  }

  private async traverseFrom(
    tx: Prisma.TransactionClient | DatabaseService,
    start: string,
    sought: string,
    versionId: string,
  ) {
    const seen = new Set([start]);
    let frontier = [start];
    for (
      let level = 0;
      level < C009_MAX_TRAVERSAL_DEPTH && frontier.length;
      level += 1
    ) {
      const rows = await tx.conceptRelationship.findMany({
        where: {
          versionId,
          sourceId: { in: frontier },
          type: AcademicRelationshipType.PREREQUISITE_OF,
        },
        orderBy: { targetId: 'asc' },
        select: { targetId: true },
      });
      const next: string[] = [];
      for (const row of rows) {
        if (row.targetId === sought) return true;
        if (!seen.has(row.targetId)) {
          seen.add(row.targetId);
          next.push(row.targetId);
        }
      }
      frontier = next;
    }
    return false;
  }
}
