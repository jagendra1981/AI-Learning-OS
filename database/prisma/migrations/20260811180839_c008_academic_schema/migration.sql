-- CreateEnum
CREATE TYPE "AcademicRelationshipType" AS ENUM ('PREREQUISITE_OF', 'PART_OF', 'RELATED_TO');

-- AlterTable
ALTER TABLE IF EXISTS "audit_events" ALTER COLUMN "auditEventId" DROP DEFAULT;

-- AlterTable
ALTER TABLE IF EXISTS "exam_goals" ALTER COLUMN "examGoalId" DROP DEFAULT;

-- CreateTable
CREATE TABLE "academic_exams" (
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_exams_pkey" PRIMARY KEY ("canonicalId")
);

-- CreateTable
CREATE TABLE "academic_subjects" (
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "examId" TEXT NOT NULL,

    CONSTRAINT "academic_subjects_pkey" PRIMARY KEY ("canonicalId")
);

-- CreateTable
CREATE TABLE "academic_domains" (
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,

    CONSTRAINT "academic_domains_pkey" PRIMARY KEY ("canonicalId")
);

-- CreateTable
CREATE TABLE "academic_units" (
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,

    CONSTRAINT "academic_units_pkey" PRIMARY KEY ("canonicalId")
);

-- CreateTable
CREATE TABLE "academic_chapters" (
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,

    CONSTRAINT "academic_chapters_pkey" PRIMARY KEY ("canonicalId")
);

-- CreateTable
CREATE TABLE "syllabus_nodes" (
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "syllabus_nodes_pkey" PRIMARY KEY ("canonicalId")
);

-- CreateTable
CREATE TABLE "academic_concepts" (
    "canonicalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,

    CONSTRAINT "academic_concepts_pkey" PRIMARY KEY ("canonicalId")
);

-- CreateTable
CREATE TABLE "concept_relationships" (
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "type" "AcademicRelationshipType" NOT NULL,

    CONSTRAINT "concept_relationships_pkey" PRIMARY KEY ("sourceId","type","targetId")
);

-- CreateTable
CREATE TABLE "learning_objectives" (
    "canonicalId" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "learning_objectives_pkey" PRIMARY KEY ("canonicalId")
);

-- CreateTable
CREATE TABLE "syllabus_concept_mappings" (
    "syllabusNodeId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,

    CONSTRAINT "syllabus_concept_mappings_pkey" PRIMARY KEY ("syllabusNodeId","conceptId")
);

-- CreateTable
CREATE TABLE "objective_concept_mappings" (
    "objectiveId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,

    CONSTRAINT "objective_concept_mappings_pkey" PRIMARY KEY ("objectiveId","conceptId")
);

-- CreateIndex
CREATE INDEX "academic_subjects_examId_idx" ON "academic_subjects"("examId");

-- CreateIndex
CREATE UNIQUE INDEX "academic_subjects_examId_canonicalId_key" ON "academic_subjects"("examId", "canonicalId");

-- CreateIndex
CREATE INDEX "academic_domains_subjectId_idx" ON "academic_domains"("subjectId");

-- CreateIndex
CREATE INDEX "academic_units_domainId_idx" ON "academic_units"("domainId");

-- CreateIndex
CREATE INDEX "academic_chapters_unitId_idx" ON "academic_chapters"("unitId");

-- CreateIndex
CREATE INDEX "syllabus_nodes_chapterId_idx" ON "syllabus_nodes"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_nodes_chapterId_order_key" ON "syllabus_nodes"("chapterId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_nodes_chapterId_canonicalId_key" ON "syllabus_nodes"("chapterId", "canonicalId");

-- CreateIndex
CREATE INDEX "academic_concepts_chapterId_idx" ON "academic_concepts"("chapterId");

-- CreateIndex
CREATE INDEX "concept_relationships_targetId_idx" ON "concept_relationships"("targetId");

-- CreateIndex
CREATE INDEX "syllabus_concept_mappings_conceptId_idx" ON "syllabus_concept_mappings"("conceptId");

-- CreateIndex
CREATE INDEX "objective_concept_mappings_conceptId_idx" ON "objective_concept_mappings"("conceptId");

-- AddForeignKey
ALTER TABLE "academic_subjects" ADD CONSTRAINT "academic_subjects_examId_fkey" FOREIGN KEY ("examId") REFERENCES "academic_exams"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_domains" ADD CONSTRAINT "academic_domains_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "academic_subjects"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_units" ADD CONSTRAINT "academic_units_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "academic_domains"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_chapters" ADD CONSTRAINT "academic_chapters_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "academic_units"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_nodes" ADD CONSTRAINT "syllabus_nodes_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "academic_chapters"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_concepts" ADD CONSTRAINT "academic_concepts_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "academic_chapters"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_relationships" ADD CONSTRAINT "concept_relationships_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "academic_concepts"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_relationships" ADD CONSTRAINT "concept_relationships_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "academic_concepts"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_concept_mappings" ADD CONSTRAINT "syllabus_concept_mappings_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "syllabus_nodes"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_concept_mappings" ADD CONSTRAINT "syllabus_concept_mappings_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "academic_concepts"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_concept_mappings" ADD CONSTRAINT "objective_concept_mappings_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "learning_objectives"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_concept_mappings" ADD CONSTRAINT "objective_concept_mappings_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "academic_concepts"("canonicalId") ON DELETE RESTRICT ON UPDATE CASCADE;
