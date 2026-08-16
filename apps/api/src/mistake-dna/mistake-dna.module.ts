import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { MistakeDnaController } from './mistake-dna.controller';
import { MistakeDnaService } from './mistake-dna.service';
@Module({
  imports: [DatabaseModule, EvidenceModule],
  controllers: [MistakeDnaController],
  providers: [MistakeDnaService],
  exports: [MistakeDnaService],
})
export class MistakeDnaModule {}
