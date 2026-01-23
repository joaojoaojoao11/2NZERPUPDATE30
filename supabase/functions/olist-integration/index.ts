// 1. Importação APENAS do cliente Supabase (usando esm.sh para compatibilidade máxima)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// 2. Configuração de CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 3. Usando Deno.serve (Nativo e Moderno - Sem importação externa de servidor)
Deno.serve(async (req) => {
  // Tratamento de Preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Validação de Chaves
    const OLIST_API_KEY = Deno.env.get('OLIST_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');

    if (!OLIST_API_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Configuração incompleta (Verifique os Secrets no Painel).');
    }

    // Inicializa Supabase
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Busca na Olist
    console.log("Buscando Olist...");
    const olistRes = await fetch('https://api.olist.com/v1/orders', {
      headers: { 
        'Authorization': `Bearer ${OLIST_API_KEY}`,
        'Accept': 'application/json'
      }
    });

    if (!olistRes.ok) {
      const txt = await olistRes.text();
      throw new Error(`Erro API Olist (${olistRes.status}): ${txt}`);
    }

    const data = await olistRes.json();
    const orders = data.data || []; // Ajuste conforme resposta real da Olist

    // Se não tiver pedidos
    if (orders.length === 0) {
      return new Response(
        JSON.stringify({ message: 'Nenhum pedido novo', upserted_count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Processamento Simples
    const rows = [];
    for (const order of orders) {
        const items = order.items || [];
        for (const item of items) {
            rows.push({
                external_id: `${order.id}-${item.sku}`,
                order_number: String(order.id),
                contact_name: order.customer?.name || 'Cliente',
                sku: item.sku,
                total_amount: Number(item.price || 0),
                sales_rep: 'OLIST',
                imported_at: new Date().toISOString()
            });
        }
    }

    // Salvar no Banco
    let count = 0;
    if (rows.length > 0) {
        const { error, count: upsertCount } = await supabase
            .from('sales_history')
            .upsert(rows, { onConflict: 'external_id', count: 'exact' });
        
        if (error) throw error;
        count = upsertCount || 0;
    }

    return new Response(
      JSON.stringify({ message: 'Sucesso', upserted_count: count }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
