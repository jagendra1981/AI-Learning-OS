-- C017 retry attempts: distinct C014 placement, same immutable QuestionVersion.
ALTER TABLE "assessment_session_placements" ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "assessment_session_placements" ADD COLUMN "retryOfPlacementId" UUID;
ALTER TABLE "assessment_session_placements" DROP CONSTRAINT IF EXISTS "assessment_session_placements_assessmentSessionId_ordinal_key";
ALTER TABLE "assessment_session_placements" DROP CONSTRAINT IF EXISTS "assessment_session_placements_assessmentSessionId_questionVersionId_key";
ALTER TABLE "assessment_session_placements" ADD CONSTRAINT "assessment_session_placements_retryOfPlacementId_fkey" FOREIGN KEY ("retryOfPlacementId") REFERENCES "assessment_session_placements"("assessmentSessionPlacementId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "assessment_session_placements_assessmentSessionId_ordinal_attemptNumber_key" ON "assessment_session_placements"("assessmentSessionId", "ordinal", "attemptNumber");
CREATE INDEX "assessment_session_placements_retryOfPlacementId_idx" ON "assessment_session_placements"("retryOfPlacementId");
