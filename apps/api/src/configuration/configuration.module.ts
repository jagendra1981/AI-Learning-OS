import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';
import { ConfigurationCache } from './configuration.cache';
@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [ConfigurationController],
  providers: [ConfigurationService, ConfigurationCache],
  exports: [ConfigurationService],
})
export class ConfigurationModule {}
