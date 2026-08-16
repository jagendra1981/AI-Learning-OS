import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { QuestionSelectionModule } from '../question-selection/question-selection.module';
import { AssessmentModule } from '../assessment/assessment.module';
import { PracticeService } from './practice.service';
import { PracticeController } from './practice.controller';
import { LearningEventModule } from '../learning-event/learning-event.module';
import { AcademicModule } from '../academic/academic.module';
import { AdaptiveModule } from '../adaptive/adaptive.module';
@Module({
  imports: [
    DatabaseModule,
    QuestionSelectionModule,
    AssessmentModule,
    LearningEventModule,
    AcademicModule,
    AdaptiveModule,
  ],
  providers: [PracticeService],
  controllers: [PracticeController],
  exports: [PracticeService],
})
export class PracticeModule {}
