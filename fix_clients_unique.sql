-- Adiciona constraint UNIQUE em cpf_cnpj para permitir UPSERT
-- Isso evita duplicar clientes no banco local
ALTER TABLE public.clients
ADD CONSTRAINT clients_cpf_cnpj_key UNIQUE (cpf_cnpj);

-- Opcional: Adiciona coluna id_tiny se não existir e também torna unique
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS id_tiny TEXT;

-- Remove duplicatas antes de criar indice unique se houver sujeira (opcional, pode falhar se já tiver dups)
-- Se falhar o UNIQUE acima, precisamos limpar dados antes.
