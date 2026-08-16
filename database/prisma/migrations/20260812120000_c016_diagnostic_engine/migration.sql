-- C016 additive persistence only
CREATE TYPE "DiagnosticStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'STOPPED');
CREATE TYPE "DiagnosticStopReason" AS ENUM ('SUFFICIENT_TARGET_EVIDENCE', 'GAP_LOCALIZED', 'MAX_QUESTIONS_REACHED', 'NO_ELIGIBLE_CANDIDATE', 'USER_STOPPED', 'SESSION_EXPIRED');
CREATE TABLE "diagnostic_runs" (
  "diagnosticRunId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "academicVersionId" TEXT NOT NULL,
  "rootTargetConceptId" TEXT NOT NULL,
  "currentTargetConceptId" TEXT NOT NULL,
  "currentDifficulty" TEXT NOT NULL,
  "sessionId" UUID,
  "status" "DiagnosticStatus" NOT NULL DEFAULT 'ACTIVE',
  "questionCount" INTEGER NOT NULL DEFAULT 0,
  "processedResponseIds" TEXT[] NOT NULL,
  "conceptEvidence" JSONB NOT NULL,
  "path" JSONB NOT NULL,
  "currentPlacementId" UUID,
  "currentQuestionVersionId" UUID,
  "stopReason" "DiagnosticStopReason",
  "policyVersion" TEXT NOT NULL DEFAULT 'C016-DEP-GC-V1',
  "lockVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "diagnostic_runs_pkey" PRIMARY KEY ("diagnosticRunId")
);
CREATE UNIQUE INDEX "diagnostic_runs_userId_academicVersionId_rootTargetConceptId_status_key" ON "diagnostic_runs"("userId", "academicVersionId", "rootTargetConceptId", "status");
CREATE INDEX "diagnostic_runs_userId_status_idx" ON "diagnostic_runs"("userId", "status");
ALTER TABLE "diagnostic_runs" ADD CONSTRAINT "diagnostic_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "diagnostic_runs" ADD CONSTRAINT "diagnostic_runs_academicVersionId_fkey" FOREIGN KEY ("academicVersionId") REFERENCES "syllabus_versions"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;
