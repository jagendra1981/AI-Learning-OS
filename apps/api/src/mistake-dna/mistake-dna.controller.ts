import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { MistakeDnaService } from './mistake-dna.service';
@Controller('api/v1/mistake-dna')
@UseGuards(AuthGuard)
export class MistakeDnaController {
  constructor(private readonly dna: MistakeDnaService) {}
  @Get('concepts/:conceptId') current(
    @Req() req: AuthenticatedRequest,
    @Param('conceptId') conceptId: string,
  ) {
    if (!conceptId)
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'conceptId is required.',
      });
    return this.dna.getCurrentMistakePatterns(req.auth!.userId, conceptId);
  }
  @Get('concepts/:conceptId/history') history(
    @Req() req: AuthenticatedRequest,
    @Param('conceptId') conceptId: string,
  ) {
    if (!conceptId)
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'conceptId is required.',
      });
    return this.dna.getMistakeHistory(req.auth!.userId, conceptId);
  }
}
