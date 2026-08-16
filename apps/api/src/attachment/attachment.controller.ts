import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  Headers,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { AuthenticatedRequest } from '../identity/auth.types';
import { AttachmentService } from './attachment.service';
import { SafeStorageStub } from './private-object.adapter';
import { C033_LIMITS } from './attachment.types';
import {
  CompleteUploadRequest,
  CreateReadUrlRequest,
  DeleteAttachmentRequest,
  PrepareUploadRequest,
  learnerResponse,
} from './attachment.dto';

@Controller('api/v1/attachments')
@UseGuards(AuthGuard)
export class AttachmentController {
  constructor(
    private readonly attachments: AttachmentService,
    private readonly storage: SafeStorageStub,
  ) {}
  @Put('local-upload/:token') async localUpload(
    @Req() req: NodeJS.ReadableStream,
    @Param('token') token: string,
    @Headers('content-type') contentType = '',
  ) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk as Buffer);
      total += bytes.length;
      if (total > C033_LIMITS.maxBytes)
        throw new Error('FILE_TOO_LARGE');
      chunks.push(bytes);
    }
    await this.storage.upload(token, Buffer.concat(chunks), contentType);
    return { status: 'UPLOADED' };
  }
  @Post('prepare-upload') async prepare(
    @Req() req: AuthenticatedRequest,
    @Body() body: PrepareUploadRequest,
  ) {
    const result = await this.attachments.prepareUpload(
      req.auth!.userId,
      req.auth!.userId,
      body,
    );
    const { idempotencyFingerprint, ...safe } = result;
    void idempotencyFingerprint;
    return safe;
  }
  @Post('complete-upload') async complete(
    @Req() req: AuthenticatedRequest,
    @Body() body: CompleteUploadRequest,
  ) {
    return learnerResponse(
      await this.attachments.complete(req.auth!.userId, body.attachmentId),
    );
  }
  @Post('dev/mark-unavailable/:attachmentId') async markUnavailable(
    @Req() req: AuthenticatedRequest,
    @Param('attachmentId') id: string,
  ) {
    if (process.env.APP_ENV === 'production') throw new NotFoundException();
    await this.attachments.delete(req.auth!.userId, id);
    return { status: 'DELETED' };
  }
  @Get(':attachmentId') async read(
    @Req() req: AuthenticatedRequest,
    @Param('attachmentId') id: string,
  ) {
    return learnerResponse(await this.attachments.read(req.auth!.userId, id));
  }
  @Post('read-url') async readUrl(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateReadUrlRequest,
  ) {
    return this.attachments.signedRead(req.auth!.userId, body.attachmentId);
  }
  @Delete(':attachmentId') async remove(
    @Req() req: AuthenticatedRequest,
    @Param() params: DeleteAttachmentRequest,
  ) {
    await this.attachments.delete(req.auth!.userId, params.attachmentId);
    return { status: 'DELETED' };
  }
}
