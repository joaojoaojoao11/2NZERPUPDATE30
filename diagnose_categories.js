
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
    console.log("--- DIAGNÓSTICO DE CATEGORIAS ---");

    // 1. Receitas (Contas a Receber)
    const { data: arData, error: arError } = await supabase
        .from('accounts_receivable')
        .select('Categoria, "Forma de recebimento"');

    if (arError) {
        console.error("Erro CR:", arError);
    } else {
        const categories = [...new Set(arData?.map(r => r.Categoria).filter(Boolean))];
        const forms = [...new Set(arData?.map(r => r["Forma de recebimento"]).filter(Boolean))];

        console.log("\n[CONTAS A RECEBER] Categorias Únicas Encontradas:");
        categories.sort().forEach(c => console.log(` - ${c}`));
    }

    // 2. Despesas (Contas a Pagar)
    const { data: apData, error: apError } = await supabase
        .from('accounts_payable')
        .select('categoria');

    if (apError) {
        console.error("Erro CP:", apError);
    } else {
        // Normalizar para maiúsculo para evitar duplicatas visuais
        const categories = [...new Set(apData?.map(r => (r.categoria || '').toUpperCase()).filter(Boolean))];
        console.log("\n[CONTAS A PAGAR] Categorias Únicas Encontradas:");
        categories.sort().forEach(c => console.log(` - ${c}`));
    }
}

diagnose();
