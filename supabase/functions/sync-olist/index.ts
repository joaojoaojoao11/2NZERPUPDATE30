import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare global {
  const Deno: {
    env: {
      get(key: string): string | undefined;
    };
  };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OLIST_API_ENDPOINT = 'https://api.olist.com/v1/orders';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Configuração e Chaves
    const OLIST_API_KEY = Deno.env.get('OLIST_API_KEY');
    if (!OLIST_API_KEY) throw new Error('Chave OLIST_API_KEY ausente.');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    // CORREÇÃO CRÍTICA: Usando o nome correto do segredo sem o prefixo proibido
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY'); 

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Configuração Supabase incompleta (SERVICE_ROLE_KEY).');
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 2. Buscar na Olist
    console.log("Iniciando busca na Olist...");
    const response = await fetch(OLIST_API_ENDPOINT, {
      headers: { 'Authorization': `Bearer ${OLIST_API_KEY}` },
    });

    if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Erro API Olist (${response.status}): ${txt}`);
    }
    
    const olistData = await response.json();
    const orders = olistData.data || [];
    const orders_read = orders.length;

    // 3. Processar e Salvar
    const itemsToUpsert = orders.flatMap((order: any) =>
      (order.items || []).map((item: any) => ({
        external_id: `${order.id}-${item.sku}`,
        order_number: order.id,
        sale_date: order.created_at,
        status: order.status?.name || 'DESCONHECIDO',
        contact_name: order.customer?.name,
        cpf_cnpj: order.customer?.document,
        email: order.customer?.email,
        phone: order.customer?.phone,
        sku: item.sku,
        description: item.name,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.price || 0),
        total_amount: Number((item.price || 0) * (item.quantity || 0)),
        sales_rep: order.seller?.name || 'Olist Store',
        tracking_code: order.shipping?.tracking_code,
        recipient_name: order.shipping?.receiver_name,
        recipient_address: `${order.shipping?.street || ''}, ${order.shipping?.number || ''}`,
        recipient_city: order.shipping?.city,
        recipient_state: order.shipping?.state,
        imported_at: new Date().toISOString()
      }))
    );
    
    let upserted_count = 0;
    if (itemsToUpsert.length > 0) {
        const { count, error } = await supabaseAdmin
          .from('sales_history')
          .upsert(itemsToUpsert, { onConflict: 'external_id', count: 'exact' });
        
        if (error) throw error;
        upserted_count = count || 0;
    }

    return new Response(
      JSON.stringify({ message: 'Sincronização concluída!', upserted_count, orders_read }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error("Erro Function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
