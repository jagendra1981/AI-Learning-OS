CREATE TYPE "SyllabusVersionStatus" AS ENUM ('ACTIVE');

CREATE TABLE "syllabus_versions" (
  "canonicalId" TEXT NOT NULL,
  "humanVersion" TEXT NOT NULL,
  "status" "SyllabusVersionStatus" NOT NULL,
  "current" BOOLEAN NOT NULL DEFAULT false,
  "effectiveYear" INTEGER NOT NULL,
  "examId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  CONSTRAINT "syllabus_versions_pkey" PRIMARY KEY ("canonicalId"),
  CONSTRAINT "syllabus_versions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "academic_exams"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "syllabus_versions_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "academic_subjects"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "syllabus_versions_examId_subjectId_current_key" ON "syllabus_versions"("examId", "subjectId", "current");
CREATE INDEX "syllabus_versions_examId_subjectId_status_current_idx" ON "syllabus_versions"("examId", "subjectId", "status", "current");

CREATE TABLE "syllabus_version_nodes" (
  "versionId" TEXT NOT NULL,
  "syllabusNodeId" TEXT NOT NULL,
  CONSTRAINT "syllabus_version_nodes_pkey" PRIMARY KEY ("versionId", "syllabusNodeId"),
  CONSTRAINT "syllabus_version_nodes_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "syllabus_versions"("canonicalId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "syllabus_version_nodes_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "syllabus_nodes"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "syllabus_version_nodes_syllabusNodeId_idx" ON "syllabus_version_nodes"("syllabusNodeId");
INSERT INTO "syllabus_version_nodes" ("versionId", "syllabusNodeId") SELECT 'JEE_MAIN_PHYSICS_2026_V1', "canonicalId" FROM "syllabus_nodes" WHERE "chapterId" = 'MOTION_IN_STRAIGHT_LINE';

CREATE TABLE "syllabus_version_concepts" (
  "versionId" TEXT NOT NULL,
  "conceptId" TEXT NOT NULL,
  CONSTRAINT "syllabus_version_concepts_pkey" PRIMARY KEY ("versionId", "conceptId"),
  CONSTRAINT "syllabus_version_concepts_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "syllabus_versions"("canonicalId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "syllabus_version_concepts_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "academic_concepts"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "syllabus_version_concepts" ("versionId", "conceptId") SELECT 'JEE_MAIN_PHYSICS_2026_V1', "canonicalId" FROM "academic_concepts" WHERE "chapterId" = 'MOTION_IN_STRAIGHT_LINE';

ALTER TABLE "concept_relationships" ADD COLUMN "versionId" TEXT;
UPDATE "concept_relationships" SET "versionId" = 'JEE_MAIN_PHYSICS_2026_V1';
ALTER TABLE "concept_relationships" ALTER COLUMN "versionId" SET NOT NULL;
ALTER TABLE "concept_relationships" DROP CONSTRAINT "concept_relationships_pkey";
ALTER TABLE "concept_relationships" ADD CONSTRAINT "concept_relationships_pkey" PRIMARY KEY ("versionId", "sourceId", "type", "targetId");
ALTER TABLE "concept_relationships" ADD CONSTRAINT "concept_relationships_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "syllabus_versions"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "concept_relationships_versionId_targetId_idx" ON "concept_relationships"("versionId", "targetId");

ALTER TABLE "syllabus_concept_mappings" ADD COLUMN "versionId" TEXT;
UPDATE "syllabus_concept_mappings" SET "versionId" = 'JEE_MAIN_PHYSICS_2026_V1';
ALTER TABLE "syllabus_concept_mappings" ALTER COLUMN "versionId" SET NOT NULL;
ALTER TABLE "syllabus_concept_mappings" DROP CONSTRAINT "syllabus_concept_mappings_pkey";
ALTER TABLE "syllabus_concept_mappings" ADD CONSTRAINT "syllabus_concept_mappings_pkey" PRIMARY KEY ("versionId", "syllabusNodeId", "conceptId");
ALTER TABLE "syllabus_concept_mappings" ADD CONSTRAINT "syllabus_concept_mappings_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "syllabus_versions"("canonicalId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "objective_concept_mappings" ADD COLUMN "versionId" TEXT;
UPDATE "objective_concept_mappings" SET "versionId" = 'JEE_MAIN_PHYSICS_2026_V1';
ALTER TABLE "objective_concept_mappings" ALTER COLUMN "versionId" SET NOT NULL;
ALTER TABLE "objective_concept_mappings" DROP CONSTRAINT "objective_concept_mappings_pkey";
ALTER TABLE "objective_concept_mappings" ADD CONSTRAINT "objective_concept_mappings_pkey" PRIMARY KEY ("versionId", "objectiveId", "conceptId");
ALTER TABLE "objective_concept_mappings" ADD CONSTRAINT "objective_concept_mappings_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "syllabus_versions"("canonicalId") ON DELETE CASCADE ON UPDATE CASCADE;
