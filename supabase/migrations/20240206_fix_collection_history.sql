
-- Script de Correção para Tabela collection_history
-- Rode este script no Editor SQL do Supabase para garantir que todas as colunas existam

-- 1. Cria a tabela se não existir
CREATE TABLE IF NOT EXISTS public.collection_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Adiciona as colunas individualmente caso faltem
DO $$
BEGIN
    BEGIN
        ALTER TABLE public.collection_history ADD COLUMN cliente TEXT;
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'column cliente already exists in collection_history.';
    END;
    
    BEGIN
        ALTER TABLE public.collection_history ADD COLUMN acao TEXT;
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'column acao already exists in collection_history.';
    END;

    BEGIN
        ALTER TABLE public.collection_history ADD COLUMN observacao TEXT;
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'column observacao already exists in collection_history.';
    END;

    BEGIN
        ALTER TABLE public.collection_history ADD COLUMN usuario TEXT;
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'column usuario already exists in collection_history.';
    END;
END;
$$;

-- 3. Atualiza permissões
GRANT ALL ON public.collection_history TO postgres;
GRANT ALL ON public.collection_history TO anon;
GRANT ALL ON public.collection_history TO authenticated;
GRANT ALL ON public.collection_history TO service_role;

-- 4. Notifica o Postgrest para recarregar o cache de schema (apenas funciona se executado como superuser/postgres)
NOTIFY pgrst, 'reload schema';
