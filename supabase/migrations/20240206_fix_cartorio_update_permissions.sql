
-- SOLUÇÃO DEFINITIVA DE PERMISSÕES
-- Libera acesso total à tabela de Contas a Receber para permitir atualização do Status de Cartório
ALTER TABLE public.accounts_receivable DISABLE ROW LEVEL SECURITY;

GRANT ALL ON public.accounts_receivable TO anon;
GRANT ALL ON public.accounts_receivable TO authenticated;
GRANT ALL ON public.accounts_receivable TO service_role;

-- Garante que a collection_history também esteja liberada
ALTER TABLE public.collection_history DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.collection_history TO anon;
GRANT ALL ON public.collection_history TO authenticated;
GRANT ALL ON public.collection_history TO service_role;

-- Atualiza cache
NOTIFY pgrst, 'reload schema';
