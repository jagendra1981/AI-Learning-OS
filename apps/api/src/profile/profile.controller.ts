/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { Prisma } from '@prisma/client';

// C007's externally frozen readiness definition. Legal prose is intentionally
// not stored in or exposed by the service.
export const REQUIRED_CONSENT_DEFINITION = Object.freeze({
  consentType: 'LEARNING',
  policyVersion: 'C027',
});
const invalid = (): never => {
  throw new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'Check the highlighted fields.',
  });
};
const checked = (body: any, fields: string[]) => {
  if (
    !body ||
    typeof body !== 'object' ||
    Object.keys(body).some((k) => !fields.includes(k))
  )
    invalid();
  return body;
};
const validYear = (v: unknown) => {
  if (!Number.isInteger(v) || (v as number) < 2024 || (v as number) > 2100)
    invalid();
  return v as number;
};
@Controller('api/v1/profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly db: DatabaseService) {}
  private audit(
    userId: string,
    action: string,
    type: string,
    id?: string,
    metadata?: object,
  ) {
    return this.db.auditEvent.create({
      data: {
        actorUserId: userId,
        subjectUserId: userId,
        action,
        resourceType: type,
        resourceId: id,
        metadata,
      },
    });
  }
  private async readinessFacts(
    tx: Prisma.TransactionClient,
    userId: string,
    profile: { targetExamId: string | null; targetYear: number | null },
  ) {
    const year = profile.targetYear;
    const goal =
      profile.targetExamId && profile.targetYear
        ? await tx.examGoal.findFirst({
            where: {
              userId,
              examId: profile.targetExamId,
              targetYear: profile.targetYear,
            },
          })
        : null;
    const consent = await tx.consentRecord.findFirst({
      where: {
        userId,
        consentType: REQUIRED_CONSENT_DEFINITION.consentType,
        policyVersion: REQUIRED_CONSENT_DEFINITION.policyVersion,
        state: 'GRANTED',
        revokedAt: null,
      },
      orderBy: { recordedAt: 'desc' },
    });
    return {
      profileComplete: Boolean(
        profile.targetExamId?.trim() &&
        Number.isInteger(year) &&
        year !== null &&
        year >= 2024 &&
        year <= 2100,
      ),
      goalComplete: Boolean(goal),
      consentComplete: Boolean(consent),
    };
  }
  private async reconcileReadiness(
    tx: Prisma.TransactionClient,
    userId: string,
    before: string,
    facts: {
      profileComplete: boolean;
      goalComplete: boolean;
      consentComplete: boolean;
    },
    reason: string,
  ) {
    const next = !facts.consentComplete
      ? 'CONSENT_REQUIRED'
      : !facts.profileComplete || !facts.goalComplete
        ? 'PROFILE_IN_PROGRESS'
        : 'READY_FOR_DIAGNOSTIC';
    if (next === before) return;
    await tx.studentProfile.updateMany({
      where: { userId, onboardingState: before as any },
      data: { onboardingState: next },
    });
    if (next === 'READY_FOR_DIAGNOSTIC' && before !== 'READY_FOR_DIAGNOSTIC') {
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'ONBOARDING_READINESS_RESTORED',
          resourceType: 'StudentProfile',
          metadata: {
            reason: 'PREREQUISITES_RESTORED',
            from: before,
            to: next,
          },
        },
      });
      return;
    }
    if (before !== 'READY_FOR_DIAGNOSTIC') return;
    await tx.auditEvent.create({
      data: {
        actorUserId: userId,
        subjectUserId: userId,
        action: 'ONBOARDING_READINESS_REVOKED',
        resourceType: 'StudentProfile',
        metadata: { reason, from: before, to: next },
      },
    });
  }
  @Get() async get(@Req() req: AuthenticatedRequest) {
    const p = await this.db.studentProfile.findUnique({
      where: { userId: req.auth!.userId },
    });
    return p
      ? {
          studentId: p.studentId,
          targetExamId: p.targetExamId,
          targetYear: p.targetYear,
          availabilityProfile: p.availabilityProfile,
          onboardingState: p.onboardingState,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        }
      : null;
  }
  @Post() async create(@Req() req: AuthenticatedRequest, @Body() body: any) {
    const b = checked(body, [
      'targetExamId',
      'targetYear',
      'availabilityProfile',
    ]);
    if (
      b.targetExamId !== undefined &&
      (typeof b.targetExamId !== 'string' ||
        !b.targetExamId.trim() ||
        b.targetExamId.length > 100)
    )
      invalid();
    if (b.targetYear !== undefined) validYear(b.targetYear);
    try {
      const p = await this.db.studentProfile.create({
        data: {
          userId: req.auth!.userId,
          targetExamId: b.targetExamId?.trim(),
          targetYear: b.targetYear,
          availabilityProfile: b.availabilityProfile,
        },
      });
      await this.audit(
        req.auth!.userId,
        'PROFILE_CREATED',
        'StudentProfile',
        p.studentId,
      );
      return this.get(req);
    } catch {
      throw new ConflictException({
        code: 'PROFILE_EXISTS',
        message: 'Profile already exists.',
      });
    }
  }
  @Patch() async update(@Req() req: AuthenticatedRequest, @Body() body: any) {
    const b = checked(body, [
      'targetExamId',
      'targetYear',
      'availabilityProfile',
    ]);
    if (
      b.targetExamId !== undefined &&
      (typeof b.targetExamId !== 'string' ||
        !b.targetExamId.trim() ||
        b.targetExamId.length > 100)
    )
      invalid();
    if (b.targetYear !== undefined) validYear(b.targetYear);
    const p = await this.db.$transaction(async (tx) => {
      const existing = await tx.studentProfile.findUnique({
        where: { userId: req.auth!.userId },
      });
      const p = await tx.studentProfile.upsert({
        where: { userId: req.auth!.userId },
        create: {
          userId: req.auth!.userId,
          targetExamId: b.targetExamId?.trim(),
          targetYear: b.targetYear,
          availabilityProfile: b.availabilityProfile,
          onboardingState: 'PROFILE_IN_PROGRESS',
        },
        update: {
          ...b,
          targetExamId: b.targetExamId?.trim(),
          ...(existing?.onboardingState === 'READY_FOR_DIAGNOSTIC'
            ? {}
            : { onboardingState: 'PROFILE_IN_PROGRESS' }),
        },
      });
      const facts = await this.readinessFacts(tx, req.auth!.userId, p);
      await this.reconcileReadiness(
        tx,
        req.auth!.userId,
        existing?.onboardingState ?? 'NOT_STARTED',
        facts,
        'PROFILE_TARGET_CHANGED',
      );
      await tx.auditEvent.create({
        data: {
          actorUserId: req.auth!.userId,
          subjectUserId: req.auth!.userId,
          action: 'PROFILE_UPDATED',
          resourceType: 'StudentProfile',
          resourceId: p.studentId,
        },
      });
      return p;
    });
    return {
      studentId: p.studentId,
      targetExamId: p.targetExamId,
      targetYear: p.targetYear,
      availabilityProfile: p.availabilityProfile,
      onboardingState: p.onboardingState,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
  @Post('onboarding/finalize') async finalize(
    @Req() req: AuthenticatedRequest,
    @Body() body: any,
  ) {
    checked(body, []);
    return this.db.$transaction(async (tx) => {
      const p = await tx.studentProfile.findUnique({
        where: { userId: req.auth!.userId },
      });
      if (!p)
        throw new ConflictException({
          code: 'ONBOARDING_PROFILE_INCOMPLETE',
          message: 'Complete onboarding to continue.',
        });
      if (p.onboardingState === 'READY_FOR_DIAGNOSTIC')
        return { state: p.onboardingState };
      if (
        !['NOT_STARTED', 'PROFILE_IN_PROGRESS', 'CONSENT_REQUIRED'].includes(
          p.onboardingState,
        )
      )
        throw new ConflictException({
          code: 'ONBOARDING_STATE_CONFLICT',
          message: 'Refresh onboarding to continue.',
        });
      const facts = await this.readinessFacts(tx, req.auth!.userId, p);
      if (!facts.profileComplete)
        throw new ConflictException({
          code: 'ONBOARDING_PROFILE_INCOMPLETE',
          message: 'Complete onboarding to continue.',
        });
      if (!facts.goalComplete)
        throw new ConflictException({
          code: 'ONBOARDING_EXAM_GOAL_REQUIRED',
          message: 'Set an exam goal to continue.',
        });
      if (!facts.consentComplete)
        throw new ConflictException({
          code: 'ONBOARDING_CONSENT_REQUIRED',
          message: 'Required consent is needed to continue.',
        });
      const updated = await tx.studentProfile.updateMany({
        where: { userId: req.auth!.userId, onboardingState: p.onboardingState },
        data: { onboardingState: 'READY_FOR_DIAGNOSTIC' },
      });
      if (updated.count !== 1)
        throw new ConflictException({
          code: 'ONBOARDING_STATE_CONFLICT',
          message: 'Refresh onboarding to continue.',
        });
      await tx.auditEvent.create({
        data: {
          actorUserId: req.auth!.userId,
          subjectUserId: req.auth!.userId,
          action: 'ONBOARDING_READY_FOR_DIAGNOSTIC',
          resourceType: 'StudentProfile',
          resourceId: p.studentId,
          metadata: { from: p.onboardingState, to: 'READY_FOR_DIAGNOSTIC' },
        },
      });
      return { state: 'READY_FOR_DIAGNOSTIC' };
    });
  }
  @Get('onboarding') async onboarding(@Req() req: AuthenticatedRequest) {
    const p = await this.db.studentProfile.findUnique({
      where: { userId: req.auth!.userId },
      select: { onboardingState: true },
    });
    return { state: p?.onboardingState ?? 'NOT_STARTED' };
  }
  @Post('consents') async consent(
    @Req() req: AuthenticatedRequest,
    @Body() body: any,
  ) {
    const b = checked(body, ['consentType', 'policyVersion']);
    if (
      typeof b.consentType !== 'string' ||
      !b.consentType ||
      typeof b.policyVersion !== 'string' ||
      !b.policyVersion
    )
      invalid();
    const c = await this.db.$transaction(async (tx) => {
      const c = await tx.consentRecord.create({
        data: {
          userId: req.auth!.userId,
          consentType: b.consentType,
          policyVersion: b.policyVersion,
          state: 'GRANTED',
        },
      });
      const p = await tx.studentProfile.findUnique({
        where: { userId: req.auth!.userId },
      });
      if (p)
        await this.reconcileReadiness(
          tx,
          req.auth!.userId,
          p.onboardingState,
          await this.readinessFacts(tx, req.auth!.userId, p),
          'CONSENT_INVALIDATED',
        );
      await tx.auditEvent.create({
        data: {
          actorUserId: req.auth!.userId,
          subjectUserId: req.auth!.userId,
          action: 'CONSENT_GRANTED',
          resourceType: 'ConsentRecord',
          resourceId: c.consentId,
          metadata: {
            consentType: c.consentType,
            policyVersion: c.policyVersion,
          },
        },
      });
      return c;
    });
    return {
      consentId: c.consentId,
      consentType: c.consentType,
      state: c.state,
      policyVersion: c.policyVersion,
      recordedAt: c.recordedAt,
      revokedAt: c.revokedAt,
    };
  }
  @Get('consents') consents(@Req() req: AuthenticatedRequest) {
    return this.db.consentRecord.findMany({
      where: { userId: req.auth!.userId },
      select: {
        consentId: true,
        consentType: true,
        state: true,
        policyVersion: true,
        recordedAt: true,
        revokedAt: true,
      },
      orderBy: { recordedAt: 'asc' },
    });
  }
  @Post('consents/:consentId/withdraw') async withdraw(
    @Req() req: AuthenticatedRequest,
    @Param('consentId') id: string,
  ) {
    const result = await this.db.$transaction(async (tx) => {
      const result = await tx.consentRecord.updateMany({
        where: { consentId: id, userId: req.auth!.userId, state: 'GRANTED' },
        data: { state: 'WITHDRAWN', revokedAt: new Date() },
      });
      if (result.count === 1) {
        const p = await tx.studentProfile.findUnique({
          where: { userId: req.auth!.userId },
        });
        if (p)
          await this.reconcileReadiness(
            tx,
            req.auth!.userId,
            p.onboardingState,
            await this.readinessFacts(tx, req.auth!.userId, p),
            'CONSENT_INVALIDATED',
          );
      }
      if (result.count === 1)
        await tx.auditEvent.create({
          data: {
            actorUserId: req.auth!.userId,
            subjectUserId: req.auth!.userId,
            action: 'CONSENT_WITHDRAWN',
            resourceType: 'ConsentRecord',
            resourceId: id,
          },
        });
      return result;
    });
    if (result.count !== 1)
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        message: 'This consent has changed. Refresh to continue.',
      });
    return { consentId: id, state: 'WITHDRAWN' };
  }
  @Post('exam-goals') async goal(
    @Req() req: AuthenticatedRequest,
    @Body() body: any,
  ) {
    const b = checked(body, ['examId', 'targetYear']);
    if (
      typeof b.examId !== 'string' ||
      !b.examId.trim() ||
      b.examId.length > 100
    )
      invalid();
    validYear(b.targetYear);
    const g = await this.db.$transaction(async (tx) => {
      const g = await tx.examGoal.upsert({
        where: {
          userId_examId: { userId: req.auth!.userId, examId: b.examId.trim() },
        },
        create: {
          userId: req.auth!.userId,
          examId: b.examId.trim(),
          targetYear: b.targetYear,
        },
        update: { targetYear: b.targetYear },
      });
      const p = await tx.studentProfile.findUnique({
        where: { userId: req.auth!.userId },
      });
      if (p)
        await this.reconcileReadiness(
          tx,
          req.auth!.userId,
          p.onboardingState,
          await this.readinessFacts(tx, req.auth!.userId, p),
          'EXAM_GOAL_INVALIDATED',
        );
      await tx.auditEvent.create({
        data: {
          actorUserId: req.auth!.userId,
          subjectUserId: req.auth!.userId,
          action: 'EXAM_GOAL_CHANGED',
          resourceType: 'ExamGoal',
          resourceId: g.examGoalId,
          metadata: { examId: g.examId, targetYear: g.targetYear },
        },
      });
      return g;
    });
    return {
      examGoalId: g.examGoalId,
      examId: g.examId,
      targetYear: g.targetYear,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    };
  }
  @Get('exam-goals') goals(@Req() req: AuthenticatedRequest) {
    return this.db.examGoal.findMany({
      where: { userId: req.auth!.userId },
      select: {
        examGoalId: true,
        examId: true,
        targetYear: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
