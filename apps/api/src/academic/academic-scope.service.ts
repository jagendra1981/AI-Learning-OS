import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Prisma } from '@prisma/client';
export type ScopeDecision = 'VISIBLE' | 'FORBIDDEN' | 'NOT_FOUND';
export type AcademicScope = { learnerId: string; contextId: string; academicVersionId: string };
@Injectable()
export class AcademicScopeService {
  constructor(private readonly db: DatabaseService) {}
  async resolve(scope: AcademicScope, db: DatabaseService | Prisma.TransactionClient = this.db): Promise<ScopeDecision> {
    if (!scope.learnerId || !scope.contextId || !scope.academicVersionId) return 'NOT_FOUND';
    const { learnerId, contextId, academicVersionId } = scope;
    const own = await db.academicScope.findUnique({ where: { learnerId_contextId_academicVersionId: { learnerId, contextId, academicVersionId } } });
    if (own?.status === 'ACTIVE') return 'VISIBLE';
    if (own?.status === 'REVOKED') return 'NOT_FOUND';
    const foreign = await db.academicScope.findFirst({ where: { contextId, academicVersionId, status: 'ACTIVE' }, select: { learnerId: true } });
    return foreign ? 'FORBIDDEN' : 'NOT_FOUND';
  }
}
