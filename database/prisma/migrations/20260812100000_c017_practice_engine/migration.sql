-- C017 bounded practice-session state; additive migration.
CREATE TYPE "PracticeGoalType" AS ENUM ('CONCEPT_PRACTICE','OBJECTIVE_PRACTICE','REMEDIAL_PRACTICE','MIXED_REVIEW');
CREATE TYPE "PracticeStatus" AS ENUM ('READY','ACTIVE','COMPLETED','STOPPED');
CREATE TYPE "PracticeStopReason" AS ENUM ('USER_COMPLETED','USER_STOPPED','MAX_QUESTIONS_REACHED','NO_ELIGIBLE_CANDIDATE');
CREATE TABLE "practice_sessions" (
  "practiceSessionId" UUID NOT NULL DEFAULT gen_random_uuid(), "ownerUserId" UUID NOT NULL,
  "academicVersionId" TEXT NOT NULL, "assessmentSessionId" UUID, "goalType" "PracticeGoalType" NOT NULL,
  "targetIds" TEXT[] NOT NULL, "status" "PracticeStatus" NOT NULL DEFAULT 'READY',
  "currentDifficulty" TEXT NOT NULL DEFAULT 'MEDIUM', "consecutiveCorrect" INTEGER NOT NULL DEFAULT 0,
  "questionCount" INTEGER NOT NULL DEFAULT 0, "currentPlacementId" UUID, "currentQuestionVersionId" UUID,
  "currentAttempt" INTEGER NOT NULL DEFAULT 0, "retryCount" INTEGER NOT NULL DEFAULT 0,
  "retryAvailable" BOOLEAN NOT NULL DEFAULT false, "hintUsed" BOOLEAN NOT NULL DEFAULT false,
  "processedResponseIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "stopReason" "PracticeStopReason",
  "lockVersion" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  CONSTRAINT "practice_sessions_pkey" PRIMARY KEY ("practiceSessionId"),
  CONSTRAINT "practice_sessions_owner_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("userId") ON DELETE RESTRICT,
  CONSTRAINT "practice_sessions_version_fkey" FOREIGN KEY ("academicVersionId") REFERENCES "syllabus_versions"("canonicalId") ON DELETE RESTRICT
);
CREATE INDEX "practice_sessions_owner_status_created_idx" ON "practice_sessions"("ownerUserId","status","createdAt");
