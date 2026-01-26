import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  // 1. CONFIGURAÇÃO DE SEGURANÇA (CORS) - MANTIDA
  const requestOrigin = req.headers.get('Origin') || '*';
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': requestOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };

  // 2. RESPOSTA RÁPIDA AO "PREFLIGHT"
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 3. RECUPERAÇÃO DE CHAVES
    const TOKEN_TINY = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY') || ""; 
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TOKEN_TINY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Configuração incompleta: Verifique as chaves no Supabase Secrets.");
    }

    // Limpeza do token
    let token = TOKEN_TINY;
    if (token.includes("=")) token = token.split('=').pop()?.trim() || token;
    token = token.trim();

    // 4. INÍCIO DA SINCRONIZAÇÃO REAL
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log(`[TinySync] Iniciando sincronização completa...`);

    let pagina = 1;
    const itemsPorPagina = 50; 
    let stopExecution = false;
    let totalSalvo = 0;
    const allRows: any[] = [];
    const startTime = performance.now();

    // LOOP DE PAGINAÇÃO
    while (!stopExecution) {
        // Trava de segurança para não estourar o tempo limite da Edge Function (aprox 50s)
        if ((performance.now() - startTime) > 45000) {
            console.log("[TinySync] Tempo limite de segurança atingido. Pausando.");
            break;
        }

        console.log(`[TinySync] Buscando Página ${pagina}...`);
        
        // Busca a lista de pedidos
        const urlBusca = new URL('https://api.tiny.com.br/api2/pedidos.pesquisa.php');
        urlBusca.searchParams.set('token', token);
        urlBusca.searchParams.set('formato', 'json');
        urlBusca.searchParams.set('limit', String(itemsPorPagina));
        urlBusca.searchParams.set('pagina', String(pagina));
        // Se quiser filtrar por data no futuro, é aqui. Por padrão, o Tiny traz os recentes.

        const resBusca = await fetch(urlBusca.toString());
        const jsonBusca = await resBusca.json();

        // Verificações de Erro da API Tiny
        if (jsonBusca.retorno.status === 'Erro') {
            // Erro 20 = "Não há registros" (Fim da lista)
            if (jsonBusca.retorno.codigo_erro == 20) {
                console.log("[TinySync] Fim da lista de pedidos.");
                stopExecution = true;
                break;
            }
            // Outros erros
            if (jsonBusca.retorno.erros[0].erro.includes('token')) {
                throw new Error("Token do Tiny inválido ou expirado.");
            }
            console.warn(`[TinySync] Aviso Tiny: ${jsonBusca.retorno.erros[0].erro}`);
            stopExecution = true;
            break;
        }

        const listaPedidos = jsonBusca.retorno.pedidos || [];
        if (listaPedidos.length === 0) {
            stopExecution = true;
            break;
        }

        // DETALHAMENTO DOS PEDIDOS (Um a um)
        console.log(`[TinySync] Detalhando ${listaPedidos.length} pedidos...`);
        
        const promises = listaPedidos.map(async (itemLista: any) => {
            try {
                const idPedido = itemLista.pedido.id;
                const urlDetalhe = new URL('https://api.tiny.com.br/api2/pedido.obter.php');
                urlDetalhe.searchParams.set('token', token);
                urlDetalhe.searchParams.set('id', idPedido);
                urlDetalhe.searchParams.set('formato', 'json');

                const resDetalhe = await fetch(urlDetalhe.toString());
                const jsonDetalhe = await resDetalhe.json();

                if (jsonDetalhe.retorno.status === 'OK') {
                    const p = jsonDetalhe.retorno.pedido;
                    
                    // Tratamento de Data
                    let dataVendaISO = new Date().toISOString();
                    if (p.data_pedido) {
                        const parts = p.data_pedido.split('/'); 
                        if (parts.length === 3) {
                            // Converte DD/MM/AAAA para AAAA-MM-DD
                            dataVendaISO = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`).toISOString();
                        }
                    }

                    // Tratamento de Vendedor
                    let nomeVendedor = null;
                    if (p.nome_vendedor && p.nome_vendedor.length > 1) nomeVendedor = p.nome_vendedor;
                    else if (p.vendedor?.nome) nomeVendedor = p.vendedor.nome;
                    else if (typeof p.vendedor === 'string') nomeVendedor = p.vendedor;
                    
                    const vendedorFinal = nomeVendedor || p.ecommerce || 'SISTEMA';

                    // Tratamento de Itens
                    const itens = p.itens || [{ item: { codigo: 'GEN', descricao: 'Item Genérico', quantidade: 1, valor_unitario: p.valor_total } }];

                    return itens.map((wrapper: any, index: number) => {
                        const i = wrapper.item;
                        return {
                            external_id: `TINY-${p.id}-${index + 1}`, // ID Único para evitar duplicatas
                            order_number: String(p.numero),
                            product_id_external: i.id_produto ? String(i.id_produto) : null,
                            sale_date: dataVendaISO,
                            status: p.situacao,
                            imported_at: new Date().toISOString(),
                            contact_name: p.cliente.nome,
                            contact_id: p.cliente.codigo || null,
                            cpf_cnpj: p.cliente.cpf_cnpj,
                            email: p.cliente.email,
                            phone: p.cliente.fone || p.cliente.celular,
                            sku: i.codigo,
                            description: i.descricao,
                            quantity: Number(i.quantidade || 0),
                            unit_price: Number(i.valor_unitario || 0),
                            total_amount: Number(i.valor_total || (Number(i.quantidade) * Number(i.valor_unitario))),
                            sales_rep: vendedorFinal
                        };
                    });
                }
            } catch (err) {
                console.error(`Erro ao processar pedido:`, err);
                return [];
            }
            return [];
        });

        // Espera todos os detalhes da página baixarem
        const pageResults = await Promise.all(promises);
        const pageRows = pageResults.flat();
        allRows.push(...pageRows);
        
        pagina++; 
    }

    // 5. SALVAR NO BANCO DE DADOS (Upsert)
    if (allRows.length > 0) {
        console.log(`[TinySync] Salvando ${allRows.length} linhas no Supabase...`);
        const { error } = await supabase
            .from('sales_history')
            .upsert(allRows, { onConflict: 'external_id' });
        
        if (error) {
            console.error("Erro no Upsert:", error);
            throw error;
        }
        totalSalvo = allRows.length;
    }

    // 6. RESPOSTA FINAL AO SITE
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
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});