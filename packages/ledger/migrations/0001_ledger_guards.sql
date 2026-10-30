-- Ledger entries are append-only. Corrections are reversing entries.
CREATE FUNCTION ledger_entries_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_update_delete
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_append_only();
--> statement-breakpoint
-- Deferred to commit so a payment's debit and credit can be inserted one at a time.
CREATE FUNCTION ledger_entries_balanced() RETURNS trigger AS $$
DECLARE
  total numeric;
BEGIN
  SELECT coalesce(sum(amount_minor), 0) INTO total
    FROM ledger_entries WHERE payment_id = NEW.payment_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'payment % is unbalanced by %', NEW.payment_id, total;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entries_balanced_at_commit
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_balanced();
