import { Module } from '@nestjs/common';
import { ReadModelController } from './read-model.controller';
import { ReadModelService } from './read-model.service';
import { AcademicModule } from '../academic/academic.module';
@Module({ imports: [AcademicModule], controllers: [ReadModelController], providers: [ReadModelService] })
export class ReadModelModule {}
