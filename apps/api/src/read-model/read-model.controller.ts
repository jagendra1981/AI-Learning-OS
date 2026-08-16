import {
  Controller,
  Get,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { ReadModelService } from './read-model.service';
import { AcademicScopeService } from '../academic/academic-scope.service';
import { ReadModelError } from './read-model.errors';
import { HttpStatus } from '@nestjs/common';
import { ReadModelExceptionFilter } from './read-model.filter';
import {
  MistakeQuery,
  ProgressQuery,
  ReadQuery,
  RevisionQuery,
  TodayQuery,
} from './read-model.dto';
@Controller('api/v1/read-model')
@UseGuards(AuthGuard)
@UseFilters(ReadModelExceptionFilter)
export class ReadModelController {
  constructor(
    private readonly reads: ReadModelService,
    private readonly scopes: AcademicScopeService,
  ) {}
  private async scope(r: AuthenticatedRequest, q: ReadQuery) {
    const decision = await this.scopes.resolve({
      learnerId: r.auth!.userId,
      contextId: q.contextId ?? '',
      academicVersionId: q.academicVersion ?? '',
    });
    if (decision === 'FORBIDDEN')
      throw new ReadModelError(
        'FORBIDDEN',
        HttpStatus.FORBIDDEN,
        'Access to this scope is forbidden.',
      );
    if (decision !== 'VISIBLE')
      throw new ReadModelError(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        'Requested scope was not found.',
      );
  }
  @Get('twin') async twin(
    @Req() r: AuthenticatedRequest,
    @Query() q: ReadQuery,
  ) {
    await this.scope(r, q);
    return this.reads.twin(r.auth!.userId, q);
  }
  @Get('mistakes') async mistakes(
    @Req() r: AuthenticatedRequest,
    @Query() q: MistakeQuery,
  ) {
    await this.scope(r, q);
    return this.reads.mistakes(r.auth!.userId, q);
  }
  @Get('revisions') async revisions(
    @Req() r: AuthenticatedRequest,
    @Query() q: RevisionQuery,
  ) {
    await this.scope(r, q);
    return this.reads.revisions(r.auth!.userId, q);
  }
  @Get('recommendation') async recommendation(
    @Req() r: AuthenticatedRequest,
    @Query() q: ReadQuery,
  ) {
    await this.scope(r, q);
    return this.reads.recommendation(r.auth!.userId, q);
  }
  @Get('next-best-action') async nextBestAction(
    @Req() r: AuthenticatedRequest,
    @Query() q: ReadQuery,
  ) {
    await this.scope(r, q);
    return this.reads.nextBestAction(r.auth!.userId, q);
  }
  @Get('progress') async progress(
    @Req() r: AuthenticatedRequest,
    @Query() q: ProgressQuery,
  ) {
    await this.scope(r, q);
    return this.reads.progress(r.auth!.userId, q);
  }
  @Get('today') async today(
    @Req() r: AuthenticatedRequest,
    @Query() q: TodayQuery,
  ) {
    await this.scope(r, q);
    return this.reads.today(r.auth!.userId, q);
  }
  @Get('revision') async revision(
    @Req() r: AuthenticatedRequest,
    @Query() q: RevisionQuery,
  ) {
    await this.scope(r, q);
    return this.reads.revisions(r.auth!.userId, q);
  }
}
