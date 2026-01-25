import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SECRET_STRING = Deno.env.get('OLIST_API_KEY') || ""; 
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');

    if (!SECRET_STRING || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Configuração incompleta: Verifique Secrets.');
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Extração Inteligente da Chave (Pega só a api_key, ignorando o email se houver)
    let apiKey = SECRET_STRING;
    // Se o usuário salvou como "email=..., api_key=...", pegamos só a parte da chave
    const keyMatch = SECRET_STRING.match(/api_key=([^,\s]+)/);
    if (keyMatch) {
        apiKey = keyMatch[1];
    } else if (SECRET_STRING.includes("=")) {
        // Fallback: se tem igual mas não casou o regex, tenta limpar
        apiKey = SECRET_STRING.split('=').pop()?.trim() || SECRET_STRING;
    }
    apiKey = apiKey.trim();

    // 2. URL CORRETA (Partners API)
    // api.olist.com é interna/AWS. partners-api.olist.com é a pública para Sellers.
    const endpoint = 'https://partners-api.olist.com/v1/seller-orders';

    console.log(`1. Buscando pedidos em: ${endpoint}`);
    
    const olistRes = await fetch(endpoint, {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${apiKey}`, // Agora deve funcionar com Bearer
        'Accept': 'application/json'
      }
    });

    if (!olistRes.ok) {
      const txt = await olistRes.text();
      console.error("ERRO OLIST:", txt);
      
      // Se der 401, a chave pode estar errada ou expirada
      if (olistRes.status === 401) {
         throw new Error(`Acesso Negado (401). Verifique se sua chave de API está correta.`);
      }
      throw new Error(`Erro API Olist (${olistRes.status}): ${txt}`);
    }

    const data = await olistRes.json();
    // A API de Partners retorna listas paginadas, geralmente em 'results' ou 'data'
    const orders = data.results || data.data || data.orders || []; 
    
    console.log(`2. Pedidos encontrados: ${orders.length}`);

    if (orders.length === 0) {
      return new Response(
        JSON.stringify({ message: 'Conexão OK! Nenhum pedido novo.', upserted_count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Processamento
    const rows = orders.flatMap((order: any) => {
        const items = order.items || [];
        return items.map((item: any) => ({
            external_id: `${order.code || order.id}-${item.sku || 'N/A'}`,
            order_number: String(order.code || order.id),
            sale_date: order.created_at || new Date().toISOString(),
            status: order.status || 'DESCONHECIDO',
            contact_name: order.customer?.name || 'Cliente Olist',
            sku: item.sku,
            description: item.name || 'Produto Olist',
            quantity: Number(item.quantity || 1),
            unit_price: Number(item.price || 0),
            total_amount: Number(item.price || 0) * Number(item.quantity || 1),
            sales_rep: 'OLIST',
            imported_at: new Date().toISOString()
        }));
    });

    console.log(`3. Salvando ${rows.length} itens...`);
    
    const { error, count } = await supabase
        .from('sales_history')
        .upsert(rows, { onConflict: 'external_id', count: 'exact' });
    
    if (error) throw error;

    return new Response(
      JSON.stringify({ message: 'Sucesso!', upserted_count: count }),
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
