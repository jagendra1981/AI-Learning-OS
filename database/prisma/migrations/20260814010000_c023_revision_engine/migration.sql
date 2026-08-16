CREATE TABLE "revision_states" (
 "revisionStateId" UUID PRIMARY KEY, "scopeKey" TEXT NOT NULL UNIQUE, "learnerId" UUID NOT NULL,
 "conceptId" TEXT NOT NULL, "contextId" TEXT NOT NULL, "academicVersionId" TEXT NOT NULL, "state" TEXT NOT NULL,
 "intervalDays" INTEGER, "anchorAt" TIMESTAMP(3), "dueAt" TIMESTAMP(3), "consecutiveIndependentSuccessCount" INTEGER NOT NULL DEFAULT 0,
 "lastQualifyingQuestionVersionId" UUID, "successWindowStartedAt" TIMESTAMP(3), "lastAssessmentResultId" TEXT, "lastAssessedAt" TIMESTAMP(3),
 "mastery" DECIMAL(12,6), "learnerConfidence" DECIMAL(12,6), "c021SnapshotId" UUID, "c021Revision" INTEGER,
 "c022ProjectionId" UUID, "c022GenerationId" UUID, "c022Revision" INTEGER, "c022Lifecycle" TEXT, "c022ResolutionReason" TEXT,
 "c022Severity" DECIMAL(12,6), "c022RecurrenceCount" INTEGER, "c022ReappearanceCount" INTEGER,
 "watermarkEffectiveAt" TIMESTAMP(3), "watermarkSourceRank" INTEGER, "watermarkSourceId" TEXT,
 "engineId" TEXT NOT NULL, "algorithmId" TEXT NOT NULL, "configId" TEXT NOT NULL, "processingVersion" TEXT NOT NULL,
 "activeGenerationId" UUID, "revision" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "revision_states_scope_unique" UNIQUE("learnerId","conceptId","contextId","academicVersionId")
);
CREATE INDEX "revision_states_learnerId_conceptId_idx" ON "revision_states"("learnerId","conceptId");
CREATE TABLE "revision_generations" ("generationId" UUID PRIMARY KEY,"logicalKey" TEXT NOT NULL UNIQUE,"scopeKey" TEXT NOT NULL,
 "learnerId" UUID NOT NULL,"fingerprint" TEXT NOT NULL,"sourceIds" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "revision_generations_scopeKey_createdAt_idx" ON "revision_generations"("scopeKey","createdAt");
CREATE TABLE "revision_source_ledger" ("sourceLedgerId" UUID PRIMARY KEY,"scopeKey" TEXT NOT NULL,"learnerId" UUID NOT NULL,
 "sourceType" TEXT NOT NULL,"sourceRank" INTEGER NOT NULL,"immutableSourceId" TEXT NOT NULL,"payloadHash" TEXT NOT NULL,
 "effectiveAt" TIMESTAMP(3) NOT NULL,"normalizedPayload" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "revision_source_ledger_scope_source_unique" UNIQUE("scopeKey","immutableSourceId"));
CREATE INDEX "revision_source_ledger_order_idx" ON "revision_source_ledger"("scopeKey","effectiveAt","sourceRank","immutableSourceId");
CREATE TABLE "revision_history" ("revisionHistoryId" UUID PRIMARY KEY,"projectionId" TEXT NOT NULL UNIQUE,"generationId" UUID NOT NULL,
 "semanticOrder" INTEGER NOT NULL,"scopeKey" TEXT NOT NULL,"learnerId" UUID NOT NULL,"fromState" TEXT NOT NULL,"toState" TEXT NOT NULL,
 "beforeIntervalDays" INTEGER,"afterIntervalDays" INTEGER,"beforeDueAt" TIMESTAMP(3),"afterDueAt" TIMESTAMP(3),"transitionReason" TEXT NOT NULL,
 "sourceType" TEXT NOT NULL,"sourceRank" INTEGER NOT NULL,"immutableSourceId" TEXT NOT NULL,"effectiveAt" TIMESTAMP(3) NOT NULL,
 "engineId" TEXT NOT NULL,"algorithmId" TEXT NOT NULL,"configId" TEXT NOT NULL,"processingVersion" TEXT NOT NULL,"provenance" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "revision_history_generation_order_unique" UNIQUE("generationId","semanticOrder"));
CREATE INDEX "revision_history_scope_generation_order_idx" ON "revision_history"("scopeKey","generationId","semanticOrder");
CREATE TABLE "revision_assessment_links" ("revisionAssessmentLinkId" UUID PRIMARY KEY,"attemptKey" TEXT NOT NULL UNIQUE,"scopeKey" TEXT NOT NULL,
 "learnerId" UUID NOT NULL,"assessmentResultId" TEXT NOT NULL,"questionVersionId" UUID NOT NULL,"assessedAt" TIMESTAMP(3) NOT NULL,
 "outcome" TEXT NOT NULL,"immutableSourceId" TEXT NOT NULL,"payloadHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "revision_assessment_links_scope_assessed_idx" ON "revision_assessment_links"("scopeKey","assessedAt");
CREATE OR REPLACE FUNCTION reject_revision_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'revision_history is append-only'; END; $$;
CREATE TRIGGER revision_history_immutable BEFORE UPDATE OR DELETE ON "revision_history" FOR EACH ROW EXECUTE FUNCTION reject_revision_history_mutation();
