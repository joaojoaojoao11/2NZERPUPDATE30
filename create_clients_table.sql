-- Tabela de Clientes para Sincronização com Tiny
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_tiny TEXT UNIQUE,
    nome TEXT,
    cpf_cnpj TEXT,
    tipo_pessoa TEXT, -- 'F' ou 'J'
    email TEXT,
    telefone TEXT,
    endereco TEXT,
    bairro TEXT,
    cidade TEXT,
    estado TEXT,
    cep TEXT,
    situacao TEXT DEFAULT 'Ativo',
    fantasia TEXT,
    inscricao_estadual TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_sync TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Política simples: Todos podem ver (já que só usuários autenticados acessam o app)
CREATE POLICY "Clients visíveis para todos autenticados" ON public.clients
    FOR ALL USING (auth.role() = 'authenticated');
