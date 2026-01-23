
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Esta função foi desativada para padronizar o uso de 'olist-integration'.
// Se chamada, retornará um erro indicando a função correta.
serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  return new Response(
    JSON.stringify({ error: "Esta função (sync-olist) está obsoleta. Utilize a função 'olist-integration'." }),
    { 
      headers: { 
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      status: 410 // 410 Gone: Indica que o recurso não está mais disponível permanentemente.
    }
  );
});
