
-- Script de Permissões Totais para collection_history
-- Rode este script para eliminar erros de "Permission denied" ou RLS

-- 1. Desabilita RLS temporariamente para garantir acesso
ALTER TABLE public.collection_history DISABLE ROW LEVEL SECURITY;

-- 2. Garante permissões de escrita/leitura para todos os roles (anon, authenticated, service_role)
GRANT ALL ON public.collection_history TO postgres;
GRANT ALL ON public.collection_history TO anon;
GRANT ALL ON public.collection_history TO authenticated;
GRANT ALL ON public.collection_history TO service_role;

-- 3. (Opcional) Se decidir ativar RLS no futuro, esta política permitiria tudo:
-- CREATE POLICY "Allow All" ON public.collection_history FOR ALL USING (true) WITH CHECK (true);

-- 4. Recarrega cache do schema do Supabase
NOTIFY pgrst, 'reload schema';
