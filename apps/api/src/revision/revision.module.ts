import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RevisionController } from './revision.controller';
import { RevisionService } from './revision.service';
@Module({
  imports: [DatabaseModule],
  controllers: [RevisionController],
  providers: [RevisionService],
  exports: [RevisionService],
})
export class RevisionModule {}
