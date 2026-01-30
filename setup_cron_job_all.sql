-- 1. Habilitar extensões necessárias
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Limpar Jobs Antigos (para evitar duplicidade)
DO $$
BEGIN
    PERFORM cron.unschedule('sync-finance-10min');
    PERFORM cron.unschedule('sync-expense-10min');
    PERFORM cron.unschedule('sync-expense-enricher-20min');
    PERFORM cron.unschedule('sync-clients-hourly');
    -- Mantemos o olist-integration separado ou recriamos aqui também? Vamos recriar para garantir padrao.
    PERFORM cron.unschedule('sync-tiny-sales-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


-- 3. AGENDAMENTOS (Cronograma Oficial)

-- A) Financeiro (Contas a Receber) - A cada 10 min
SELECT cron.schedule(
    'sync-finance-10min',
    '*/10 * * * *',
    $$
    SELECT net.http_post(
        url:='https://ipehorttsrvjynnhyzhu.supabase.co/functions/v1/finance-integration',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer SUACHAVEAQUI"}'::jsonb
    ) as request_id;
    $$
);

-- B) Despesas (Contas a Pagar) - A cada 10 min (Offset 5 min: 5, 15, 25...)
SELECT cron.schedule(
    'sync-expense-10min',
    '5-55/10 * * * *',
    $$
    SELECT net.http_post(
        url:='https://ipehorttsrvjynnhyzhu.supabase.co/functions/v1/expense-integration',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer SUACHAVEAQUI"}'::jsonb
    ) as request_id;
    $$
);

-- C) Enriquecimento de Despesas (Detalhes finos) - A cada 20 min
SELECT cron.schedule(
    'sync-expense-enricher-20min',
    '*/20 * * * *',
    $$
    SELECT net.http_post(
        url:='https://ipehorttsrvjynnhyzhu.supabase.co/functions/v1/expense-enricher',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer SUACHAVEAQUI"}'::jsonb
    ) as request_id;
    $$
);

-- D) Clientes - A cada 1 Hora (minuto 30)
SELECT cron.schedule(
    'sync-clients-hourly',
    '30 * * * *',
    $$
    SELECT net.http_post(
        url:='https://ipehorttsrvjynnhyzhu.supabase.co/functions/v1/clients-integration',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer SUACHAVEAQUI"}'::jsonb
    ) as request_id;
    $$
);

-- E) Vendas (Tiny/Olist) - A cada 1 Hora (minuto 00)
SELECT cron.schedule(
    'sync-tiny-sales-hourly',
    '0 * * * *',
    $$
    SELECT net.http_post(
        url:='https://ipehorttsrvjynnhyzhu.supabase.co/functions/v1/olist-integration',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer SUACHAVEAQUI"}'::jsonb
    ) as request_id;
    $$
);
