-- 1. Function to calculate competence from issue date for Accounts Payable
CREATE OR REPLACE FUNCTION set_default_competencia_ap()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if competencia is null or empty
    IF NEW.competencia IS NULL OR TRIM(NEW.competencia) = '' THEN
        -- Set competencia to YYYY-MM from data_emissao
        -- Ensure data_emissao is not null
        IF NEW.data_emissao IS NOT NULL THEN
            NEW.competencia := TO_CHAR(NEW.data_emissao, 'YYYY-MM');
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Trigger
DROP TRIGGER IF EXISTS trigger_ensure_competencia_ap ON accounts_payable;

CREATE TRIGGER trigger_ensure_competencia_ap
BEFORE INSERT OR UPDATE ON accounts_payable
FOR EACH ROW
EXECUTE FUNCTION set_default_competencia_ap();

-- 3. Backfill existing data
UPDATE accounts_payable
SET competencia = TO_CHAR(data_emissao, 'YYYY-MM')
WHERE (competencia IS NULL OR TRIM(competencia) = '')
  AND data_emissao IS NOT NULL;
