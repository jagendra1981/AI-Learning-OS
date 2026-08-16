import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { IdentityModule } from './identity/identity.module';
import { ProfileModule } from './profile/profile.module';
import { AcademicModule } from './academic/academic.module';
import { ConfigurationModule } from './configuration/configuration.module';
import { QuestionBankModule } from './question-bank/question-bank.module';
import { QuestionSelectionModule } from './question-selection/question-selection.module';
import { AssessmentModule } from './assessment/assessment.module';
import { DiagnosticModule } from './diagnostic/diagnostic.module';
import { PracticeModule } from './practice/practice.module';
import { TestModule } from './test/test.module';
import { LearningEventModule } from './learning-event/learning-event.module';
import { EvidenceModule } from './evidence/evidence.module';
import { DigitalTwinModule } from './digital-twin/digital-twin.module';
import { MistakeDnaModule } from './mistake-dna/mistake-dna.module';
import { RevisionModule } from './revision/revision.module';
import { AdaptiveModule } from './adaptive/adaptive.module';
import { TodayPlanModule } from './today-plan/today-plan.module';
import { ReadModelModule } from './read-model/read-model.module';
import { AiGatewayModule } from './ai-gateway/ai-gateway.module';
import { TutorOrchestratorModule } from './tutor-orchestrator/tutor-orchestrator.module';
import { AttachmentModule } from './attachment/attachment.module';
import { ReviewModule } from './review/review.module';
import { MetricsController } from './observability/metrics.controller';
import { DomainMetricsController } from './observability/domain-metrics.controller';
import { PilotModule } from './pilot/pilot.module';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    ProfileModule,
    AcademicModule,
    ConfigurationModule,
    QuestionBankModule,
    QuestionSelectionModule,
    AssessmentModule,
    DiagnosticModule,
    PracticeModule,
    TestModule,
    LearningEventModule,
    EvidenceModule,
    DigitalTwinModule,
    MistakeDnaModule,
    RevisionModule,
    AdaptiveModule,
    TodayPlanModule,
    ReadModelModule,
    AiGatewayModule,
    TutorOrchestratorModule,
    AttachmentModule,
    ReviewModule,
    PilotModule,
  ],
  controllers: [HealthController, MetricsController, DomainMetricsController],
})
export class AppModule {}
