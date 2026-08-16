CREATE TYPE "TestType" AS ENUM ('TOPIC', 'CHAPTER', 'CUSTOM');
CREATE TYPE "TestLifecycleState" AS ENUM ('READY', 'ACTIVE', 'COMPLETED', 'EXPIRED');

CREATE TABLE "test_definitions" (
  "testId" UUID NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "assessmentSessionId" UUID NOT NULL,
  "academicVersionId" TEXT NOT NULL,
  "testType" "TestType" NOT NULL,
  "targetScope" JSONB NOT NULL,
  "requestedQuestionCount" INTEGER NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "selectionContext" JSONB NOT NULL,
  "state" "TestLifecycleState" NOT NULL DEFAULT 'READY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "test_definitions_pkey" PRIMARY KEY ("testId")
);
CREATE UNIQUE INDEX "test_definitions_assessmentSessionId_key" ON "test_definitions"("assessmentSessionId");
CREATE INDEX "test_definitions_ownerUserId_state_createdAt_idx" ON "test_definitions"("ownerUserId", "state", "createdAt");
ALTER TABLE "test_definitions" ADD CONSTRAINT "test_definitions_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "test_definitions" ADD CONSTRAINT "test_definitions_academicVersionId_fkey" FOREIGN KEY ("academicVersionId") REFERENCES "syllabus_versions"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "test_definitions" ADD CONSTRAINT "test_definitions_assessmentSessionId_fkey" FOREIGN KEY ("assessmentSessionId") REFERENCES "assessment_sessions"("assessmentSessionId") ON DELETE RESTRICT ON UPDATE CASCADE;
