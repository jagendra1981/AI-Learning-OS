import { Module } from '@nestjs/common';
import { LearningEventService } from './learning-event.service';
@Module({ providers: [LearningEventService], exports: [LearningEventService] })
export class LearningEventModule {}
