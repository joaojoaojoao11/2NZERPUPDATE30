import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Função Auxiliar para tratamento de moedas
const parseCurrency = (val: string | number) => {
    if (typeof val === 'number') return val;
    return parseFloat(val.replace('.', '').replace(',', '.'));
}

Deno.serve(async (req) => {
    // CORS
    const requestOrigin = req.headers.get('Origin') || '*';
    const corsHeaders = {
        'Access-Control-Allow-Origin': requestOrigin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    };

    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const TOKEN_TINY = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY') || "";
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!TOKEN_TINY || !SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Configuração incompleta.');

        let token = TOKEN_TINY;
        if (token.includes("=")) token = token.split('=').pop()?.trim() || token;
        token = token.trim();

        const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        console.log(`[OrdersSync] Buscando pedidos para enriquecer CRM...`);

        // 1. Buscar Pedidos recentes no Tiny (Últimos 90 dias, por exemplo, ou paginação total)
        // Para simplificar e não estourar tempo, vamos pegar pedidos com status 'faturado' ou 'aprovado'

        let pagina = 1;
        let stop = false;
        const processedClients = new Map<string, { total: number, lastDate: string, products: any[] }>();

        while (!stop && pagina <= 5) { // Limite de segurança de 5 pág por execução por enquanto
            await sleep(1500);

            const url = new URL('https://api.tiny.com.br/api2/pedidos.pesquisa.php');
            url.searchParams.set('token', token);
            url.searchParams.set('formato', 'json');
            url.searchParams.set('pagina', String(pagina));
            // Ordenar se possível, ou filtrar por data (Tiny API é chata com filtros)

            const res = await fetch(url.toString());
            const json = await res.json();

            if (json.retorno.status === 'Erro') {
                console.warn(`[OrdersSync] Fim/Erro Pág ${pagina}: ${json.retorno.erros[0].erro}`);
                stop = true;
                break;
            }

            const pedidos = json.retorno.pedidos || [];
            if (pedidos.length === 0) { stop = true; break; }

            console.log(`[OrdersSync] Processando ${pedidos.length} pedidos da pág ${pagina}...`);

            // Agregação em Memória
            for (const p of pedidos) {
                const pedido = p.pedido;
                const clienteNome = pedido.cliente.nome; // Chave de ligação (Infelizmente Tiny não garante ID consistente em todos endpoints)

                if (!processedClients.has(clienteNome)) {
                    processedClients.set(clienteNome, { total: 0, lastDate: '', products: [] });
                }

                const clientData = processedClients.get(clienteNome)!;

                // Soma Valor
                clientData.total += parseFloat(pedido.valor_nota || 0);

                // Check Data Recente
                const dataPedido = pedido.data_pedido; // d/m/Y
                const [d, m, y] = dataPedido.split('/');
                const isoDate = `${y}-${m}-${d}`;
                if (!clientData.lastDate || isoDate > clientData.lastDate) {
                    clientData.lastDate = isoDate;
                }
            }
            pagina++;
        }

        // 2. Atualizar CRM com dados enriquecidos
        console.log(`[OrdersSync] Atualizando ${processedClients.size} clientes no banco...`);
        let updates = 0;

        for (const [nome, dados] of processedClients.entries()) {
            // Update na tabela de oportunidades usando o nome
            const { error } = await supabase
                .from('crm_opportunities')
                .update({
                    ltv: dados.total,
                    last_purchase_date: dados.lastDate,
                    // Poderíamos atualizar 'tags' com 'VIP' se total > 5000
                    tags: dados.total > 5000 ? ['VIP', 'TINY'] : ['TINY']
                })
                .eq('client_name', nome); // Matching por nome é arriscado mas é o que temos do Tiny simples

            if (!error) updates++;
        }

        return new Response(
            JSON.stringify({ message: 'Enriquecimento Concluído', clients_updated: updates }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );

    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
        });
    }
});
