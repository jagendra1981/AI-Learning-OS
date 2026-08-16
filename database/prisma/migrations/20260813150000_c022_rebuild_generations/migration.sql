CREATE TABLE "mistake_dna_projection_generations" (
  "generationId" UUID NOT NULL,
  "logicalGenerationKey" TEXT NOT NULL,
  "learnerId" UUID NOT NULL,
  "conceptId" TEXT NOT NULL,
  "academicContextIdentity" TEXT NOT NULL,
  "engineId" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "processingVersion" TEXT NOT NULL,
  "watermark" TEXT,
  "inputIds" JSONB NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mistake_dna_projection_generations_pkey" PRIMARY KEY ("generationId")
);
CREATE UNIQUE INDEX "mistake_dna_projection_generations_logicalGenerationKey_key" ON "mistake_dna_projection_generations"("logicalGenerationKey");
CREATE INDEX "mistake_dna_projection_generations_scope_idx" ON "mistake_dna_projection_generations"("learnerId", "conceptId", "academicContextIdentity");
ALTER TABLE "mistake_dna_patterns" ADD COLUMN "activeGenerationId" UUID;
ALTER TABLE "mistake_dna_transitions" ADD COLUMN "generationId" UUID;
CREATE INDEX "mistake_dna_transitions_generationId_idx" ON "mistake_dna_transitions"("generationId");
