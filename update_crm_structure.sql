-- Migration CRM 2.0: Adicionar campos de enriquecimento e gamificação
-- Este script adiciona as colunas necessárias na tabela crm_opportunities

ALTER TABLE public.crm_opportunities 
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS ltv NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS xp_reward INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS engagement_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_purchase_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS instagram_link TEXT;

-- Comentário para documentação das colunas
COMMENT ON COLUMN public.crm_opportunities.tags IS 'Tags para segmentação rápida (ex: VIP, Novo, Inativo)';
COMMENT ON COLUMN public.crm_opportunities.ltv IS 'Life Time Value - Valor total vendido para o cliente';
COMMENT ON COLUMN public.crm_opportunities.xp_reward IS 'Pontos de experiência (XP) que este lead vale para o vendedor';
COMMENT ON COLUMN public.crm_opportunities.engagement_score IS 'Pontuação de engajamento do cliente (0-100)';

-- Confirmação
DO $$
BEGIN
    RAISE NOTICE 'Estrutura da tabela crm_opportunities atualizada com sucesso para o CRM 2.0';
END $$;
