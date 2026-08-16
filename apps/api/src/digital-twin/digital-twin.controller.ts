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
import { DigitalTwinService } from './digital-twin.service';

@Controller('api/v1/digital-twin')
@UseGuards(AuthGuard)
export class DigitalTwinController {
  constructor(private readonly twins: DigitalTwinService) {}
  @Get('concepts/:conceptId')
  current(
    @Req() req: AuthenticatedRequest,
    @Param('conceptId') conceptId: string,
    @Query('academicVersionId') academicVersionId: string,
  ) {
    if (!conceptId || !academicVersionId)
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'conceptId and academicVersionId are required.',
      });
    return this.twins.getCurrentConceptState(req.auth!.userId, conceptId, {
      academicVersionId,
    });
  }
  @Get('concepts/:conceptId/history')
  history(
    @Req() req: AuthenticatedRequest,
    @Param('conceptId') conceptId: string,
    @Query('academicVersionId') academicVersionId: string,
  ) {
    if (!conceptId || !academicVersionId)
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'conceptId and academicVersionId are required.',
      });
    return this.twins.getConceptHistory(req.auth!.userId, conceptId, {
      academicVersionId,
    });
  }
}
