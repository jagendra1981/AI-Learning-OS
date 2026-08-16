CREATE TABLE "mistake_dna_patterns" (
  "patternId" UUID NOT NULL DEFAULT gen_random_uuid(), "learnerId" UUID NOT NULL,
  "targetType" TEXT NOT NULL, "conceptId" TEXT NOT NULL, "taxonomyCode" TEXT NOT NULL,
  "patternSignature" TEXT NOT NULL, "academicContextIdentity" TEXT NOT NULL, "academicContext" JSONB NOT NULL,
  "state" TEXT NOT NULL, "lifetimeOccurrenceCount" INTEGER NOT NULL, "recurrenceCount" INTEGER NOT NULL,
  "remediationSuccessStreak" INTEGER NOT NULL, "reappearanceCount" INTEGER NOT NULL,
  "severity" DECIMAL(12,6) NOT NULL, "confidence" DECIMAL(12,6) NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL, "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3), "remediatingAt" TIMESTAMP(3), "resolvedAt" TIMESTAMP(3), "reappearedAt" TIMESTAMP(3),
  "resolutionReason" TEXT, "revision" INTEGER NOT NULL, "watermark" TEXT,
  "engineId" TEXT NOT NULL, "configId" TEXT NOT NULL, "processingVersion" TEXT NOT NULL,
  "currentTransitionId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mistake_dna_patterns_pkey" PRIMARY KEY ("patternId")
);
CREATE UNIQUE INDEX "mistake_dna_patterns_identity_key" ON "mistake_dna_patterns"("learnerId","targetType","conceptId","taxonomyCode","academicContextIdentity","engineId","configId");
CREATE INDEX "mistake_dna_patterns_owner_idx" ON "mistake_dna_patterns"("learnerId","conceptId","state");
CREATE TABLE "mistake_dna_transitions" (
  "transitionId" UUID NOT NULL DEFAULT gen_random_uuid(), "projectionId" TEXT NOT NULL, "patternId" UUID NOT NULL,
  "learnerId" UUID NOT NULL, "targetType" TEXT NOT NULL, "conceptId" TEXT NOT NULL, "patternSignature" TEXT NOT NULL,
  "academicContextIdentity" TEXT NOT NULL, "fromState" TEXT, "toState" TEXT NOT NULL,
  "occurrenceInputIds" JSONB NOT NULL, "remediationInputIds" JSONB NOT NULL,
  "severity" DECIMAL(12,6) NOT NULL, "confidence" DECIMAL(12,6) NOT NULL,
  "lifetimeOccurrenceCount" INTEGER NOT NULL, "recurrenceCount" INTEGER NOT NULL, "remediationSuccessStreak" INTEGER NOT NULL, "reappearanceCount" INTEGER NOT NULL,
  "previousTransitionId" UUID, "watermark" TEXT, "reasonCode" TEXT NOT NULL, "provenance" JSONB NOT NULL,
  "engineId" TEXT NOT NULL, "configId" TEXT NOT NULL, "processingVersion" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mistake_dna_transitions_pkey" PRIMARY KEY ("transitionId")
);
CREATE UNIQUE INDEX "mistake_dna_transitions_projection_key" ON "mistake_dna_transitions"("projectionId");
CREATE INDEX "mistake_dna_transitions_history_idx" ON "mistake_dna_transitions"("learnerId","conceptId","patternSignature","createdAt");
CREATE OR REPLACE FUNCTION reject_mistake_dna_transition_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'mistake dna transitions are immutable'; END; $$;
CREATE TRIGGER mistake_dna_transitions_immutable BEFORE UPDATE OR DELETE ON "mistake_dna_transitions" FOR EACH ROW EXECUTE FUNCTION reject_mistake_dna_transition_mutation();
