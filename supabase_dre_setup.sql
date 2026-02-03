-- DRE SETUP SCRIPT
-- Run this in your Supabase SQL Editor

-- 1. Create the mapping table
-- This table acts as a bridge between the free-text categories in your Financial Module
-- and the rigid structure required for the DRE report.
CREATE TABLE IF NOT EXISTS dre_category_mappings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  original_category_name TEXT NOT NULL, -- The text exactly as it appears in Accounts Payable/Receivable
  dre_group TEXT NOT NULL, -- 'RECEITA_BRUTA', 'DEDUCOES', 'CMV', 'DESPESAS_OPERACIONAIS', 'OUTROS'
  dre_subgroup TEXT, -- 'Vendas', 'Administrativas', 'Financeiras', 'Impostos', etc.
  is_verified BOOLEAN DEFAULT FALSE, -- True if the user manually confirmed this mapping
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure we don't map the same category twice
  CONSTRAINT unique_category_map UNIQUE (original_category_name)
);

-- 2. Enable Row Level Security (RLS)
-- This is standard practice in Supabase to secure access
ALTER TABLE dre_category_mappings ENABLE ROW LEVEL SECURITY;

-- 3. Create Policies (Allowing full access for authenticated users for now)
-- Adjust 'authenticated' to specific roles if you need stricter control later
CREATE POLICY "Allow full access to dre_mappings"
ON dre_category_mappings
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 4. Create Index for faster lookups during report generation
CREATE INDEX IF NOT EXISTS idx_dre_mapping_original_name ON dre_category_mappings (original_category_name);

-- 5. Comments for Documentation
COMMENT ON TABLE dre_category_mappings IS 'Stores the mapping rules between raw financial categories and DRE Accounting Groups';
COMMENT ON COLUMN dre_category_mappings.original_category_name IS 'The exact string found in accounts_payable.categoria or accounts_receivable.Categoria';
