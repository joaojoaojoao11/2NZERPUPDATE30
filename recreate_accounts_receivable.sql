-- Drop existing table and dependencies
DROP TABLE IF EXISTS accounts_receivable CASCADE;

-- Create new table with exact requested schema
CREATE TABLE accounts_receivable (
    "ID" TEXT PRIMARY KEY,
    "IDCliente" TEXT, -- Added missing column
    "Data Emissão" DATE,
    "Data Vencimento" DATE,
    "Data Liquidação" DATE,
    "Valor documento" NUMERIC(15,2),
    "Saldo" NUMERIC(15,2),
    "Situação" TEXT,
    "Número documento" TEXT,
    "Número no banco" TEXT,
    "Categoria" TEXT,
    "Histórico" TEXT,
    "Forma de recebimento" TEXT,
    "Meio de recebimento" TEXT,
    "Taxas" NUMERIC(15,2),
    "Competência" TEXT,
    "Recebimento" DATE,
    "Recebido" NUMERIC(15,2),
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;

-- Create policy for full access (Public + Authenticated)
CREATE POLICY "Enable all for all users" ON accounts_receivable
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- Create index for performance
CREATE INDEX idx_ar_vencimento ON accounts_receivable("Data Vencimento");
CREATE INDEX idx_ar_situacao ON accounts_receivable("Situação");
