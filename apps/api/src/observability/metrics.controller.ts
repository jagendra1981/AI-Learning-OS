import { Controller, ForbiddenException, Get, Header, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { DatabaseService } from '../database/database.service';
import { metrics } from './metrics';

@Controller('metrics')
@UseGuards(AuthGuard)
export class MetricsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(@Req() request: AuthenticatedRequest) {
    const roles = await this.db.userRole.findMany({
      where: { userId: request.auth!.userId, status: 'ACTIVE' },
      select: { role: true },
    });
    if (!roles.some(({ role }) => ['CONTENT_REVIEWER', 'ACADEMIC_ADMIN', 'PLATFORM_ADMIN'].includes(role)))
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this area.' });
    return metrics.render();
  }
}
