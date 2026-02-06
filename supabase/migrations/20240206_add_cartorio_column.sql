
-- Adicionar coluna 'cartorio' na tabela accounts_receivable
DO $$
BEGIN
    ALTER TABLE public.accounts_receivable ADD COLUMN IF NOT EXISTS cartorio BOOLEAN DEFAULT false;
EXCEPTION
    WHEN duplicate_column THEN RAISE NOTICE 'column cartorio already exists.';
END;
$$;

NOTIFY pgrst, 'reload schema';
