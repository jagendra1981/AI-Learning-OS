CREATE OR REPLACE FUNCTION protect_today_plan_version_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'today plan versions are immutable';
  END IF;
  IF (to_jsonb(NEW) - 'state') IS DISTINCT FROM (to_jsonb(OLD) - 'state') THEN
    RAISE EXCEPTION 'today plan version metadata is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER today_plan_versions_history_protected
BEFORE UPDATE OR DELETE ON "today_plan_versions"
FOR EACH ROW EXECUTE FUNCTION protect_today_plan_version_history();

CREATE OR REPLACE FUNCTION protect_today_plan_item_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'today plan items are immutable';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['state','completionProvenance','postponementProvenance'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['state','completionProvenance','postponementProvenance']) THEN
    RAISE EXCEPTION 'today plan item semantic binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER today_plan_items_history_protected
BEFORE UPDATE OR DELETE ON "today_plan_items"
FOR EACH ROW EXECUTE FUNCTION protect_today_plan_item_history();
