ALTER TABLE "today_plan_versions" ADD COLUMN "semanticVersion" INTEGER;
ALTER TABLE "today_plan_versions" ADD COLUMN "rebuildGeneration" TEXT NOT NULL DEFAULT 'initial';
UPDATE "today_plan_versions" SET "semanticVersion" = "planVersion" WHERE "semanticVersion" IS NULL;
ALTER TABLE "today_plan_versions" ALTER COLUMN "semanticVersion" SET NOT NULL;
CREATE INDEX "today_plan_versions_rebuild_generation_idx"
ON "today_plan_versions" ("lineageId", "rebuildGeneration", "semanticVersion");
