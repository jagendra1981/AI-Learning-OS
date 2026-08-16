import { Module } from '@nestjs/common';
import { AttachmentService } from './attachment.service';
import { SafeStorageStub } from './private-object.adapter';
import { AttachmentController } from './attachment.controller';

@Module({
  controllers: [AttachmentController],
  providers: [SafeStorageStub, AttachmentService],
  exports: [AttachmentService, SafeStorageStub],
})
export class AttachmentModule {}
