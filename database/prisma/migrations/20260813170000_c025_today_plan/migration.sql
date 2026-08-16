CREATE TABLE "today_plan_lineages" (
  "lineageId" UUID NOT NULL DEFAULT gen_random_uuid(), "learnerId" UUID NOT NULL,
  "contextId" TEXT NOT NULL, "academicVersionId" TEXT NOT NULL, "planDateLocal" TEXT NOT NULL,
  "learnerTimezone" TEXT NOT NULL, "currentVersion" INTEGER, "revision" INTEGER NOT NULL DEFAULT 0,
  "watermark" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "today_plan_lineages_pkey" PRIMARY KEY ("lineageId"),
  CONSTRAINT "today_plan_lineages_scope_key" UNIQUE ("learnerId","contextId","academicVersionId","planDateLocal","learnerTimezone")
);
CREATE TABLE "today_plan_versions" (
  "planVersionId" UUID NOT NULL DEFAULT gen_random_uuid(), "lineageId" UUID NOT NULL,
  "planVersion" INTEGER NOT NULL, "planDateLocal" TEXT NOT NULL, "learnerTimezone" TEXT NOT NULL,
  "state" TEXT NOT NULL, "reason" TEXT, "sourceGenerationId" TEXT, "c024Binding" JSONB NOT NULL,
  "capacityMinutes" INTEGER NOT NULL DEFAULT 120, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "today_plan_versions_pkey" PRIMARY KEY ("planVersionId"),
  CONSTRAINT "today_plan_versions_unique" UNIQUE ("lineageId","planVersion"),
  CONSTRAINT "today_plan_versions_lineage_fk" FOREIGN KEY ("lineageId") REFERENCES "today_plan_lineages"("lineageId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "today_plan_items" (
  "planItemId" UUID NOT NULL DEFAULT gen_random_uuid(), "planVersionId" UUID NOT NULL,
  "semanticItemKey" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "candidateBinding" JSONB NOT NULL,
  "targetRefId" TEXT NOT NULL, "durationMinutes" INTEGER NOT NULL, "mandatory" BOOLEAN NOT NULL,
  "availabilitySnapshot" JSONB NOT NULL, "state" TEXT NOT NULL, "itemVersion" INTEGER NOT NULL DEFAULT 1,
  "completionProvenance" JSONB, "postponementProvenance" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "today_plan_items_pkey" PRIMARY KEY ("planItemId"),
  CONSTRAINT "today_plan_items_sequence_key" UNIQUE ("planVersionId","sequence"),
  CONSTRAINT "today_plan_items_semantic_key" UNIQUE ("planVersionId","semanticItemKey"),
  CONSTRAINT "today_plan_items_plan_fk" FOREIGN KEY ("planVersionId") REFERENCES "today_plan_versions"("planVersionId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "today_plan_event_ledger" (
  "eventLedgerId" UUID NOT NULL DEFAULT gen_random_uuid(), "lineageId" UUID NOT NULL,
  "immutableEventId" TEXT NOT NULL, "payloadHash" TEXT NOT NULL, "effectiveAt" TIMESTAMP(3) NOT NULL,
  "operationRank" INTEGER NOT NULL, "actorId" UUID NOT NULL, "source" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "today_plan_event_ledger_pkey" PRIMARY KEY ("eventLedgerId"),
  CONSTRAINT "today_plan_event_unique" UNIQUE ("lineageId","immutableEventId"),
  CONSTRAINT "today_plan_event_lineage_fk" FOREIGN KEY ("lineageId") REFERENCES "today_plan_lineages"("lineageId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "today_plan_event_order_idx" ON "today_plan_event_ledger" ("lineageId","effectiveAt","operationRank","immutableEventId");
CREATE TABLE "today_plan_history" (
  "historyId" UUID NOT NULL DEFAULT gen_random_uuid(), "lineageId" UUID NOT NULL, "generationId" TEXT NOT NULL,
  "planVersion" INTEGER NOT NULL, "intent" JSONB NOT NULL, "watermark" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "today_plan_history_pkey" PRIMARY KEY ("historyId"),
  CONSTRAINT "today_plan_history_generation_key" UNIQUE ("lineageId","generationId"),
  CONSTRAINT "today_plan_history_lineage_fk" FOREIGN KEY ("lineageId") REFERENCES "today_plan_lineages"("lineageId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "today_plan_provenance" (
  "provenanceId" UUID NOT NULL DEFAULT gen_random_uuid(), "planVersionId" UUID NOT NULL, "engineId" TEXT NOT NULL,
  "algorithmId" TEXT NOT NULL, "configId" TEXT NOT NULL, "processingVersion" TEXT NOT NULL, "contractVersion" TEXT NOT NULL,
  "refs" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "today_plan_provenance_pkey" PRIMARY KEY ("provenanceId"),
  CONSTRAINT "today_plan_provenance_plan_fk" FOREIGN KEY ("planVersionId") REFERENCES "today_plan_versions"("planVersionId") ON DELETE RESTRICT ON UPDATE CASCADE
);
