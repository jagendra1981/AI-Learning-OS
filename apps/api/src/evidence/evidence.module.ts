import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EvidenceService } from './evidence.service';

@Module({
  imports: [DatabaseModule],
  providers: [EvidenceService],
  exports: [EvidenceService],
})
export class EvidenceModule {}
