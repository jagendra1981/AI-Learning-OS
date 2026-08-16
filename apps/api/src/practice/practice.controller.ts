import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../identity/auth.types';
import { AuthGuard } from '../identity/auth.guard';
import { PracticeService } from './practice.service';
@Controller('api/v1/practice-sessions')
@UseGuards(AuthGuard)
export class PracticeController {
  constructor(private readonly practice: PracticeService) {}
  private user(req: AuthenticatedRequest) {
    return req.auth?.userId ?? '';
  }
  @Post() create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.practice.create(
      this.user(req),
      body as Parameters<PracticeService['create']>[1],
    );
  }
  @Post('acquire') acquire(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.practice.acquire(
      this.user(req),
      body as Parameters<PracticeService['acquire']>[1],
    );
  }
  @Get(':id') get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.practice.get(this.user(req), id);
  }
  @Get(':id/solution') solution(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.practice.solution(this.user(req), id);
  }
  @Post(':id/next') next(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.practice.next(this.user(req), id);
  }
  @Post(':id/responses') response(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.practice.respond(
      this.user(req),
      id,
      body as Parameters<PracticeService['respond']>[2],
    );
  }
  @Post(':id/stop') stop(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.practice.stop(this.user(req), id);
  }
  @Post(':id/hint') hint(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.practice.hint(this.user(req), id);
  }
  @Post(':id/retry') retry(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.practice.retry(this.user(req), id);
  }
  @Post(':id/complete') complete(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.practice.complete(this.user(req), id);
  }
}
