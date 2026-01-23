
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// O 'declare global' é necessário para o TypeScript entender o 'Deno' no ambiente do Supabase
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
    const OLIST_API_KEY = Deno.env.get('OLIST_API_KEY');
    if (!OLIST_API_KEY) throw new Error('Chave de API da Olist não configurada.');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Variáveis do Supabase não configuradas.');

    // Cria um cliente Supabase com permissões de administrador para poder escrever no DB
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Busca dados da Olist
    const response = await fetch(OLIST_API_ENDPOINT, {
      headers: { 'Authorization': `Bearer ${OLIST_API_KEY}` },
    });
    if (!response.ok) throw new Error(`Erro na API Olist: ${response.statusText}`);
    const olistData = await response.json();
    if (!olistData || !olistData.data) throw new Error("Resposta da Olist inválida.");

    const orders_read = olistData.data.length;

    // 2. Transforma dados para o formato do nosso banco
    const itemsToUpsert = olistData.data.flatMap((order: any) =>
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
        quantity: item.quantity,
        unit_price: item.price,
        total_amount: (item.price || 0) * (item.quantity || 0),
        sales_rep: order.seller?.name || 'Olist Store',
        tracking_code: order.shipping?.tracking_code,
        recipient_name: order.shipping?.receiver_name,
        recipient_address: `${order.shipping?.street || ''}, ${order.shipping?.number || ''}`,
        recipient_city: order.shipping?.city,
        recipient_state: order.shipping?.state
      }))
    );
    
    if (itemsToUpsert.length === 0) {
      return new Response(
        JSON.stringify({ message: 'Nenhum item novo para importar.', upserted_count: 0, orders_read }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 3. Salva os dados diretamente no Supabase (Upsert)
    const { count, error: upsertError } = await supabaseAdmin
      .from('sales_history')
      .upsert(itemsToUpsert, { onConflict: 'external_id', count: 'exact' });

    if (upsertError) throw upsertError;
    
    const upserted_count = count || 0;

    return new Response(
      JSON.stringify({ message: 'Sincronização concluída!', upserted_count, orders_read }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error("Erro na Edge Function sync-olist:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
