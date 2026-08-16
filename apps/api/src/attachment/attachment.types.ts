export const ATTACHMENT_PURPOSES = ['DOUBT_IMAGE', 'TUTOR_IMAGE'] as const;
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];

export const ATTACHMENT_STATUSES = [
  'PENDING_UPLOAD',
  'VALIDATING',
  'AVAILABLE',
  'REJECTED',
  'DELETED',
  'EXPIRED',
] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

export const ALLOWED_IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

export const C033_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxAttachmentsPerTurn: 4,
  maxTotalBytesPerTurn: 20 * 1024 * 1024,
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixels: 40_000_000,
  maxFilenameChars: 120,
  maxMetadataChars: 256,
  maxNormalizedEdge: 4096,
  maxNormalizedPixels: 16_000_000,
  uploadTtlSeconds: 600,
  readTtlSeconds: 300,
});

export type AttachmentRecord = {
  attachmentId: string;
  ownerLearnerId: string;
  createdByActorId: string;
  purpose: AttachmentPurpose;
  objectKey: string;
  originalFilename: string;
  declaredMimeType: AllowedImageMime;
  detectedMimeType?: AllowedImageMime;
  sizeBytes?: number;
  sha256?: string;
  width?: number;
  height?: number;
  sessionId?: string;
  interactionId?: string;
  status: AttachmentStatus;
  createdAt: Date;
  validatedAt?: Date;
  deletedAt?: Date;
};

export type LearnerAttachment = Omit<
  AttachmentRecord,
  'objectKey' | 'sha256'
> & {
  safeDisplayName: string;
};
