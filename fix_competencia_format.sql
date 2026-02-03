-- Normalizar datas no formato MM/YYYY para YYYY-MM
UPDATE accounts_receivable
SET "Competência" = RIGHT("Competência", 4) || '-' || LEFT("Competência", 2)
WHERE "Competência" LIKE '__/____';

UPDATE accounts_payable
SET competencia = RIGHT(competencia, 4) || '-' || LEFT(competencia, 2)
WHERE competencia LIKE '__/____';
