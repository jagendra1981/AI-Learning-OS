export class PrepareUploadRequest {
  purpose!: 'DOUBT_IMAGE' | 'TUTOR_IMAGE';
  originalFilename!: string;
  declaredMimeType!: string;
  sizeBytes!: number;
  idempotencyKey!: string;
}
export class CompleteUploadRequest {
  attachmentId!: string;
}
export class CreateReadUrlRequest {
  attachmentId!: string;
}
export class DeleteAttachmentRequest {
  attachmentId!: string;
}
export type AttachmentResponse = ReturnType<typeof learnerResponse>;
export type PrepareUploadResponse = {
  attachmentId: string;
  uploadUrl: string;
  method: 'PUT';
  expiresAt: Date;
  requiredHeaders: Record<string, string>;
};
export type CreateReadUrlResponse = { url: string; expiresAt: Date };
export const learnerResponse = (value: {
  attachmentId: string;
  purpose: string;
  safeDisplayName: string;
  detectedMimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  status: string;
  createdAt: Date;
  validatedAt?: Date;
}) => ({
  attachmentId: value.attachmentId,
  purpose: value.purpose,
  safeDisplayName: value.safeDisplayName,
  detectedMimeType: value.detectedMimeType,
  sizeBytes: value.sizeBytes,
  width: value.width,
  height: value.height,
  status: value.status,
  createdAt: value.createdAt,
  validatedAt: value.validatedAt,
});
