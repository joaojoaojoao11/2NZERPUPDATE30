// Fix: The original Deno types reference URL is deprecated and broken.
// We declare the 'Deno' global here to provide TypeScript with the necessary types
// for the Supabase Edge Function environment, resolving "Cannot find name 'Deno'".
declare global {
  const Deno: {
    env: {
      get(key: string): string | undefined;
    };
  };
}

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Configuração de CORS para permitir que apenas seu app Vercel acesse a função
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Em produção, troque '*' pela URL do seu app Vercel
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Endpoint da API da Olist para pedidos de venda
const OLIST_API_ENDPOINT = 'https://api.olist.com/v1/orders';

serve(async (req) => {
  // Responde a requisições OPTIONS (pre-flight) para CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Pega a chave da API da Olist de forma segura (Secrets do Supabase)
    const OLIST_API_KEY = Deno.env.get('OLIST_API_KEY');
    if (!OLIST_API_KEY) {
      throw new Error('Chave de API da Olist não configurada nos Segredos do Supabase.');
    }

    // 2. Faz a chamada para a API da Olist
    const response = await fetch(OLIST_API_ENDPOINT, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${OLIST_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Olist API Error:", errorBody);
      throw new Error(`Erro na API da Olist: ${response.status} ${response.statusText}`);
    }

    const olistData = await response.json();

    if (!olistData || !olistData.data) {
      console.warn("Olist API response did not contain 'data' field.", olistData);
      return new Response(JSON.stringify({ data: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // 3. Transforma os dados da Olist para o formato do nosso `SalesHistoryItem`
    const transformedData = olistData.data.flatMap((order: any) => 
      (order.items || []).map((item: any) => ({
        externalId: `${order.id}-${item.sku}`, // Cria um ID único por item de pedido
        orderNumber: order.id,
        saleDate: order.created_at,
        status: order.status?.name || 'DESCONHECIDO',
        contactName: order.customer?.name,
        cpfCnpj: order.customer?.document,
        email: order.customer?.email,
        phone: order.customer?.phone,
        sku: item.sku,
        description: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        totalAmount: (item.price || 0) * (item.quantity || 0),
        salesRep: order.seller?.name || 'Olist Store',
        trackingCode: order.shipping?.tracking_code,
        recipientName: order.shipping?.receiver_name,
        recipientAddress: `${order.shipping?.street || ''}, ${order.shipping?.number || ''}`,
        recipientCity: order.shipping?.city,
        recipientState: order.shipping?.state
      }))
    );
    
    // 4. Retorna os dados transformados para o frontend
    return new Response(JSON.stringify({ data: transformedData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Edge Function Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
