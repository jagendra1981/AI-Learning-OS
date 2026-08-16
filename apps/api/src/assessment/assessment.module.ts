import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AssessmentService } from './assessment.service';
import { ResponseService } from './response.service';
import { ResponseController } from './response.controller';
import { LearningEventModule } from '../learning-event/learning-event.module';

@Module({
  imports: [DatabaseModule, LearningEventModule],
  controllers: [ResponseController],
  providers: [AssessmentService, ResponseService],
  exports: [AssessmentService, ResponseService],
})
export class AssessmentModule {}
