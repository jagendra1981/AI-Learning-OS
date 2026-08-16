ALTER TABLE "mistake_dna_projection_generations"
  ADD COLUMN "patternSignature" TEXT;

UPDATE "mistake_dna_projection_generations" AS generation
SET "patternSignature" = source."patternSignature"
FROM (
  SELECT DISTINCT ON ("generationId") "generationId", "patternSignature"
  FROM "mistake_dna_transitions"
  WHERE "generationId" IS NOT NULL
  ORDER BY "generationId", "createdAt" ASC
) AS source
WHERE generation."generationId" = source."generationId";

UPDATE "mistake_dna_projection_generations" AS generation
SET "patternSignature" = pattern."patternSignature"
FROM "mistake_dna_patterns" AS pattern
WHERE pattern."activeGenerationId" = generation."generationId"
  AND generation."patternSignature" IS NULL;

DELETE FROM "mistake_dna_projection_generations"
WHERE "patternSignature" IS NULL;

ALTER TABLE "mistake_dna_projection_generations"
  ALTER COLUMN "patternSignature" SET NOT NULL;

DROP INDEX "mistake_dna_projection_generations_scope_idx";
CREATE INDEX "mistake_dna_projection_generations_scope_idx"
  ON "mistake_dna_projection_generations"(
    "learnerId",
    "conceptId",
    "academicContextIdentity",
    "patternSignature"
  );

CREATE OR REPLACE FUNCTION enforce_mistake_dna_generation_scope()
RETURNS trigger AS $$
DECLARE generation_record "mistake_dna_projection_generations"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'mistake_dna_patterns' THEN
    IF NEW."activeGenerationId" IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO generation_record
    FROM "mistake_dna_projection_generations"
    WHERE "generationId" = NEW."activeGenerationId";
  ELSE
    IF NEW."generationId" IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO generation_record
    FROM "mistake_dna_projection_generations"
    WHERE "generationId" = NEW."generationId";
  END IF;

  IF generation_record."learnerId" <> NEW."learnerId"
    OR generation_record."conceptId" <> NEW."conceptId"
    OR generation_record."academicContextIdentity" <> NEW."academicContextIdentity"
    OR generation_record."patternSignature" <> NEW."patternSignature"
    OR generation_record."engineId" <> NEW."engineId"
    OR generation_record."configId" <> NEW."configId"
    OR generation_record."processingVersion" <> NEW."processingVersion"
  THEN
    RAISE EXCEPTION 'mistake dna generation scope mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mistake_dna_pattern_generation_scope
BEFORE INSERT OR UPDATE OF "activeGenerationId" ON "mistake_dna_patterns"
FOR EACH ROW EXECUTE FUNCTION enforce_mistake_dna_generation_scope();

CREATE TRIGGER mistake_dna_transition_generation_scope
BEFORE INSERT ON "mistake_dna_transitions"
FOR EACH ROW EXECUTE FUNCTION enforce_mistake_dna_generation_scope();
