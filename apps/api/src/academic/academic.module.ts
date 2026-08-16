import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { GraphService } from './graph.service';
import { AcademicScopeService } from './academic-scope.service';

@Module({
  imports: [DatabaseModule],
  providers: [GraphService, AcademicScopeService],
  exports: [GraphService, AcademicScopeService],
})
export class AcademicModule {}
