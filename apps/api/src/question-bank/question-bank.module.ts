import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { QuestionBankService } from './question-bank.service';
import { QuestionApprovalController } from './question-approval.controller';

@Module({
  imports: [DatabaseModule],
  providers: [QuestionBankService],
  controllers: [QuestionApprovalController],
  exports: [QuestionBankService],
})
export class QuestionBankModule {}
