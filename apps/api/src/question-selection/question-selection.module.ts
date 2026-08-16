import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { QuestionSelectionService } from './question-selection.service';
@Module({
  imports: [DatabaseModule],
  providers: [QuestionSelectionService],
  exports: [QuestionSelectionService],
})
export class QuestionSelectionModule {}
