CREATE TABLE "assessment_responses" (
  "assessmentResponseId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "assessmentSessionId" UUID NOT NULL,
  "placementId" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "responsePayload" JSONB NOT NULL,
  "correctness" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assessment_responses_pkey" PRIMARY KEY ("assessmentResponseId")
);
CREATE UNIQUE INDEX "assessment_responses_userId_idempotencyKey_key" ON "assessment_responses"("userId", "idempotencyKey");
CREATE UNIQUE INDEX "assessment_responses_assessmentSessionId_placementId_key" ON "assessment_responses"("assessmentSessionId", "placementId");
CREATE INDEX "assessment_responses_assessmentSessionId_placementId_idx" ON "assessment_responses"("assessmentSessionId", "placementId");
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_assessmentSessionId_fkey" FOREIGN KEY ("assessmentSessionId") REFERENCES "assessment_sessions"("assessmentSessionId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "assessment_session_placements"("assessmentSessionPlacementId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "question_versions"("questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;
