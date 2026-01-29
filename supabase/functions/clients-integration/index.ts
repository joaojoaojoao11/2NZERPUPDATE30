import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
    // 1. CORS
    const requestOrigin = req.headers.get('Origin') || '*';
    const corsHeaders = {
        'Access-Control-Allow-Origin': requestOrigin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
    };

    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        // 2. CONFIG
        const TOKEN_TINY = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY') || "";
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!TOKEN_TINY || !SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Configuração incompleta.');

        let token = TOKEN_TINY;
        if (token.includes("=")) token = token.split('=').pop()?.trim() || token;
        token = token.trim();

        const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        console.log(`[ClientsSync] Iniciando Sincronização de Clientes...`);

        let totalSalvo = 0;
        const startTime = performance.now();
        const itemsPorPagina = 100; // API Tiny limite padrão é menor, mas contatos aceita paginação.
        let pagina = 1;
        let stop = false;

        // Loop de Paginação
        while (!stop) {
            // Timeout Safety (55s)
            if ((performance.now() - startTime) > 55000) {
                console.log("[ClientsSync] Tempo limite global atingido.");
                break;
            }

            await sleep(2000); // 2s entre requests (Aumentado para evitar Bloqueio 429)

            const url = new URL('https://api.tiny.com.br/api2/contatos.pesquisa.php');
            url.searchParams.set('token', token);
            url.searchParams.set('formato', 'json');
            // A API de contatos pode não aceitar 'limit', mas vamos tentar. 
            // Se ela não aceitar, ela retorna padrão (geralmente 20 ou 50).
            // Vamos iterar até não vir mais nada.
            url.searchParams.set('paginacao', String(pagina));

            const res = await fetch(url.toString());
            const json = await res.json();

            // Tratamento de Erro / Fim
            if (json.retorno.status === 'Erro') {
                const msg = json.retorno.erros[0].erro;
                console.warn(`[ClientsSync] Fim ou Erro na pág ${pagina}: ${msg}`);
                stop = true;
                break;
            }

            const contatos = json.retorno.contatos || [];
            if (contatos.length === 0) {
                stop = true;
                break;
            }

            console.log(`[ClientsSync] Pág ${pagina}: ${contatos.length} contatos encontrados.`);

            const rows = contatos.map((c: any) => {
                const contato = c.contato;
                return {
                    id_tiny: String(contato.id),
                    nome: contato.nome,
                    fantasia: contato.fantasia,
                    cpf_cnpj: contato.cpf_cnpj,
                    tipo_pessoa: contato.tipo_pessoa,
                    email: contato.email,
                    telefone: contato.telefone || contato.celular,
                    endereco: contato.endereco,
                    bairro: contato.bairro,
                    cidade: contato.cidade,
                    estado: contato.uf,
                    cep: contato.cep,
                    situacao: contato.situacao,
                    last_sync: new Date().toISOString()
                };
            });

            // Upsert
            const { error } = await supabase.from('clients').upsert(rows, {
                onConflict: 'id_tiny' // Importante: usar o ID do Tiny como chave única
            });

            if (error) {
                console.error(`[ClientsSync] Erro no DB: ${error.message}`);
            } else {
                totalSalvo += rows.length;
            }

            pagina++;
        }

        return new Response(
            JSON.stringify({ message: 'Sincronização de Clientes Concluída', upserted_count: totalSalvo }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );

    } catch (err: any) {
        console.error(`[ClientsSync] ERRO FATAL: ${err.message}`);
        return new Response(
            JSON.stringify({ error: err.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
    }
});
