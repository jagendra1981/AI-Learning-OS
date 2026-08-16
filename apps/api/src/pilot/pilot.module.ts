import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PilotController } from './pilot.controller';
import { PilotService } from './pilot.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PilotController],
  providers: [PilotService],
})
export class PilotModule {}
