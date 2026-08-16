CREATE TYPE "AcademicScopeStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "academic_scopes" (
  "academicScopeId" UUID NOT NULL,
  "learnerId" UUID NOT NULL,
  "contextId" TEXT NOT NULL,
  "academicVersionId" TEXT NOT NULL,
  "status" "AcademicScopeStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "academic_scopes_pkey" PRIMARY KEY ("academicScopeId"),
  CONSTRAINT "academic_scopes_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "academic_scopes_learnerId_contextId_academicVersionId_key" ON "academic_scopes"("learnerId", "contextId", "academicVersionId");
CREATE INDEX "academic_scopes_contextId_academicVersionId_status_idx" ON "academic_scopes"("contextId", "academicVersionId", "status");
