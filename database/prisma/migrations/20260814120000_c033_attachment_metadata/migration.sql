CREATE TYPE "AttachmentPurpose" AS ENUM ('DOUBT_IMAGE', 'TUTOR_IMAGE');
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING_UPLOAD', 'VALIDATING', 'AVAILABLE', 'REJECTED', 'DELETED', 'EXPIRED');

CREATE TABLE "attachments" (
  "attachmentId" UUID NOT NULL,
  "ownerLearnerId" UUID NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "purpose" "AttachmentPurpose" NOT NULL,
  "objectKey" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "declaredMimeType" TEXT NOT NULL,
  "detectedMimeType" TEXT,
  "sizeBytes" INTEGER,
  "sha256" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validatedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "attachments_pkey" PRIMARY KEY ("attachmentId")
);
CREATE UNIQUE INDEX "attachments_objectKey_key" ON "attachments"("objectKey");
CREATE INDEX "attachments_ownerLearnerId_status_idx" ON "attachments"("ownerLearnerId", "status");
CREATE INDEX "attachments_ownerLearnerId_purpose_createdAt_idx" ON "attachments"("ownerLearnerId", "purpose", "createdAt");
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ownerLearnerId_fkey" FOREIGN KEY ("ownerLearnerId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
