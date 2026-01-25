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
    const OLIST_API_KEY = Deno.env.get('OLIST_API_KEY'); // Aqui dentro tem "email=..., api_key=..."
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');

    if (!OLIST_API_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Configuração incompleta: Verifique Secrets.');
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    console.log("1. Buscando dados na Olist...");
    
    // CORREÇÃO FINAL: Colocamos o Bearer de volta, somado ao conteúdo do seu segredo
    const olistRes = await fetch('https://api.olist.com/v1/orders', {
      headers: { 
        'Authorization': `Bearer ${OLIST_API_KEY}`, 
        'Accept': 'application/json'
      }
    });

    if (!olistRes.ok) {
      const txt = await olistRes.text();
      console.error("ERRO OLIST:", txt); 
      throw new Error(`Erro na API Olist (${olistRes.status}): ${txt}`);
    }

    const data = await olistRes.json();
    const orders = data.data || []; 
    console.log(`2. Pedidos encontrados: ${orders.length}`);

    if (orders.length === 0) {
      return new Response(
        JSON.stringify({ message: 'Nenhum pedido novo', upserted_count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rows = orders.flatMap((order: any) => {
        const items = order.items || [];
        return items.map((item: any) => ({
            external_id: `${order.id}-${item.sku}`,
            order_number: String(order.id),
            sale_date: order.created_at,
            status: order.status?.name || 'DESCONHECIDO',
            contact_name: order.customer?.name || 'Cliente',
            sku: item.sku,
            description: item.name,
            quantity: Number(item.quantity || 1),
            unit_price: Number(item.price || 0),
            total_amount: Number(item.price || 0) * Number(item.quantity || 1),
            sales_rep: 'OLIST',
            imported_at: new Date().toISOString()
        }));
    });

    console.log(`3. Tentando salvar ${rows.length} itens no banco...`);
    
    const { error, count } = await supabase
        .from('sales_history')
        .upsert(rows, { onConflict: 'external_id', count: 'exact' });
    
    if (error) {
        console.error("ERRO BANCO DE DADOS:", JSON.stringify(error));
        throw error;
    }

    return new Response(
      JSON.stringify({ message: 'Sucesso', upserted_count: count }),
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
