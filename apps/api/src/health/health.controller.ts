import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { metrics } from '../observability/metrics';

type StatusResponse = { status: (code: number) => unknown };

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  getApplicationHealth() {
    return { status: 'ok' };
  }

  @Get('database')
  async getDatabaseHealth(
    @Res({ passthrough: true }) response?: StatusResponse,
  ) {
    try {
      await this.database.ping();
      metrics.setGauge('aio_database_health', {}, 1);
      return { status: 'ok', database: 'ok' };
    } catch {
      metrics.setGauge('aio_database_health', {}, 0);
      response?.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'degraded', database: 'unavailable' };
    }
  }
}
