CREATE TABLE "learning_events" (
  "eventId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "learnerUserId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "sourceComponent" TEXT NOT NULL,
  "sourceAggregateType" TEXT NOT NULL,
  "sourceAggregateId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "causationId" UUID,
  "idempotencyKey" TEXT NOT NULL,
  "academicContext" JSONB,
  "payload" JSONB NOT NULL,
  CONSTRAINT "learning_events_pkey" PRIMARY KEY ("eventId"),
  CONSTRAINT "learning_events_learner_fkey" FOREIGN KEY ("learnerUserId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "learning_events_actor_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "learning_events_causation_fkey" FOREIGN KEY ("causationId") REFERENCES "learning_events"("eventId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "learning_events_schema_version_chk" CHECK ("schemaVersion" = 1)
);
CREATE UNIQUE INDEX "learning_events_idempotency_key_key" ON "learning_events"("idempotencyKey");
CREATE INDEX "learning_events_learner_recorded_idx" ON "learning_events"("learnerUserId", "recordedAt");
CREATE INDEX "learning_events_correlation_idx" ON "learning_events"("correlationId");
CREATE INDEX "learning_events_event_type_idx" ON "learning_events"("eventType");
CREATE INDEX "learning_events_source_idx" ON "learning_events"("sourceAggregateType", "sourceAggregateId");
CREATE INDEX "learning_events_causation_idx" ON "learning_events"("causationId");
CREATE OR REPLACE FUNCTION reject_learning_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'learning events are append-only'; END; $$;
CREATE TRIGGER learning_events_append_only BEFORE UPDATE OR DELETE ON "learning_events" FOR EACH ROW EXECUTE FUNCTION reject_learning_event_mutation();
