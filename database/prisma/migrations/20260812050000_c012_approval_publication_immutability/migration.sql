-- C012: allow controlled lifecycle changes without allowing academic-content edits.
CREATE OR REPLACE FUNCTION prevent_question_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'question versions are historical and cannot be deleted';
  END IF;

  IF OLD.status = 'APPROVED' THEN
    IF NEW.status <> 'PUBLISHED'
      OR NEW."questionVersionId" IS DISTINCT FROM OLD."questionVersionId"
      OR NEW."questionId" IS DISTINCT FROM OLD."questionId"
      OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber"
      OR NEW."questionType" IS DISTINCT FROM OLD."questionType"
      OR NEW.stem IS DISTINCT FROM OLD.stem
      OR NEW.options IS DISTINCT FROM OLD.options
      OR NEW."correctAnswerRef" IS DISTINCT FROM OLD."correctAnswerRef"
      OR NEW."explanationRef" IS DISTINCT FROM OLD."explanationRef"
      OR NEW."syllabusNodeId" IS DISTINCT FROM OLD."syllabusNodeId"
      OR NEW."learningObjectiveId" IS DISTINCT FROM OLD."learningObjectiveId"
      OR NEW.locale IS DISTINCT FROM OLD.locale
      OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'approved question versions permit only APPROVED to PUBLISHED';
    END IF;
  ELSIF OLD.status = 'PUBLISHED' THEN
    IF NEW.status <> 'RETIRED'
      OR NEW."questionVersionId" IS DISTINCT FROM OLD."questionVersionId"
      OR NEW."questionId" IS DISTINCT FROM OLD."questionId"
      OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber"
      OR NEW."questionType" IS DISTINCT FROM OLD."questionType"
      OR NEW.stem IS DISTINCT FROM OLD.stem
      OR NEW.options IS DISTINCT FROM OLD.options
      OR NEW."correctAnswerRef" IS DISTINCT FROM OLD."correctAnswerRef"
      OR NEW."explanationRef" IS DISTINCT FROM OLD."explanationRef"
      OR NEW."syllabusNodeId" IS DISTINCT FROM OLD."syllabusNodeId"
      OR NEW."learningObjectiveId" IS DISTINCT FROM OLD."learningObjectiveId"
      OR NEW.locale IS DISTINCT FROM OLD.locale
      OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'published question versions permit only retirement';
    END IF;
  ELSIF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'retired question versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;
