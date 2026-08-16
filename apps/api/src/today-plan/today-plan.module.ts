import { Module } from '@nestjs/common';
import { AdaptiveModule } from '../adaptive/adaptive.module';
import { TodayPlanController } from './today-plan.controller';
import { TodayPlanService } from './today-plan.service';
@Module({
  imports: [AdaptiveModule],
  controllers: [TodayPlanController],
  providers: [TodayPlanService],
  exports: [TodayPlanService],
})
export class TodayPlanModule {}
