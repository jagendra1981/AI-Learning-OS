-- C007 profile, onboarding, exam-goal and audit structures
CREATE TYPE "OnboardingState" AS ENUM ('NOT_STARTED', 'PROFILE_IN_PROGRESS', 'CONSENT_REQUIRED', 'READY_FOR_DIAGNOSTIC');
ALTER TABLE "student_profiles" ADD COLUMN "onboardingState" "OnboardingState" NOT NULL DEFAULT 'NOT_STARTED';
CREATE TABLE "exam_goals" (
  "examGoalId" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL,
  "examId" TEXT NOT NULL, "targetYear" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "exam_goals_pkey" PRIMARY KEY ("examGoalId"), CONSTRAINT "exam_goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "exam_goals_userId_examId_key" ON "exam_goals"("userId", "examId");
CREATE INDEX "exam_goals_userId_idx" ON "exam_goals"("userId");
CREATE TABLE "audit_events" (
  "auditEventId" UUID NOT NULL DEFAULT gen_random_uuid(), "actorUserId" UUID NOT NULL, "subjectUserId" UUID NOT NULL, "action" TEXT NOT NULL, "resourceType" TEXT NOT NULL, "resourceId" TEXT, "metadata" JSONB, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("auditEventId"), CONSTRAINT "audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "audit_events_subjectUserId_occurredAt_idx" ON "audit_events"("subjectUserId", "occurredAt");
CREATE INDEX "audit_events_actorUserId_occurredAt_idx" ON "audit_events"("actorUserId", "occurredAt");
