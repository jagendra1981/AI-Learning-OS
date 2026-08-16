CREATE OR REPLACE FUNCTION reject_digital_twin_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'digital twin snapshots are immutable';
END;
$$;
CREATE TRIGGER digital_twin_snapshots_immutable
BEFORE UPDATE OR DELETE ON "digital_twin_snapshots"
FOR EACH ROW EXECUTE FUNCTION reject_digital_twin_snapshot_mutation();
