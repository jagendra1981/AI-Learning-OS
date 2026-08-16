/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { ConfigurationService } from './configuration.service';
@Controller('api/v1/configuration')
@UseGuards(AuthGuard)
export class ConfigurationController {
  constructor(private readonly service: ConfigurationService) {}
  @Post('drafts') draft(@Req() r: AuthenticatedRequest, @Body() b: any) {
    return this.service.createDraft(r.auth!.userId, b);
  }
  @Post('versions/:id/changes') change(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    return this.service.upsertChange(
      r.auth!.userId,
      id,
      b.changeKey,
      b.afterValue,
      b.reason,
      b.beforeValue,
    );
  }
  @Post('versions/:id/submit') submit(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.submit(r.auth!.userId, id);
  }
  @Post('versions/:id/decision') decide(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    return this.service.decide(
      r.auth!.userId,
      id,
      b.decision,
      b.reason,
      b.correlationId,
    );
  }
  @Post('versions/:id/publish') publish(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    return this.service.publish(r.auth!.userId, id, b.reason, b.correlationId);
  }
  @Get('current') current(
    @Req() r: AuthenticatedRequest,
    @Query('examId') examId: string,
    @Query('subjectId') subjectId: string,
  ) {
    return this.service.current(r.auth!.userId, examId, subjectId);
  }
  @Get('versions/:id') exact(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.byId(r.auth!.userId, id);
  }
  @Get('versions/:id/review') review(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.reviewDetail(r.auth!.userId, id);
  }
  @Post('versions/:id/rollback') rollback(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() b: any,
  ) {
    return this.service.rollback(r.auth!.userId, id, b.reason, b.correlationId);
  }
}
