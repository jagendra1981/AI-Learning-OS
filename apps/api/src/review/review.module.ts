import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
