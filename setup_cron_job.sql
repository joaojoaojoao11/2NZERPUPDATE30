-- 1. Habilitar extensões necessárias
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Limpar job antigo para evitar duplicidade
select cron.unschedule('sync-tiny-sales-hourly');

-- 3. Agendar novo Job (A cada 60 minutos)
SELECT cron.schedule(
    'sync-tiny-sales-hourly',
    '0 * * * *', 
    $$
    SELECT
      net.http_post(
          url:='https://ipehorttsrvjynnhyzhu.supabase.co/functions/v1/olist-integration',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer <INSIRA_SUA_SERVICE_ROLE_KEY_AQUI>"}'::jsonb
      ) as request_id;
    $$
);

-- Para verificar se foi criado:
-- select * from cron.job;

-- Para remover se necessário:
-- select cron.unschedule('sync-tiny-sales-hourly');
