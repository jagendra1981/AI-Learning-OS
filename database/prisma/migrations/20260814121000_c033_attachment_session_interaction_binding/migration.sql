ALTER TABLE "attachments" ADD COLUMN "sessionId" TEXT;
ALTER TABLE "attachments" ADD COLUMN "interactionId" TEXT;
CREATE INDEX "attachments_ownerLearnerId_sessionId_interactionId_status_idx"
  ON "attachments"("ownerLearnerId", "sessionId", "interactionId", "status");
