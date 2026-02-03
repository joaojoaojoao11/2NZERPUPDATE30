-- FORÇAR a atualização da Competência para Data de Emissão (Contas a Receber)
-- Corrigindo registros onde a competência pode ter sido gravada incorretamente (ex: data de vencimento)
UPDATE accounts_receivable
SET "Competência" = TO_CHAR("Data Emissão", 'YYYY-MM')
WHERE "Data Emissão" IS NOT NULL;

-- FORÇAR a atualização da Competência para Data de Emissão (Contas a Pagar)
-- Garantindo consistência nas despesas também
UPDATE accounts_payable
SET competencia = TO_CHAR(data_emissao, 'YYYY-MM')
WHERE data_emissao IS NOT NULL;
