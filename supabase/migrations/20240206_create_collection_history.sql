
-- Tabela para armazenar histórico de cobrança
CREATE TABLE IF NOT EXISTS public.collection_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    cliente TEXT NOT NULL,
    acao TEXT NOT NULL, -- 'AGENDOU_PAGTO', 'NAO_RETORNOU', 'RETORNO_SEM_AGENDAMENTO'
    observacao TEXT,
    usuario TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_collection_history_cliente ON public.collection_history(cliente);
CREATE INDEX IF NOT EXISTS idx_collection_history_created_at ON public.collection_history(created_at);
