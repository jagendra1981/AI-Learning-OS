CREATE OR REPLACE FUNCTION reject_today_plan_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'today plan event ledger is immutable';
END;
$$;
CREATE TRIGGER today_plan_event_ledger_immutable
BEFORE UPDATE OR DELETE ON "today_plan_event_ledger"
FOR EACH ROW EXECUTE FUNCTION reject_today_plan_event_mutation();

CREATE OR REPLACE FUNCTION reject_today_plan_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'today plan history is immutable';
END;
$$;
CREATE TRIGGER today_plan_history_immutable
BEFORE UPDATE OR DELETE ON "today_plan_history"
FOR EACH ROW EXECUTE FUNCTION reject_today_plan_history_mutation();

CREATE OR REPLACE FUNCTION reject_today_plan_provenance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'today plan provenance is immutable';
END;
$$;
CREATE TRIGGER today_plan_provenance_immutable
BEFORE UPDATE OR DELETE ON "today_plan_provenance"
FOR EACH ROW EXECUTE FUNCTION reject_today_plan_provenance_mutation();
