import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { DatabaseService } from '../database/database.service';
import { metrics } from './metrics';

const ROLES = new Set(['CONTENT_REVIEWER', 'ACADEMIC_ADMIN', 'PLATFORM_ADMIN']);

@Controller('api/v1/observability')
@UseGuards(AuthGuard)
export class DomainMetricsController {
  constructor(private readonly db: DatabaseService) {}

  @Get('domain-metrics')
  async get(@Req() request: AuthenticatedRequest) {
    const roles = await this.db.userRole.findMany({ where: { userId: request.auth!.userId, status: 'ACTIVE' } });
    if (!roles.some((role) => ROLES.has(role.role)))
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this area.' });
    return { format: 'prometheus', data: metrics.render() };
  }
}
