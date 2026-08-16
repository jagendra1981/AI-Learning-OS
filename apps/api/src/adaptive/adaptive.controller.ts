import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { AdaptiveService, AdaptiveScope } from './adaptive.service';
import { AdaptiveSource } from './adaptive.projector';
@Controller()
@UseGuards(AuthGuard)
export class AdaptiveController {
  constructor(private readonly adaptive: AdaptiveService) {}
  private scope(
    req: AuthenticatedRequest,
    contextId: string,
    academicVersionId: string,
  ): AdaptiveScope {
    if (!contextId || !academicVersionId)
      throw new BadRequestException({ code: 'INVALID_SCOPE' });
    return { learnerId: req.auth!.userId, contextId, academicVersionId };
  }
  @Post('api/v1/adaptive/process') process(
    @Req() r: AuthenticatedRequest,
    @Body()
    b: { contextId: string; academicVersionId: string; source: AdaptiveSource },
  ) {
    return this.adaptive.process(
      r.auth!.userId,
      this.scope(r, b.contextId, b.academicVersionId),
      { ...b.source, effectiveAt: new Date(b.source.effectiveAt) },
    );
  }
  @Get('api/v1/recommendations/next') current(
    @Req() r: AuthenticatedRequest,
    @Query('contextId') c: string,
    @Query('academicVersionId') a: string,
  ) {
    return this.adaptive.current(r.auth!.userId, this.scope(r, c, a));
  }
  @Get('api/v1/adaptive/history') history(
    @Req() r: AuthenticatedRequest,
    @Query('contextId') c: string,
    @Query('academicVersionId') a: string,
  ) {
    return this.adaptive.history(r.auth!.userId, this.scope(r, c, a));
  }
  @Post('api/v1/adaptive/rebuild') rebuild(
    @Req() r: AuthenticatedRequest,
    @Body() b: { contextId: string; academicVersionId: string },
  ) {
    return this.adaptive.rebuild(
      r.auth!.userId,
      this.scope(r, b.contextId, b.academicVersionId),
    );
  }
}
