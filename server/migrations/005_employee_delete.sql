-- Permite excluir um funcionário (e o histórico dele) somente dentro da transação que
-- ativa app.allow_history_delete; o snapshot completo fica na auditoria (append-only).
CREATE OR REPLACE FUNCTION forbid_history_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_history_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Registros de % são imutáveis', TG_TABLE_NAME;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER employment_history_immutable ON employment_history;
CREATE TRIGGER employment_history_immutable BEFORE UPDATE OR DELETE ON employment_history
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
