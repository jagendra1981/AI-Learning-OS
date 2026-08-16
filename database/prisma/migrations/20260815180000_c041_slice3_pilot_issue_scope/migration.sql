ALTER TABLE "academic_issues" ADD COLUMN "pilotId" UUID;

CREATE INDEX "academic_issues_pilotId_status_createdAt_idx" ON "academic_issues"("pilotId", "status", "createdAt");

ALTER TABLE "academic_issues" ADD CONSTRAINT "academic_issues_pilotId_fkey"
  FOREIGN KEY ("pilotId") REFERENCES "pilots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
