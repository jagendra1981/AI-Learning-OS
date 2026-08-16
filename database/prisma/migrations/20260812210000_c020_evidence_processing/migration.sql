CREATE TABLE "evidence_records" (
  "evidenceId" UUID NOT NULL,
  "learnerId" UUID NOT NULL,
  "evidenceType" TEXT NOT NULL,
  "sourceLearningEventId" TEXT,
  "tutorObservationId" TEXT,
  "sourceAggregateType" TEXT NOT NULL,
  "sourceAggregateId" TEXT NOT NULL,
  "questionVersionId" TEXT,
  "conceptId" TEXT,
  "topicId" TEXT,
  "objectiveId" TEXT,
  "attemptOrdinal" INTEGER,
  "value" JSONB NOT NULL,
  "processingVersion" TEXT NOT NULL,
  "correlationId" TEXT,
  "causationId" TEXT,
  "academicContext" JSONB NOT NULL,
  "sourceOccurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotencyKey" TEXT NOT NULL,
  CONSTRAINT "evidence_records_pkey" PRIMARY KEY ("evidenceId")
);
CREATE UNIQUE INDEX "evidence_records_idempotencyKey_key" ON "evidence_records"("idempotencyKey");
CREATE INDEX "evidence_records_learnerId_createdAt_idx" ON "evidence_records"("learnerId", "createdAt");
CREATE INDEX "evidence_records_sourceLearningEventId_idx" ON "evidence_records"("sourceLearningEventId");
CREATE INDEX "evidence_records_evidenceType_learnerId_idx" ON "evidence_records"("evidenceType", "learnerId");

CREATE TABLE "evidence_signals" (
  "signalId" UUID NOT NULL,
  "learnerId" UUID NOT NULL,
  "signalType" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "sourceEvidenceIds" JSONB NOT NULL,
  "processingVersion" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "targetVersionId" TEXT,
  "correlationId" TEXT,
  "academicContext" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotencyKey" TEXT NOT NULL,
  CONSTRAINT "evidence_signals_pkey" PRIMARY KEY ("signalId")
);
CREATE UNIQUE INDEX "evidence_signals_idempotencyKey_key" ON "evidence_signals"("idempotencyKey");
CREATE INDEX "evidence_signals_learnerId_createdAt_idx" ON "evidence_signals"("learnerId", "createdAt");
CREATE INDEX "evidence_signals_signalType_learnerId_idx" ON "evidence_signals"("signalType", "learnerId");

CREATE TABLE "tutor_observations" (
  "observationId" UUID NOT NULL,
  "learnerId" UUID NOT NULL,
  "tutorActorId" UUID NOT NULL,
  "observationCode" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "academicContext" JSONB NOT NULL,
  "freeText" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotencyKey" TEXT NOT NULL,
  CONSTRAINT "tutor_observations_pkey" PRIMARY KEY ("observationId")
);
CREATE UNIQUE INDEX "tutor_observations_idempotencyKey_key" ON "tutor_observations"("idempotencyKey");
CREATE INDEX "tutor_observations_learnerId_createdAt_idx" ON "tutor_observations"("learnerId", "createdAt");
