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
import { QuestionBankService } from './question-bank.service';

type WorkflowBody = { reason: string; correlationId: string };

@Controller('api/v1/questions/versions')
@UseGuards(AuthGuard)
export class QuestionApprovalController {
  constructor(private readonly service: QuestionBankService) {}
  @Post(':id/submit-review') submit(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() b: Partial<WorkflowBody>,
  ) {
    return this.service.submitForReview(r.auth!.userId, id, b?.reason);
  }
  @Get(':id/review') review(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.reviewHistory(r.auth!.userId, id);
  }
  @Get(':id') detail(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.reviewDetail(r.auth!.userId, id);
  }
  @Post(':id/approve') approve(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() b: WorkflowBody,
  ) {
    return this.service.approveVersion(
      r.auth!.userId,
      id,
      b.reason,
      b.correlationId,
    );
  }
  @Post(':id/reject') reject(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() b: WorkflowBody,
  ) {
    return this.service.rejectVersion(
      r.auth!.userId,
      id,
      b.reason,
      b.correlationId,
    );
  }
  @Post(':id/publish') publish(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() b: WorkflowBody,
  ) {
    return this.service.publishVersion(
      r.auth!.userId,
      id,
      b.reason,
      b.correlationId,
    );
  }
}
