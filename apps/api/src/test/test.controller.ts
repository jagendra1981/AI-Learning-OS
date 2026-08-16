/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { TestService } from './test.service';
@Controller('tests')
@UseGuards(AuthGuard)
export class TestController {
  constructor(private readonly tests: TestService) {}
  @Post() create(@Req() req: any, @Body() body: any) {
    return this.tests.create(req.auth.userId, body);
  }
  @Get(':testId') get(@Req() req: any, @Param('testId') id: string) {
    return this.tests.get(req.auth.userId, id);
  }
  @Post(':testId/start') start(@Req() req: any, @Param('testId') id: string) {
    return this.tests.start(req.auth.userId, id);
  }
  @Post(':testId/responses') respond(
    @Req() req: any,
    @Param('testId') id: string,
    @Body() body: any,
  ) {
    return this.tests.respond(req.auth.userId, id, body);
  }
  @Post(':testId/complete') complete(
    @Req() req: any,
    @Param('testId') id: string,
  ) {
    return this.tests.complete(req.auth.userId, id);
  }
  @Get(':testId/result') result(@Req() req: any, @Param('testId') id: string) {
    return this.tests.result(req.auth.userId, id);
  }
  @Get(':testId/autopsy') autopsy(
    @Req() req: any,
    @Param('testId') id: string,
  ) {
    return this.tests.autopsy(req.auth.userId, id);
  }
}
