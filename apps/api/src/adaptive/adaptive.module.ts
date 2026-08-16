import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AdaptiveController } from './adaptive.controller';
import { AdaptiveService } from './adaptive.service';
@Module({
  imports: [DatabaseModule],
  controllers: [AdaptiveController],
  providers: [AdaptiveService],
  exports: [AdaptiveService],
})
export class AdaptiveModule {}
