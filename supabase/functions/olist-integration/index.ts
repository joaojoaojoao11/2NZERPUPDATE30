// Importando de versões estáveis e compatíveis com Supabase
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Cabeçalhos para permitir que seu site converse com o robô (CORS)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OLIST_API_ENDPOINT = 'https://api.olist.com/v1/orders';

serve(async (req) => {
  // 1. Tratamento imediato do Preflight (OPTIONS)
  // Se isso falhar, é erro de sintaxe no arquivo.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Validação de Chaves (Secrets)
    // O Deno.env.get funciona nativamente no Supabase, não precisa declarar tipos.
    const OLIST_API_KEY = Deno.env.get('OLIST_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');

    if (!OLIST_API_KEY) {
      throw new Error('CONFIG_ERROR: OLIST_API_KEY não encontrada nos Segredos.');
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('CONFIG_ERROR: Credenciais do Supabase ausentes (Verifique SERVICE_ROLE_KEY).');
    }

    // 3. Inicializa o cliente do Banco
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 4. Busca dados na Olist
    console.log("Iniciando busca na Olist...");
    const olistResponse = await fetch(OLIST_API_ENDPOINT, {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${OLIST_API_KEY}`,
        'Accept': 'application/json'
      },
    });

    if (!olistResponse.ok) {
      const errorText = await olistResponse.text();
      console.error(`Erro Olist: ${olistResponse.status}`, errorText);
      throw new Error(`Falha na API Olist (${olistResponse.status}): ${errorText}`);
    }

    const olistJson = await olistResponse.json();
    // A API da Olist retorna { data: [...] } ou { orders: [...] } dependendo da versão/endpoint. 
    // Vamos garantir que pegamos um array.
    const orders = Array.isArray(olistJson.data) ? olistJson.data : [];
    
    console.log(`Pedidos encontrados: ${orders.length}`);

    // 5. Se não tiver pedidos, encerra cedo para economizar recursos
    if (orders.length === 0) {
      return new Response(
        JSON.stringify({ message: 'Nenhum pedido novo.', upserted_count: 0, orders_read: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 6. Mapeamento de Dados (De/Para)
    const itemsToUpsert = orders.flatMap((order: any) => {
        // Proteção contra itens nulos
        const items = Array.isArray(order.items) ? order.items : [];
        
        return items.map((item: any) => ({
            external_id: `${order.id}-${item.sku}`,
            order_number: String(order.id), // Garante que seja string
            sale_date: order.created_at,
            status: order.status?.name || order.status || 'DESCONHECIDO',
            contact_name: order.customer?.name || 'Consumidor',
            cpf_cnpj: order.customer?.document,
            email: order.customer?.email,
            phone: order.customer?.phone,
            sku: item.sku,
            description: item.name,
            quantity: Number(item.quantity || 1),
            unit_price: Number(item.price || 0),
            total_amount: Number((item.price || 0) * (item.quantity || 1)),
            sales_rep: 'OLIST',
            tracking_code: order.shipping?.tracking_code,
            recipient_name: order.shipping?.receiver_name,
            recipient_address: `${order.shipping?.street || ''}, ${order.shipping?.number || ''}`,
            recipient_city: order.shipping?.city,
            recipient_state: order.shipping?.state,
            imported_at: new Date().toISOString()
        }));
    });

    // 7. Gravação no Banco (Upsert)
    let upserted_count = 0;
    if (itemsToUpsert.length > 0) {
        const { count, error } = await supabaseAdmin
            .from('sales_history')
            .upsert(itemsToUpsert, { onConflict: 'external_id', count: 'exact' });

        if (error) {
            console.error("Erro Supabase:", error);
            throw new Error(`Erro ao salvar no banco: ${error.message}`);
        }
        upserted_count = count || 0;
    }

    // 8. Resposta Final de Sucesso
    return new Response(
      JSON.stringify({ 
        message: 'Sincronização concluída!', 
        upserted_count: upserted_count, 
        orders_read: orders.length 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (err: any) {
    // Tratamento de Erro Seguro (retorna JSON, não 500 puro)
    console.error("Erro Crítico na Function:", err);
    return new Response(
      JSON.stringify({ error: err.message || 'Erro desconhecido' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
