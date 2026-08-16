ALTER TABLE "mistake_dna_transitions"
  ADD COLUMN "semanticOrder" INTEGER;

CREATE UNIQUE INDEX "mistake_dna_transitions_generationId_semanticOrder_key"
  ON "mistake_dna_transitions"("generationId", "semanticOrder");

ALTER TABLE "mistake_dna_transitions"
  ADD CONSTRAINT "mistake_dna_transitions_generationId_fkey"
  FOREIGN KEY ("generationId")
  REFERENCES "mistake_dna_projection_generations"("generationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mistake_dna_patterns"
  ADD CONSTRAINT "mistake_dna_patterns_activeGenerationId_fkey"
  FOREIGN KEY ("activeGenerationId")
  REFERENCES "mistake_dna_projection_generations"("generationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
