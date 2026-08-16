import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { TutorOrchestratorService } from './tutor-orchestrator.service';
import { TutorPolicyService } from './tutor-policy.service';
import { AttachmentModule } from '../attachment/attachment.module';
import { TutorServingController } from './tutor-serving.controller';
import { TutorInteractionRuntimeService } from './tutor-interaction-runtime.service';
import { TutorAssessmentRestrictionService } from './tutor-assessment-restriction.service';

@Module({
  imports: [AiGatewayModule, EvidenceModule, AttachmentModule],
  controllers: [TutorServingController],
  providers: [
    TutorOrchestratorService,
    TutorPolicyService,
    TutorInteractionRuntimeService,
    TutorAssessmentRestrictionService,
  ],
  exports: [TutorOrchestratorService, TutorPolicyService],
})
export class TutorOrchestratorModule {}
