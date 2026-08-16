CREATE TABLE "question_exposures" (
    "questionExposureId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "syllabusVersionId" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT,
    "selectionReasonCode" TEXT NOT NULL,
    CONSTRAINT "question_exposures_pkey" PRIMARY KEY ("questionExposureId")
);

CREATE INDEX "question_exposures_userId_syllabusVersionId_selectedAt_idx"
ON "question_exposures"("userId", "syllabusVersionId", "selectedAt");
CREATE INDEX "question_exposures_questionVersionId_idx"
ON "question_exposures"("questionVersionId");

ALTER TABLE "question_exposures"
ADD CONSTRAINT "question_exposures_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_exposures"
ADD CONSTRAINT "question_exposures_questionVersionId_fkey"
FOREIGN KEY ("questionVersionId") REFERENCES "question_versions"("questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "question_exposures"
ADD CONSTRAINT "question_exposures_syllabusVersionId_fkey"
FOREIGN KEY ("syllabusVersionId") REFERENCES "syllabus_versions"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;
