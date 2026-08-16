import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { DiagnosticService } from './diagnostic.service';
type DiagnosticStartBody = {
  academicVersionId: string;
  examId: string;
  subjectId: string;
  targetConceptId: string;
  sessionId?: string;
};
type DiagnosticAnswerBody = {
  sessionId: string;
  placementId: string;
  idempotencyKey: string;
  selectedOption?: string | null;
  questionVersionId?: string;
};
@Controller('api/v1/diagnostics')
@UseGuards(AuthGuard)
export class DiagnosticController {
  constructor(private readonly diagnostics: DiagnosticService) {}
  @Get('entry') entry(@Req() req: AuthenticatedRequest) {
    return this.diagnostics.entry(req.auth!.userId);
  }
  @Post('entry') startFromEntry(
    @Req() req: AuthenticatedRequest,
    @Body() body: DiagnosticStartBody,
  ) {
    return this.diagnostics.startFromEntry(req.auth!.userId, body);
  }
  @Post() start(
    @Req() req: AuthenticatedRequest,
    @Body() body: DiagnosticStartBody,
  ) {
    return this.diagnostics.start(req.auth!.userId, body);
  }
  @Get(':id') get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.diagnostics.get(req.auth!.userId, id);
  }
  @Get(':id/question') question(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.diagnostics.question(req.auth!.userId, id);
  }
  @Get(':id/result') result(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.diagnostics.result(req.auth!.userId, id);
  }
  @Post(':id/next') next(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.diagnostics.next(req.auth!.userId, id);
  }
  @Post(':id/answer') answer(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: DiagnosticAnswerBody,
  ) {
    return this.diagnostics.answer(req.auth!.userId, id, body);
  }
  @Post(':id/stop') stop(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.diagnostics.stop(req.auth!.userId, id);
  }
}
