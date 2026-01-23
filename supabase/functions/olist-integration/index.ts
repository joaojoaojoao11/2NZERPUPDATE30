
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
  // Configuração de CORS para aceitar requisições do seu Frontend
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Pega as chaves de API de forma segura
    const OLIST_API_KEY = Deno.env.get('OLIST_API_KEY');
    if (!OLIST_API_KEY) throw new Error('Chave de API da Olist não configurada.');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    
    // --- CORREÇÃO APLICADA AQUI ---
    // O nome correto da variável de ambiente no Supabase para a chave de serviço é 'SERVICE_ROLE_KEY'.
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Variáveis de ambiente do Supabase (URL ou SERVICE_ROLE_KEY) não configuradas.');

    // 2. Cria um cliente Supabase com permissões de administrador (Service Role)
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 3. Busca dados da Olist
    console.log("Buscando pedidos na Olist...");
    const response = await fetch(OLIST_API_ENDPOINT, {
      headers: { 'Authorization': `Bearer ${OLIST_API_KEY}` },
    });

    if (!response.ok) throw new Error(`Erro na API Olist: ${response.status} - ${response.statusText}`);
    
    const olistData = await response.json();
    if (!olistData || !olistData.data) throw new Error("Resposta da Olist inválida ou vazia.");

    const orders_read = olistData.data.length;
    console.log(`${orders_read} pedidos encontrados na Olist.`);

    // 4. Transforma os dados para o formato da tabela 'sales_history'
    const itemsToUpsert = olistData.data.flatMap((order: any) =>
      (order.items || []).map((item: any) => ({
        external_id: `${order.id}-${item.sku}`, // ID único composto
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
        recipient_state: order.shipping?.state,
        imported_at: new Date().toISOString()
      }))
    );
    
    if (itemsToUpsert.length === 0) {
      return new Response(
        JSON.stringify({ message: 'Nenhum item novo para importar.', upserted_count: 0, orders_read }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 5. Salva os dados diretamente no Supabase usando UPSERT
    const { count, error: upsertError } = await supabaseAdmin
      .from('sales_history')
      .upsert(itemsToUpsert, { onConflict: 'external_id', count: 'exact' });

    if (upsertError) {
        console.error("Erro no Upsert Supabase:", upsertError);
        throw upsertError;
    }
    
    const upserted_count = count || 0;

    // 6. Retorna o resumo para o frontend
    return new Response(
      JSON.stringify({ message: 'Sincronização concluída!', upserted_count, orders_read }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error("Erro Crítico na Edge Function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
