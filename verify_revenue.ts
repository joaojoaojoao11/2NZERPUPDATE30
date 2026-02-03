
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkRevenue() {
    console.log("--- CHECAGEM DE RECEITA ---");

    const { data: arData, error } = await supabase
        .from('accounts_receivable')
        .select('*')
        .neq('Situação', 'Cancelada');

    if (error) {
        console.error(error);
        return;
    }

    const byMonth: Record<string, number> = {};

    arData.forEach((row: any) => {
        const comp = row['Competência'];
        if (!comp) return;

        const val = Number(row['Valor documento'] || 0);

        if (!byMonth[comp]) byMonth[comp] = 0;
        byMonth[comp] += val;
    });

    console.log("Receita por Competência (Excluindo Canceladas):");
    Object.keys(byMonth).sort().forEach(m => {
        console.log(`${m}: ${byMonth[m].toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
    });
}

checkRevenue();
