ALTER TABLE "concept_relationships"
  ADD CONSTRAINT "concept_relationships_no_self_edge"
  CHECK ("sourceId" <> "targetId");
