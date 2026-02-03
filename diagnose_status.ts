
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing environment variables!");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function diagnose() {
    console.log("--- DIAGNÓSTICO DE SITUAÇÕES ---");

    // 1. Receitas
    const { data: arData, error: arError } = await supabase
        .from('accounts_receivable')
        .select('Situação');

    if (arError) {
        console.error("Erro CR:", arError);
    } else {
        const statuses = [...new Set(arData?.map((r: any) => r['Situação']).filter(Boolean))];
        console.log("\n[CONTAS A RECEBER] Situações:");
        statuses.sort().forEach(s => console.log(` - ${s}`));
    }

    // 2. Despesas
    const { data: apData, error: apError } = await supabase
        .from('accounts_payable')
        .select('situacao');

    if (apError) {
        console.error("Erro CP:", apError);
    } else {
        const statuses = [...new Set(apData?.map((r: any) => r.situacao).filter(Boolean))];
        console.log("\n[CONTAS A PAGAR] Situações:");
        statuses.sort().forEach(s => console.log(` - ${s}`));
    }
}

diagnose();
