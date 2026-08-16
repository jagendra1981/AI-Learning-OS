import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { IdentityModule } from '../identity/identity.module';
import { DatabaseModule } from '../database/database.module';
@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [ProfileController],
})
export class ProfileModule {}
