-- Remove legacy placement uniqueness that conflicts with the approved retry-attempt model.
DROP INDEX IF EXISTS "assessment_session_placements_session_ordinal_key";
DROP INDEX IF EXISTS "assessment_session_placements_session_question_key";
