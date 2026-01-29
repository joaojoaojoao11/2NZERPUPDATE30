
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Função simples para ler env (já que não temos dotenv instalado nas deps de dev, mas temos no projeto)
function getEnvValue(key) {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(new RegExp(`${key}=(.*)`));
        return match ? match[1].trim() : null;
    } catch (e) {
        return null;
    }
}

const supabaseUrl = getEnvValue('VITE_SUPABASE_URL');
const supabaseKey = getEnvValue('VITE_SUPABASE_ANON_KEY');

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkClient() {
    console.log("🔍 Inspecionando tabela 'clients'...");

    // 1. Ver estrutura
    const { data: sample, error: sampleError } = await supabase.from('clients').select('*').limit(1);
    if (sample && sample.length > 0) {
        console.log("Colunas encontradas:", Object.keys(sample[0]));
    } else if (sampleError) {
        console.error("Erro ao ler clients:", sampleError);
    }

    // 2. Busca correta (tentando 'nome' que o service usa)
    console.log("🔍 Buscando HIRAYAMA no Supabase...");
    const { data: clients, error } = await supabase
        .from('clients')
        .select('*')
        .or('nome.ilike.%HIRAYAMA%,fantasia.ilike.%HIRAYAMA%'); // Tenta nome ou fantasia se existirem

    if (error) {
        console.error("Erro ao buscar clients:", error);
    } else {
        console.log(`\n📋 Tabela 'clients': ${clients.length} encontrados.`);
        clients.forEach(c => console.log(`   - [${c.id}] ${c.nome || c.fantasia} (TinyID: ${c.id_tiny})`));
    }

    // Busca em CRM Opportunities
    const { data: opps, error: oppError } = await supabase
        .from('crm_opportunities')
        .select('*')
        .ilike('client_name', '%HIRAYAMA%');

    if (oppError) {
        console.error("Erro ao buscar opps:", oppError);
    } else {
        console.log(`\n💼 Tabela 'crm_opportunities': ${opps.length} encontrados.`);
        opps.forEach(o => console.log(`   - [${o.id}] ${o.client_name} (Status: ${o.status})`));
    }
}

checkClient();
