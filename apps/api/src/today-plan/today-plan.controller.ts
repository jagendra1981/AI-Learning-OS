import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { TodayPlanService } from './today-plan.service';
type PlanScopeBody = {
  contextId: string;
  academicVersionId: string;
  planDateLocal: string;
  learnerTimezone: string;
};
type GenerateBody = PlanScopeBody & {
  eventId: string;
  authoritativeNow: string;
};
type CompleteBody = {
  completionEvidenceRef: string;
  completionEventId: string;
  effectiveAt: string;
};
type PostponeBody = {
  postponeEventId: string;
  reasonCode: string;
  requestedDateLocal: string;
  effectiveAt: string;
};
type ReplanBody = PlanScopeBody & {
  replanEventId: string;
  effectiveAt: string;
  reason?: string;
};
@Controller('api/v1/today-plan')
@UseGuards(AuthGuard)
export class TodayPlanController {
  constructor(private readonly plans: TodayPlanService) {}
  private scope(
    r: AuthenticatedRequest,
    b: {
      contextId: string;
      academicVersionId: string;
      planDateLocal: string;
      learnerTimezone: string;
    },
  ) {
    if (
      !r.auth ||
      !b.contextId ||
      !b.academicVersionId ||
      !b.planDateLocal ||
      !b.learnerTimezone
    )
      throw new Error('INVALID_SCOPE');
    return { learnerId: r.auth.userId, ...b };
  }
  @Post('generate') generate(
    @Req() r: AuthenticatedRequest,
    @Body() b: GenerateBody,
  ) {
    return this.plans.generate(
      r.auth!.userId,
      this.scope(r, b),
      b.eventId,
      new Date(b.authoritativeNow),
    );
  }
  @Get() get(@Req() r: AuthenticatedRequest, @Query() b: PlanScopeBody) {
    return this.plans.get(r.auth!.userId, this.scope(r, b));
  }
  @Post('items/:id/complete') complete(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() b: CompleteBody,
  ) {
    return this.plans.complete(
      r.auth!.userId,
      id,
      b.completionEvidenceRef,
      b.completionEventId,
      new Date(b.effectiveAt),
    );
  }
  @Post('items/:id/postpone') postpone(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() b: PostponeBody,
  ) {
    return this.plans.postpone(
      r.auth!.userId,
      id,
      b.postponeEventId,
      b.reasonCode,
      b.requestedDateLocal,
      new Date(b.effectiveAt),
    );
  }
  @Post('replan') replan(
    @Req() r: AuthenticatedRequest,
    @Body() b: ReplanBody,
  ) {
    return this.plans.replan(
      r.auth!.userId,
      this.scope(r, b),
      b.replanEventId,
      new Date(b.effectiveAt),
      b.reason,
    );
  }
}
