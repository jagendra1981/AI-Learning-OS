import { Global, Module } from '@nestjs/common';
import { SessionAdapter } from './session.adapter';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { PasswordService } from './password.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [SessionAdapter, PasswordService, AuthGuard],
  exports: [SessionAdapter, AuthGuard],
})
export class IdentityModule {}
