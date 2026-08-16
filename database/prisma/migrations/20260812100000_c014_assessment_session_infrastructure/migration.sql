CREATE TYPE "AssessmentTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "AssessmentSessionState" AS ENUM ('READY', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "assessment_templates" (
  "assessmentTemplateId" UUID NOT NULL,
  "canonicalId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "assessmentType" TEXT NOT NULL,
  "syllabusVersionId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "structure" JSONB NOT NULL,
  "configurationReference" TEXT,
  "status" "AssessmentTemplateStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assessment_templates_pkey" PRIMARY KEY ("assessmentTemplateId")
);
CREATE UNIQUE INDEX "assessment_templates_canonicalId_versionNumber_key" ON "assessment_templates"("canonicalId", "versionNumber");
CREATE INDEX "assessment_templates_examId_subjectId_status_idx" ON "assessment_templates"("examId", "subjectId", "status");
ALTER TABLE "assessment_templates" ADD CONSTRAINT "assessment_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assessment_templates" ADD CONSTRAINT "assessment_templates_syllabusVersionId_fkey" FOREIGN KEY ("syllabusVersionId") REFERENCES "syllabus_versions"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "assessment_sessions" (
  "assessmentSessionId" UUID NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "assessmentTemplateId" UUID NOT NULL,
  "syllabusVersionId" TEXT NOT NULL,
  "state" "AssessmentSessionState" NOT NULL DEFAULT 'READY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "lockVersion" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "assessment_sessions_pkey" PRIMARY KEY ("assessmentSessionId")
);
CREATE INDEX "assessment_sessions_ownerUserId_state_createdAt_idx" ON "assessment_sessions"("ownerUserId", "state", "createdAt");
CREATE INDEX "assessment_sessions_expiresAt_state_idx" ON "assessment_sessions"("expiresAt", "state");
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_assessmentTemplateId_fkey" FOREIGN KEY ("assessmentTemplateId") REFERENCES "assessment_templates"("assessmentTemplateId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_syllabusVersionId_fkey" FOREIGN KEY ("syllabusVersionId") REFERENCES "syllabus_versions"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "assessment_session_placements" (
  "assessmentSessionPlacementId" UUID NOT NULL,
  "assessmentSessionId" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "section" TEXT,
  "ordinal" INTEGER NOT NULL,
  "placementMetadata" JSONB,
  "selectionReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assessment_session_placements_pkey" PRIMARY KEY ("assessmentSessionPlacementId")
);
CREATE UNIQUE INDEX "assessment_session_placements_session_ordinal_key" ON "assessment_session_placements"("assessmentSessionId", "ordinal");
CREATE UNIQUE INDEX "assessment_session_placements_session_question_key" ON "assessment_session_placements"("assessmentSessionId", "questionVersionId");
CREATE INDEX "assessment_session_placements_session_section_ordinal_idx" ON "assessment_session_placements"("assessmentSessionId", "section", "ordinal");
ALTER TABLE "assessment_session_placements" ADD CONSTRAINT "assessment_session_placements_session_fkey" FOREIGN KEY ("assessmentSessionId") REFERENCES "assessment_sessions"("assessmentSessionId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_session_placements" ADD CONSTRAINT "assessment_session_placements_question_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "question_versions"("questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;
