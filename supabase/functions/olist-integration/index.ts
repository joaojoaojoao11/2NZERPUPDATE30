import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  // 1. ESTRATÉGIA DO ESPELHO (Fundamental para funcionar com autenticação)
  // Pega a origem de quem chamou (ex: http://localhost:3000)
  const origin = req.headers.get('Origin') || '*';

  // 2. CONFIGURAÇÃO DO CRACHÁ (CORS)
  const corsHeaders = {
    'Access-Control-Allow-Origin': origin, // <--- O Segredo: Responde exatamente a origem que chamou
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true', // <--- Obrigatório porque o front envia token
  };

  // 3. PORTEIRO (Responde ao "Posso entrar?" do navegador)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 4. RECUPERAÇÃO DE CHAVES (Com fallback para garantir)
    const TOKEN_TINY = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY') || ""; 
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TOKEN_TINY) throw new Error("ERRO CONFIG: TINY_TOKEN não encontrado nos Secrets.");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("ERRO CONFIG: Chaves Supabase ausentes.");

    // Limpeza do token
    let token = TOKEN_TINY;
    if (token.includes("=")) token = token.split('=').pop()?.trim() || token;
    token = token.trim();

    // 5. INÍCIO DO PROCESSO
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log(`[TinySync] Iniciando sincronização... Origem: ${origin}`);

    // --- LÓGICA DE SINCRONIZAÇÃO (Mantive sua lógica original aqui) ---
    let pagina = 1;
    const itemsPorPagina = 50; 
    let stopExecution = false;
    let totalSalvo = 0;
    const allRows: any[] = [];
    const startTime = performance.now();

    while (!stopExecution) {
        if ((performance.now() - startTime) > 50000) break; // Timeout de segurança

        const urlBusca = new URL('https://api.tiny.com.br/api2/pedidos.pesquisa.php');
        urlBusca.searchParams.set('token', token);
        urlBusca.searchParams.set('formato', 'json');
        urlBusca.searchParams.set('limit', String(itemsPorPagina));
        urlBusca.searchParams.set('pagina', String(pagina));

        const resBusca = await fetch(urlBusca.toString());
        const jsonBusca = await resBusca.json();

        if (jsonBusca.retorno.status === 'Erro') {
            if (jsonBusca.retorno.codigo_erro == 20) { // Fim da lista
                stopExecution = true; 
                break;
            }
            // Se o token for inválido, paramos e avisamos
            if (jsonBusca.retorno.erros[0].erro.includes('token')) {
                throw new Error("Token do Tiny inválido ou expirado.");
            }
            // Outros erros (ex: sem pedidos novos), apenas paramos
            stopExecution = true;
            break;
        }

        const listaPedidos = jsonBusca.retorno.pedidos || [];
        if (listaPedidos.length === 0) { stopExecution = true; break; }

        // Processamento detalhado (Mantido igual ao seu código)
        for (const itemLista of listaPedidos) {
            const idPedido = itemLista.pedido.id;
            try {
               const urlDetalhe = new URL('https://api.tiny.com.br/api2/pedido.obter.php');
               urlDetalhe.searchParams.set('token', token);
               urlDetalhe.searchParams.set('id', idPedido);
               urlDetalhe.searchParams.set('formato', 'json');

               const resDetalhe = await fetch(urlDetalhe.toString());
               const jsonDetalhe = await resDetalhe.json();

               if (jsonDetalhe.retorno.status === 'OK') {
                   const p = jsonDetalhe.retorno.pedido;
                   
                   let dataVendaISO = new Date().toISOString();
                   if (p.data_pedido) {
                       const parts = p.data_pedido.split('/'); 
                       if (parts.length === 3) dataVendaISO = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`).toISOString();
                   }

                   let nomeVendedor = null;
                   if (p.nome_vendedor && p.nome_vendedor.length > 1) nomeVendedor = p.nome_vendedor;
                   else if (p.vendedor?.nome) nomeVendedor = p.vendedor.nome;
                   else if (typeof p.vendedor === 'string') nomeVendedor = p.vendedor;
                   
                   const vendedorFinal = nomeVendedor || p.ecommerce || 'SISTEMA';
                   const itens = p.itens || [{ item: { codigo: 'GEN', descricao: 'Item Genérico', quantidade: 1, valor_unitario: p.valor_total } }];

                   itens.forEach((wrapper: any, index: number) => {
                       const i = wrapper.item;
                       allRows.push({
                           external_id: `TINY-${p.id}-${index + 1}`, 
                           order_number: String(p.numero),
                           product_id_external: i.id_produto ? String(i.id_produto) : null,
                           sale_date: dataVendaISO,
                           status: p.situacao,
                           imported_at: new Date().toISOString(),
                           contact_name: p.cliente.nome,
                           sku: i.codigo,
                           description: i.descricao,
                           quantity: Number(i.quantidade || 0),
                           total_amount: Number(i.valor_total || (Number(i.quantidade) * Number(i.valor_unitario))),
                           sales_rep: vendedorFinal
                       });
                   });
               }
            } catch (err) { console.error(err); }
        }
        pagina++; 
    }

    if (allRows.length > 0) {
        const { error } = await supabase.from('sales_history').upsert(allRows, { onConflict: 'external_id' });
        if (error) throw error;
        totalSalvo = allRows.length;
    }

    // 6. RESPOSTA FINAL (Sucesso)
    return new Response(
      JSON.stringify({ 
          message: `Sincronização OK!`, 
          upserted_count: totalSalvo,
          orders_read: allRows.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (err: any) {
    console.error("ERRO FATAL:", err.message);
    // 7. RESPOSTA DE ERRO (Com headers CORS para não travar o front)
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});