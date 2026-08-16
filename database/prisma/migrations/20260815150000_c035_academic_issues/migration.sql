CREATE TYPE "AcademicIssueStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "academic_issues" (
    "issueId" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "examId" TEXT,
    "subjectId" TEXT,
    "summary" TEXT NOT NULL,
    "status" "AcademicIssueStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_issues_pkey" PRIMARY KEY ("issueId")
);

CREATE INDEX "academic_issues_status_createdAt_idx" ON "academic_issues"("status", "createdAt");
