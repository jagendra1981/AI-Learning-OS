import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { ReviewService } from './review.service';

@Controller('api/v1/review')
@UseGuards(AuthGuard)
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get('queue')
  queue(@Req() request: AuthenticatedRequest) {
    return this.reviews.queue(request.auth!.userId);
  }

  @Get('academic-issues/:id')
  academicIssue(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.reviews.academicIssueDetail(request.auth!.userId, id);
  }

  @Post('academic-issues/:id/resolve')
  resolveAcademicIssue(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.reviews.resolveAcademicIssue(request.auth!.userId, id);
  }
}
