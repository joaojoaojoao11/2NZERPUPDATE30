-- Script de Backfill: Migrar todos os clientes existentes para o CRM
-- Objetivo: Popular a tabela crm_opportunities com clientes que já existem em clients mas não estão no CRM.

DO $$
DECLARE
    total_migrados INTEGER := 0;
BEGIN
    WITH new_moves AS (
        INSERT INTO public.crm_opportunities (
            client_name,
            company_name,
            phone,
            status,
            created_at,
            prospector,
            tags,
            ltv,
            xp_reward,
            engagement_score
        )
        SELECT
            c.nome,
            c.fantasia,
            c.telefone,
            'PROSPECCAO',   -- Status inicial
            NOW(),
            'SISTEMA',      -- Origem: Sistema (Backfill)
            ARRAY['BACKFILL', 'TINY'],
            0,              -- LTV 0 inicial (será enriquecido depois)
            20,             -- XP reduzido para importação em massa
            50              -- Score médio
        FROM public.clients c
        WHERE NOT EXISTS (
            SELECT 1 FROM public.crm_opportunities o 
            WHERE o.client_name = c.nome
        )
        RETURNING 1
    )
    SELECT COUNT(*) INTO total_migrados FROM new_moves;

    RAISE NOTICE 'Backfill concluído! Total de novas oportunidades criadas: %', total_migrados;
END $$;
