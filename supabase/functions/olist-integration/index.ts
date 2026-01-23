// Usando a versão 0.168.0 que é a mais estável para o Supabase
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Cabeçalhos universais para evitar erro de CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // 1. A PRIMEIRA coisa que o código faz é responder ao browser se ele perguntar "posso conectar?"
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Leitura de Variáveis com tratamento de erro
    // Não usamos tipagem complexa aqui para evitar travar o Deno
    const OLIST_API_KEY = Deno.env.get('OLIST_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');

    // Validação explícita para retornar erro legível (400) e não erro fatal (500)
    if (!OLIST_API_KEY) throw new Error('Falta a chave: OLIST_API_KEY');
    if (!SUPABASE_URL) throw new Error('Falta a chave: SUPABASE_URL');
    if (!SERVICE_ROLE_KEY) throw new Error('Falta a chave: SERVICE_ROLE_KEY');

    // 3. Conexão com o Banco
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 4. Conexão com a Olist
    const response = await fetch('https://api.olist.com/v1/orders', {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${OLIST_API_KEY}`,
        'Accept': 'application/json'
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Olist respondeu com erro ${response.status}: ${text}`);
    }

    const json = await response.json();
    const orders = json.data || [];

    // 5. Se não houver pedidos, retorna sucesso vazio
    if (!Array.isArray(orders) || orders.length === 0) {
      return new Response(
        JSON.stringify({ message: 'Nenhum pedido encontrado', upserted_count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 6. Processamento dos dados (Mapeamento Simples)
    const itemsToUpsert = [];
    
    for (const order of orders) {
      const items = order.items || [];
      for (const item of items) {
        itemsToUpsert.push({
            external_id: `${order.id}-${item.sku}`,
            order_number: String(order.id),
            sale_date: order.created_at,
            status: typeof order.status === 'string' ? order.status : (order.status?.name || 'N/A'),
            contact_name: order.customer?.name || 'Cliente',
            sku: item.sku,
            description: item.name,
            quantity: Number(item.quantity || 1),
            unit_price: Number(item.price || 0),
            total_amount: Number(item.price || 0) * Number(item.quantity || 1),
            sales_rep: 'OLIST',
            imported_at: new Date().toISOString()
        });
      }
    }

    // 7. Salvar no Banco
    let count = 0;
    if (itemsToUpsert.length > 0) {
      const { count: upsertCount, error } = await supabaseAdmin
        .from('sales_history')
        .upsert(itemsToUpsert, { onConflict: 'external_id', count: 'exact' });
      
      if (error) throw new Error(`Erro ao salvar no Supabase: ${error.message}`);
      count = upsertCount || 0;
    }

    // 8. Sucesso!
    return new Response(
      JSON.stringify({ message: 'Sincronização OK', upserted_count: count, orders_read: orders.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (err: any) {
    // Captura qualquer erro e retorna como JSON (evita o erro 500 fatal)
    return new Response(
      JSON.stringify({ error: err.message || 'Erro desconhecido' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
