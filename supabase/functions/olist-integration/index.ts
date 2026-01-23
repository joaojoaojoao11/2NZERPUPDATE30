
// ESTE ARQUIVO ESTÁ OBSOLETO E PODE SER REMOVIDO.
// A lógica foi movida para a nova função 'sync-olist'.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

serve(async (req) => {
  return new Response(
    JSON.stringify({ message: "Esta função foi movida para 'sync-olist'. Por favor, use a nova função." }),
    { 
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
      status: 410 
    }
  );
});
