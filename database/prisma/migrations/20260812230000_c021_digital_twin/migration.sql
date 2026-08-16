CREATE TABLE "digital_twin_states" (
    "stateId" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "academicContextIdentity" TEXT NOT NULL,
    "academicContext" JSONB NOT NULL,
    "mastery" DECIMAL(12,6) NOT NULL,
    "confidence" DECIMAL(12,6) NOT NULL,
    "evidenceCount" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "watermark" TEXT,
    "lastEvidenceAt" TIMESTAMP(3),
    "algorithmId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "processingVersion" TEXT NOT NULL,
    "currentSnapshotId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "digital_twin_states_pkey" PRIMARY KEY ("stateId")
);
CREATE UNIQUE INDEX "digital_twin_states_identity_key" ON "digital_twin_states"("learnerId","targetType","targetId","academicContextIdentity","algorithmId","configId");
CREATE INDEX "digital_twin_states_learner_target_idx" ON "digital_twin_states"("learnerId","targetType","targetId");

CREATE TABLE "digital_twin_snapshots" (
    "snapshotId" UUID NOT NULL,
    "projectionId" TEXT NOT NULL,
    "learnerId" UUID NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "academicContextIdentity" TEXT NOT NULL,
    "academicContext" JSONB NOT NULL,
    "mastery" DECIMAL(12,6) NOT NULL,
    "confidence" DECIMAL(12,6) NOT NULL,
    "evidenceCount" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "previousSnapshotId" UUID,
    "appliedInputIds" JSONB NOT NULL,
    "watermark" TEXT,
    "lastEvidenceAt" TIMESTAMP(3),
    "algorithmId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "processingVersion" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "projectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "digital_twin_snapshots_pkey" PRIMARY KEY ("snapshotId")
);
CREATE UNIQUE INDEX "digital_twin_snapshots_projectionId_key" ON "digital_twin_snapshots"("projectionId");
CREATE INDEX "digital_twin_snapshots_history_idx" ON "digital_twin_snapshots"("learnerId","targetType","targetId","academicContextIdentity","projectedAt");
