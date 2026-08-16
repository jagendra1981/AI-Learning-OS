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
import { ResponseService, SubmitResponseInput } from './response.service';

@Controller('api/v1/assessment/responses')
@UseGuards(AuthGuard)
export class ResponseController {
  constructor(private readonly responses: ResponseService) {}

  @Post()
  submit(@Req() req: AuthenticatedRequest, @Body() body: SubmitResponseInput) {
    return this.responses.submit(req.auth!.userId, body);
  }

  @Get(':responseId/feedback')
  feedback(
    @Req() req: AuthenticatedRequest,
    @Param('responseId') responseId: string,
  ) {
    return this.responses.getFeedback(req.auth!.userId, responseId);
  }
}
