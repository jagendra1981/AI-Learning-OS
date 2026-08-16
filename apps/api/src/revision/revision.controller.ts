import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { RevisionService } from './revision.service';
@Controller('api/v1/revision')
@UseGuards(AuthGuard)
export class RevisionController {
  constructor(private readonly revisions: RevisionService) {}
  private scope(
    req: AuthenticatedRequest,
    conceptId: string,
    contextId: string,
    academicVersionId: string,
  ) {
    if (!conceptId || !contextId || !academicVersionId)
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'scope is required.',
      });
    return {
      learnerId: req.auth!.userId,
      conceptId,
      contextId,
      academicVersionId,
    };
  }
  @Get('concepts/:conceptId') current(
    @Req() req: AuthenticatedRequest,
    @Param('conceptId') conceptId: string,
    @Query('contextId') contextId: string,
    @Query('academicVersionId') academicVersionId: string,
    @Query('referenceTime') referenceTime: string,
  ) {
    const at = new Date(referenceTime);
    if (!referenceTime || Number.isNaN(at.getTime()))
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'referenceTime is required.',
      });
    return this.revisions.current(
      req.auth!.userId,
      this.scope(req, conceptId, contextId, academicVersionId),
      at,
    );
  }
  @Get('concepts/:conceptId/history') history(
    @Req() req: AuthenticatedRequest,
    @Param('conceptId') conceptId: string,
    @Query('contextId') contextId: string,
    @Query('academicVersionId') academicVersionId: string,
  ) {
    return this.revisions.history(
      req.auth!.userId,
      this.scope(req, conceptId, contextId, academicVersionId),
    );
  }
}
