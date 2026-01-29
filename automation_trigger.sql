-- Trigger para criar Oportunidade no CRM automaticamente ao inserir novo cliente
-- Objetivo: Todo cliente que vem do Tiny (clients-integration) vira um Lead no CRM

CREATE OR REPLACE FUNCTION public.trigger_new_client_to_crm()
RETURNS TRIGGER AS $$
BEGIN
    -- Verifica se já existe oportunidade com este id_tiny para evitar duplicidade
    -- (Embora clients tenha id_tiny unico, podemos ter clientes deletados e recriados)
    -- Se não existir, insere.
    
    INSERT INTO public.crm_opportunities (
        client_name,
        company_name,
        phone,
        status,
        created_at,
        prospector,
        attendant,
        tags,
        ltv,
        xp_reward
    )
    SELECT
        NEW.nome,             -- client_name
        NEW.fantasia,         -- company_name
        NEW.telefone,         -- phone
        'QUALIFICADO',        -- status inicial padrão (Clientes Tiny já compraram)
        NOW(),                -- created_at
        'SISTEMA',            -- prospector (identifica que veio da automação)
        NULL,                 -- attendant (será atribuído depois)
        ARRAY['NOVO', 'TINY', 'CLIENTE CADASTRADO'],-- tags iniciais
        0,                    -- ltv 
        50                    -- xp_reward base
    WHERE NOT EXISTS (
        SELECT 1 FROM public.crm_opportunities 
        WHERE client_name = NEW.nome 
        -- Idealmente teríamos id_tiny em crm_opportunities também, mas vamos usar nome por enqto ou adicionar coluna
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger
DROP TRIGGER IF EXISTS trg_new_client_crm ON public.clients;
CREATE TRIGGER trg_new_client_crm
AFTER INSERT ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.trigger_new_client_to_crm();
