
-- Garantir permissões na nova coluna para todos os roles
GRANT SELECT, UPDATE(cartorio) ON public.accounts_receivable TO authenticated;
GRANT SELECT, UPDATE(cartorio) ON public.accounts_receivable TO service_role;
GRANT SELECT, UPDATE(cartorio) ON public.accounts_receivable TO anon;

-- Recarregar cache
NOTIFY pgrst, 'reload schema';
