import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  // 1. PEGA A ORIGEM EXATA (Quem está chamando? ex: http://localhost:3000)
  const origin = req.headers.get('Origin') || '*';
  
  // 2. CONFIGURA O "CRACHÁ" COMPLETO (Necessário quando tem login envolvido)
  const corsHeaders = {
    'Access-Control-Allow-Origin': origin, 
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true', // <--- OBRIGATÓRIO para supabase-js
  };

  // 3. PORTEIRO (OPTIONS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 4. CHAVES
    const TOKEN_TINY = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY') || ""; 
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');

    if (!TOKEN_TINY) throw new Error("TINY_TOKEN não encontrado.");
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Chaves Supabase ausentes.");

    let token = TOKEN_TINY;
    if (token.includes("=")) token = token.split('=').pop()?.trim() || token;
    token = token.trim();

    // 5. TESTE DE CONEXÃO
    console.log(`[TinySync] Iniciando POST v2...`);
    
    const urlBusca = new URL('https://api.tiny.com.br/api2/pedidos.pesquisa.php');
    urlBusca.searchParams.set('token', token);
    urlBusca.searchParams.set('formato', 'json');
    urlBusca.searchParams.set('limit', '1'); 

    const resBusca = await fetch(urlBusca.toString());
    const jsonBusca = await resBusca.json();

    if (jsonBusca.retorno.status === 'Erro') {
        throw new Error(`Tiny Erro: ${jsonBusca.retorno.erros[0].erro}`);
    }

    const total = jsonBusca.retorno.pedidos?.length || 0;

    // 6. RESPOSTA (Sempre devolvendo os corsHeaders)
    return new Response(
      JSON.stringify({ 
        message: `Sincronização OK!`,
        details: `${total} pedidos encontrados.` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (err: any) {
    console.error(`[TinySync] ERRO: ${err.message}`);
    return new Response(
      JSON.stringify({ error: err.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});