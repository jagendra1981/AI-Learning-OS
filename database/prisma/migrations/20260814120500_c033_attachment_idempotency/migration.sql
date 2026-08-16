ALTER TABLE "attachments" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "attachments" ADD COLUMN "requestFingerprint" TEXT;

UPDATE "attachments"
SET "idempotencyKey" = 'legacy_' || "attachmentId"::text,
    "requestFingerprint" = 'legacy_' || "attachmentId"::text
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "attachments" ALTER COLUMN "idempotencyKey" SET NOT NULL;
ALTER TABLE "attachments" ALTER COLUMN "requestFingerprint" SET NOT NULL;
CREATE UNIQUE INDEX "attachments_ownerLearnerId_idempotencyKey_key" ON "attachments"("ownerLearnerId", "idempotencyKey");
