-- Create pricing_engineering table
CREATE TABLE IF NOT EXISTS public.pricing_engineering (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_tiny TEXT,
    sku TEXT UNIQUE NOT NULL REFERENCES public.master_catalog(sku) ON DELETE CASCADE,
    promocao BOOLEAN DEFAULT FALSE,
    largura_l DECIMAL(10,2) DEFAULT 0,
    metragem_padrao_ml DECIMAL(10,2) DEFAULT 0,
    custo_rolo_base DECIMAL(10,2) DEFAULT 0,
    custo_total_calculado DECIMAL(10,2) DEFAULT 0,
    tem_difal BOOLEAN DEFAULT FALSE,
    custo_extra_frete DECIMAL(10,2) DEFAULT 0,
    mkp_min_atacado DECIMAL(10,2) DEFAULT 0,
    mkp_ideal_atacado DECIMAL(10,2) DEFAULT 0,
    preco_venda_min_atacado DECIMAL(10,2) DEFAULT 0,
    preco_venda_ideal_atacado DECIMAL(10,2) DEFAULT 0,
    mkp_min_fracionado DECIMAL(10,2) DEFAULT 0,
    mkp_ideal_fracionado DECIMAL(10,2) DEFAULT 0,
    preco_venda_min_fracionado DECIMAL(10,2) DEFAULT 0,
    preco_venda_ideal_fracionado DECIMAL(10,2) DEFAULT 0,
    custo_metro_fracionado DECIMAL(10,2) DEFAULT 0,
    custo_metro_bobina DECIMAL(10,2) DEFAULT 0,
    venda_ideal_metro DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.pricing_engineering ENABLE ROW LEVEL SECURITY;

-- Create Policies
CREATE POLICY "Enable all for authenticated users" ON public.pricing_engineering
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_pricing_engineering_updated_at
    BEFORE UPDATE ON public.pricing_engineering
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
