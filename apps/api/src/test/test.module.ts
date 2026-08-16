import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AssessmentModule } from '../assessment/assessment.module';
import { QuestionSelectionModule } from '../question-selection/question-selection.module';
import { LearningEventModule } from '../learning-event/learning-event.module';
import { TestService } from './test.service';
import { TestController } from './test.controller';
@Module({
  imports: [
    DatabaseModule,
    AssessmentModule,
    QuestionSelectionModule,
    LearningEventModule,
  ],
  controllers: [TestController],
  providers: [TestService],
  exports: [TestService],
})
export class TestModule {}
