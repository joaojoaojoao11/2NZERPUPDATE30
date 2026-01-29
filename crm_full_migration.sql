-- 🔥 CRM 2.0: Unified Migration & Backfill
-- This script ensures the table structure is complete and migrates missing clients.

-- 1. ESTRUTURA: Adicionar colunas se não existirem
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_opportunities' AND column_name='tags') THEN
        ALTER TABLE public.crm_opportunities ADD COLUMN tags TEXT[] DEFAULT '{}';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_opportunities' AND column_name='ltv') THEN
        ALTER TABLE public.crm_opportunities ADD COLUMN ltv NUMERIC DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_opportunities' AND column_name='xp_reward') THEN
        ALTER TABLE public.crm_opportunities ADD COLUMN xp_reward INTEGER DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_opportunities' AND column_name='engagement_score') THEN
        ALTER TABLE public.crm_opportunities ADD COLUMN engagement_score INTEGER DEFAULT 50;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_opportunities' AND column_name='last_purchase_date') THEN
        ALTER TABLE public.crm_opportunities ADD COLUMN last_purchase_date TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='crm_opportunities' AND column_name='instagram_link') THEN
        ALTER TABLE public.crm_opportunities ADD COLUMN instagram_link TEXT;
    END IF;
END $$;

-- 2. BACKFILL: Migrar clientes que não estão no CRM
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
            'PROSPECCAO',   -- Status inicial para backfill
            NOW(),
            'SISTEMA',      -- Origem: Sistema (Backfill)
            ARRAY['BACKFILL', 'TINY'],
            0,              -- LTV 0 (será preenchido pelo sync Tiny individual)
            20,             -- XP Reward padrão para importação
            50              -- Score médio
        FROM public.clients c
        WHERE NOT EXISTS (
            SELECT 1 FROM public.crm_opportunities o 
            WHERE o.client_name = c.nome
        )
        RETURNING 1
    )
    SELECT COUNT(*) INTO total_migrados FROM new_moves;

    RAISE NOTICE 'Migração concluída! % clientes adicionados ao Pipeline CRM.', total_migrados;
END $$;
