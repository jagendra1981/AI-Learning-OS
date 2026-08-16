-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'NUMERIC', 'SUBJECTIVE');

-- CreateEnum
CREATE TYPE "QuestionVersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QuestionMappingRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "QuestionOriginType" AS ENUM ('AUTHOR_CREATED', 'LICENSED_SOURCE', 'APPROVED_FIXTURE');

-- CreateEnum
CREATE TYPE "QuestionRightsStatus" AS ENUM ('VERIFIED', 'PENDING', 'RESTRICTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QuestionReviewType" AS ENUM ('CONTENT', 'CONCEPT_MAPPING', 'DIFFICULTY', 'PROVENANCE', 'RIGHTS');

-- CreateEnum
CREATE TYPE "QuestionReviewDecision" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_CHANGES');

-- CreateTable
CREATE TABLE "questions" (
    "questionId" UUID NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("questionId")
);

-- CreateTable
CREATE TABLE "question_versions" (
    "questionVersionId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "QuestionVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "questionType" "QuestionType" NOT NULL,
    "stem" JSONB NOT NULL,
    "options" JSONB,
    "correctAnswerRef" TEXT,
    "explanationRef" TEXT,
    "syllabusNodeId" TEXT NOT NULL,
    "learningObjectiveId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_versions_pkey" PRIMARY KEY ("questionVersionId")
);

-- CreateTable
CREATE TABLE "question_concept_maps" (
    "questionConceptMapId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "conceptId" TEXT NOT NULL,
    "mappingRole" "QuestionMappingRole" NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_concept_maps_pkey" PRIMARY KEY ("questionConceptMapId")
);

-- CreateTable
CREATE TABLE "question_difficulty" (
    "questionDifficultyId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "authorDifficulty" INTEGER,
    "empiricalDifficulty" DOUBLE PRECISION,
    "calibratedDifficulty" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "provenance" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_difficulty_pkey" PRIMARY KEY ("questionDifficultyId")
);

-- CreateTable
CREATE TABLE "question_hints" (
    "questionHintId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "isFinalHint" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_hints_pkey" PRIMARY KEY ("questionHintId")
);

-- CreateTable
CREATE TABLE "question_solutions" (
    "questionSolutionId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "solutionKey" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_solutions_pkey" PRIMARY KEY ("questionSolutionId")
);

-- CreateTable
CREATE TABLE "question_provenance" (
    "questionProvenanceId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "authorOrSource" TEXT NOT NULL,
    "originType" "QuestionOriginType" NOT NULL,
    "sourceReference" TEXT,
    "creationMethod" TEXT NOT NULL,
    "attribution" TEXT,
    "reviewNotes" TEXT,
    "verificationStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_provenance_pkey" PRIMARY KEY ("questionProvenanceId")
);

-- CreateTable
CREATE TABLE "question_rights" (
    "questionRightsId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "license" TEXT NOT NULL,
    "rightsStatus" "QuestionRightsStatus" NOT NULL,
    "commercialUseAllowed" BOOLEAN NOT NULL,
    "restrictionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_rights_pkey" PRIMARY KEY ("questionRightsId")
);

-- CreateTable
CREATE TABLE "question_review_records" (
    "questionReviewRecordId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "reviewerUserId" UUID NOT NULL,
    "reviewType" "QuestionReviewType" NOT NULL,
    "decision" "QuestionReviewDecision" NOT NULL,
    "reviewScope" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "beforeReference" JSONB,
    "afterReference" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_review_records_pkey" PRIMARY KEY ("questionReviewRecordId")
);

-- CreateIndex
CREATE INDEX "questions_examId_subjectId_idx" ON "questions"("examId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "questions_scopeKey_questionId_key" ON "questions"("scopeKey", "questionId");

-- CreateIndex
CREATE INDEX "question_versions_questionId_status_idx" ON "question_versions"("questionId", "status");

-- CreateIndex
CREATE INDEX "question_versions_syllabusNodeId_idx" ON "question_versions"("syllabusNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "question_versions_questionId_versionNumber_key" ON "question_versions"("questionId", "versionNumber");

-- CreateIndex
CREATE INDEX "question_concept_maps_conceptId_approved_idx" ON "question_concept_maps"("conceptId", "approved");

-- CreateIndex
CREATE UNIQUE INDEX "question_concept_maps_questionVersionId_conceptId_key" ON "question_concept_maps"("questionVersionId", "conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "question_difficulty_questionVersionId_key" ON "question_difficulty"("questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "question_hints_questionVersionId_sequence_key" ON "question_hints"("questionVersionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "question_solutions_questionVersionId_solutionKey_key" ON "question_solutions"("questionVersionId", "solutionKey");

-- CreateIndex
CREATE UNIQUE INDEX "question_provenance_questionVersionId_key" ON "question_provenance"("questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "question_rights_questionVersionId_key" ON "question_rights"("questionVersionId");

-- CreateIndex
CREATE INDEX "question_review_records_questionVersionId_createdAt_idx" ON "question_review_records"("questionVersionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "question_review_records_questionVersionId_reviewerUserId_re_key" ON "question_review_records"("questionVersionId", "reviewerUserId", "reviewType", "correlationId");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "academic_exams"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "academic_subjects"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("questionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "syllabus_nodes"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_learningObjectiveId_fkey" FOREIGN KEY ("learningObjectiveId") REFERENCES "learning_objectives"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_concept_maps" ADD CONSTRAINT "question_concept_maps_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "question_versions"("questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_concept_maps" ADD CONSTRAINT "question_concept_maps_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "academic_concepts"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_concept_maps" ADD CONSTRAINT "question_concept_maps_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_difficulty" ADD CONSTRAINT "question_difficulty_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "question_versions"("questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_hints" ADD CONSTRAINT "question_hints_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "question_versions"("questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_solutions" ADD CONSTRAINT "question_solutions_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "question_versions"("questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_provenance" ADD CONSTRAINT "question_provenance_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "question_versions"("questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_rights" ADD CONSTRAINT "question_rights_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "question_versions"("questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_review_records" ADD CONSTRAINT "question_review_records_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "question_versions"("questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_review_records" ADD CONSTRAINT "question_review_records_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Question versions and their answer-bearing children are immutable once they
-- leave draft.  The application enforces the same rule, while these triggers
-- protect the boundary for every writer, including direct SQL clients.
CREATE OR REPLACE FUNCTION prevent_question_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'question versions are historical and cannot be deleted';
  END IF;
  IF OLD.status IN ('APPROVED', 'PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'approved, published, and retired question versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER question_versions_immutable
BEFORE UPDATE OR DELETE ON "question_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_question_version_mutation();

CREATE OR REPLACE FUNCTION prevent_question_child_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_status "QuestionVersionStatus";
BEGIN
  SELECT status INTO version_status FROM "question_versions"
  WHERE "questionVersionId" = COALESCE(NEW."questionVersionId", OLD."questionVersionId");
  IF TG_OP = 'DELETE' OR version_status IN ('APPROVED', 'PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'question version content is immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER question_hints_immutable
BEFORE UPDATE OR DELETE ON "question_hints" FOR EACH ROW EXECUTE FUNCTION prevent_question_child_mutation();
CREATE TRIGGER question_solutions_immutable
BEFORE UPDATE OR DELETE ON "question_solutions" FOR EACH ROW EXECUTE FUNCTION prevent_question_child_mutation();
CREATE TRIGGER question_concept_maps_immutable
BEFORE UPDATE OR DELETE ON "question_concept_maps" FOR EACH ROW EXECUTE FUNCTION prevent_question_child_mutation();
CREATE TRIGGER question_difficulty_immutable
BEFORE UPDATE OR DELETE ON "question_difficulty" FOR EACH ROW EXECUTE FUNCTION prevent_question_child_mutation();
CREATE TRIGGER question_provenance_immutable
BEFORE UPDATE OR DELETE ON "question_provenance" FOR EACH ROW EXECUTE FUNCTION prevent_question_child_mutation();
CREATE TRIGGER question_rights_immutable
BEFORE UPDATE OR DELETE ON "question_rights" FOR EACH ROW EXECUTE FUNCTION prevent_question_child_mutation();
