
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing env vars');
    Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const sql = `
DROP TABLE IF EXISTS accounts_receivable CASCADE;

CREATE TABLE accounts_receivable (
    "ID" TEXT PRIMARY KEY,
    "IDCliente" TEXT, -- Alias for ID if needed, but ID is usually the PK
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

ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for authenticated" ON accounts_receivable
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE INDEX idx_ar_vencimento ON accounts_receivable("Data Vencimento");
`;

// Supabase JS client doesn't support direct raw SQL execution on the public interface easily 
// unless we use rpc or have a specific function.
// HOWEVER, since we are in a rush and CLI failed, I will use the 'postgres' library directly if possible
// OR I will ask the user to run it in the SQL Editor. 
// BUT, wait, I can try to use the `pg` driver in Deno.

console.log("Please run the SQL in 'recreate_accounts_receivable.sql' in your Supabase SQL Editor manually.");
console.log("The CLI failed to link. I cannot execute DDL commands via the JS Client directly without a helper function.");
