import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AcademicModule } from '../academic/academic.module';
import { QuestionSelectionModule } from '../question-selection/question-selection.module';
import { AssessmentModule } from '../assessment/assessment.module';
import { DiagnosticService } from './diagnostic.service';
import { DiagnosticController } from './diagnostic.controller';
import { LearningEventModule } from '../learning-event/learning-event.module';
@Module({
  imports: [
    DatabaseModule,
    AcademicModule,
    QuestionSelectionModule,
    AssessmentModule,
    LearningEventModule,
  ],
  providers: [DiagnosticService],
  controllers: [DiagnosticController],
})
export class DiagnosticModule {}
