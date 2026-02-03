
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
        .select('Categoria, "Forma de recebimento"'); // Use quotes for columns with spaces

    if (arError) {
        console.error("Erro CR:", arError);
    } else {
        const categories = [...new Set(arData?.map((r: any) => r.Categoria).filter(Boolean))];
        const forms = [...new Set(arData?.map((r: any) => r["Forma de recebimento"]).filter(Boolean))];

        console.log("\n[CONTAS A RECEBER] Categorias Únicas Encontradas:");
        categories.sort().forEach(c => console.log(` - ${c}`));

        console.log("\n[CONTAS A RECEBER] Formas de Recebimento:");
        forms.sort().forEach(f => console.log(` - ${f}`));
    }

    // 2. Despesas (Contas a Pagar)
    const { data: apData, error: apError } = await supabase
        .from('accounts_payable')
        .select('categoria, fornecedor');

    if (apError) {
        console.error("Erro CP:", apError);
    } else {
        const categories = [...new Set(apData?.map((r: any) => r.categoria).filter(Boolean))];
        console.log("\n[CONTAS A PAGAR] Categorias Únicas Encontradas:");
        categories.sort().forEach(c => console.log(` - ${c}`));
    }
}

diagnose();
