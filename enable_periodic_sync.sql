-- Agendamento Automático de Sincronização de Clientes (A cada 6 horas)

-- 1. Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Limpar agendamento anterior (se existir) para evitar duplicidade
SELECT cron.unschedule('sync-clients-periodic');

-- 3. Criar o agendamento
SELECT cron.schedule(
    'sync-clients-periodic',         -- Nome do Job
    '0 */6 * * *',                   -- Cronômetro: Minuto 0, a cada 6 horas (ex: 00:00, 06:00, 12:00, 18:00)
    $$
    SELECT
        net.http_post(
            url:='https://ipehorttsrvjynnhyzhu.supabase.co/functions/v1/clients-integration',
            headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlwZWhvcnR0c3J2anlubmh5emh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2MDYwNTMsImV4cCI6MjA4MjE4MjA1M30.m6GW1AckPRGVP8wagfc9t4hzjvMOlHoEIskS36eKwDU"}'::jsonb,
            body:='{}'::jsonb
        ) as request_id;
    $$
);
