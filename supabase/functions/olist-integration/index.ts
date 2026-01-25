import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // 1. Resposta Rápida (CORS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Agora o OLIST_API_KEY vai guardar o Token do Tiny
    const TOKEN_TINY = Deno.env.get('OLIST_API_KEY') || ""; 
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');

    if (!TOKEN_TINY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Configuração incompleta: Verifique Secrets.');
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 2. Limpeza do Token (Para garantir que pegamos só o código 54ba...)
    let token = TOKEN_TINY;
    // Se estiver no formato "email=..., api_key=...", tentamos extrair.
    // Se não, assumimos que o usuário colou só o token do Tiny.
    const keyMatch = TOKEN_TINY.match(/api_key=([^,\s]+)/);
    if (keyMatch) {
        token = keyMatch[1];
    } else if (TOKEN_TINY.includes("=")) {
        token = TOKEN_TINY.split('=').pop()?.trim() || token;
    }
    token = token.trim();

    console.log(`1. Conectando ao Tiny ERP...`);

    // 3. Busca Pedidos no Tiny
    // Endpoint oficial do Tiny para buscar pedidos
    const url = new URL('https://api.tiny.com.br/api2/pedidos.pesquisa.php');
    url.searchParams.set('token', token);
    url.searchParams.set('formato', 'json');
    url.searchParams.set('situacao', 'aprovado'); // Busca pedidos aprovados (pode mudar para 'faturado' ou tirar para trazer tudo)
    
    // Opcional: Buscar pedidos dos últimos 30 dias para não sobrecarregar
    // const dataRecente = new Date();
    // dataRecente.setDate(dataRecente.getDate() - 30);
    // url.searchParams.set('dataInicial', dataRecente.toLocaleDateString('pt-BR'));

    const tinyRes = await fetch(url.toString(), { method: 'GET' });

    if (!tinyRes.ok) {
      throw new Error(`Tiny API Falhou (${tinyRes.status})`);
    }

    const json = await tinyRes.json();
    
    // O Tiny retorna { retorno: { status: 'Erro', codigo_erro: ... } } se falhar a lógica
    if (json.retorno.status === 'Erro') {
        const erroMsg = json.retorno.erros ? json.retorno.erros[0].erro : 'Erro desconhecido do Tiny';
        // Se o erro for "Não foram encontrados registros", não é erro, é só vazio.
        if (erroMsg.includes('o foram encontrados')) {
             return new Response(
                JSON.stringify({ message: 'Conexão OK! Nenhum pedido novo no Tiny.', upserted_count: 0 }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }
        throw new Error(`Tiny Recusou: ${erroMsg}`);
    }

    const pedidos = json.retorno.pedidos || [];
    console.log(`2. Pedidos encontrados no Tiny: ${pedidos.length}`);

    if (pedidos.length === 0) {
      return new Response(
        JSON.stringify({ message: 'Conexão OK! Nenhum pedido novo.', upserted_count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Mapeamento (Tiny -> Supabase)
    // O Tiny retorna o pedido dentro de um objeto wrapper: [ { pedido: { ... } }, { pedido: { ... } } ]
    const rows = pedidos.map((p: any) => {
        const order = p.pedido;
        return {
            external_id: `TINY-${order.id}`, // Usamos o ID do Tiny para unicidade
            order_number: String(order.numero || order.id),
            sale_date: order.data_pedido ? new Date(order.data_pedido.split('/').reverse().join('-')).toISOString() : new Date().toISOString(),
            status: order.situacao || 'DESCONHECIDO',
            contact_name: order.cliente?.nome || 'Cliente',
            // O Tiny não manda itens na lista simples, teria que consultar um por um. 
            // Para simplificar, vamos salvar o valor total como um item genérico ou usar dados disponíveis.
            description: `Pedido Tiny #${order.numero}`, 
            total_amount: Number(order.valor_total || 0),
            sales_rep: order.ecommerce || 'Tiny ERP', // Mostra de onde veio (Olist, Shopee, etc)
            imported_at: new Date().toISOString()
        };
    });

    console.log(`3. Salvando ${rows.length} pedidos...`);
    
    const { error, count } = await supabase
        .from('sales_history')
        .upsert(rows, { onConflict: 'external_id', count: 'exact' });
    
    if (error) throw error;

    return new Response(
      JSON.stringify({ message: 'Sincronização com Tiny concluída!', upserted_count: count }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error("ERRO FATAL:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
