import { Module } from '@nestjs/common';
import { AiGatewayService } from './ai-gateway.service';
import { PromptRegistry } from './prompt-registry';
import { SafeStubAdapter } from './safe-stub.adapter';
@Module({
  providers: [AiGatewayService, PromptRegistry, SafeStubAdapter],
  exports: [AiGatewayService],
})
export class AiGatewayModule {}
