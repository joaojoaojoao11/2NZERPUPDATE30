-- 1. Function to calculate competence from issue date
CREATE OR REPLACE FUNCTION set_default_competencia()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if Competência is null or empty
    IF NEW."Competência" IS NULL OR TRIM(NEW."Competência") = '' THEN
        -- Set Competência to YYYY-MM from Data Emissão
        -- Ensure Data Emissão is not null
        IF NEW."Data Emissão" IS NOT NULL THEN
            NEW."Competência" := TO_CHAR(NEW."Data Emissão", 'YYYY-MM');
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Trigger
DROP TRIGGER IF EXISTS trigger_ensure_competencia ON accounts_receivable;

CREATE TRIGGER trigger_ensure_competencia
BEFORE INSERT OR UPDATE ON accounts_receivable
FOR EACH ROW
EXECUTE FUNCTION set_default_competencia();

-- 3. Backfill existing data
UPDATE accounts_receivable
SET "Competência" = TO_CHAR("Data Emissão", 'YYYY-MM')
WHERE ("Competência" IS NULL OR TRIM("Competência") = '')
  AND "Data Emissão" IS NOT NULL;
