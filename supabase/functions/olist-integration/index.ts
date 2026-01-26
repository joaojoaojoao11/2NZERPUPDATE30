import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// --- FUNÇÃO PARA CORRIGIR AS DATAS ---
function parseTinyDate(dateStr: string | null): string {
  if (!dateStr) {
      console.warn("[TinySync] Data vazia. Usando hoje.");
      return new Date().toISOString();
  }

  try {
    // Limpa a string (ex: remove horas se vier "26/01/2026 14:00")
    const cleanDate = dateStr.split(' ')[0].trim();
    let year, month, day;

    // Detecta se é DD/MM/AAAA ou AAAA-MM-DD
    if (cleanDate.includes('/')) {
      [day, month, year] = cleanDate.split('/');
    } else if (cleanDate.includes('-')) {
      [year, month, day] = cleanDate.split('-');
    } else {
      console.warn(`[TinySync] Formato desconhecido: ${dateStr}. Usando hoje.`);
      return new Date().toISOString();
    }

    // Cria a data travada no MEIO-DIA UTC (12:00) para evitar erro de fuso horário
    return new Date(`${year}-${month}-${day}T12:00:00.000Z`).toISOString();

  } catch (e) {
    console.error(`[TinySync] Erro na data: ${dateStr}`, e);
    return new Date().toISOString();
  }
}

Deno.serve(async (req) => {
  // 1. SEGURANÇA (CORS)
  const requestOrigin = req.headers.get('Origin') || '*';
  const corsHeaders = {
    'Access-Control-Allow-Origin': requestOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. CONFIGURAÇÃO E CHAVES
    const TOKEN_TINY = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY') || ""; 
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TOKEN_TINY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Chaves de configuração ausentes no Supabase.");
    }

    let token = TOKEN_TINY;
    if (token.includes("=")) token = token.split('=').pop()?.trim() || token;
    token = token.trim();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log(`[TinySync] Iniciando sincronização...`);

    let pagina = 1;
    const itemsPorPagina = 50; 
    let stopExecution = false;
    let totalSalvo = 0;
    const allRows: any[] = [];
    const startTime = performance.now();

    // 3. LOOP DE BUSCA (Paginação)
    while (!stopExecution) {
        // Trava de segurança de tempo (50s)
        if ((performance.now() - startTime) > 50000) {
            console.log("[TinySync] Tempo limite atingido.");
            break;
        }

        console.log(`[TinySync] Página ${pagina}...`);
        
        const urlBusca = new URL('https://api.tiny.com.br/api2/pedidos.pesquisa.php');
        urlBusca.searchParams.set('token', token);
        urlBusca.searchParams.set('formato', 'json');
        urlBusca.searchParams.set('limit', String(itemsPorPagina));
        urlBusca.searchParams.set('pagina', String(pagina));

        const resBusca = await fetch(urlBusca.toString());
        const jsonBusca = await resBusca.json();

        // Tratamento de Erros da API
        if (jsonBusca.retorno.status === 'Erro') {
            if (jsonBusca.retorno.codigo_erro == 20) {
                console.log("[TinySync] Fim da lista.");
                stopExecution = true;
                break;
            }
            if (jsonBusca.retorno.erros[0].erro.includes('token')) {
                throw new Error("Token Inválido.");
            }
            console.warn(`[TinySync] Aviso Tiny: ${jsonBusca.retorno.erros[0].erro}`);
            stopExecution = true;
            break;
        }

        const listaPedidos = jsonBusca.retorno.pedidos || [];
        if (listaPedidos.length === 0) { stopExecution = true; break; }

        console.log(`[TinySync] Processando ${listaPedidos.length} pedidos...`);
        
        // 4. DETALHAMENTO DOS PEDIDOS
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
                    
                    // --- CORREÇÃO DA DATA AQUI ---
                    const dataCorrigida = parseTinyDate(p.data_pedido);

                    let nomeVendedor = null;
                    if (p.nome_vendedor && p.nome_vendedor.length > 1) nomeVendedor = p.nome_vendedor;
                    else if (p.vendedor?.nome) nomeVendedor = p.vendedor.nome;
                    else if (typeof p.vendedor === 'string') nomeVendedor = p.vendedor;
                    
                    const vendedorFinal = nomeVendedor || p.ecommerce || 'SISTEMA';

                    const itens = p.itens || [{ item: { codigo: 'GEN', descricao: 'Item Genérico', quantidade: 1, valor_unitario: p.valor_total } }];

                    return itens.map((wrapper: any, index: number) => {
                        const i = wrapper.item;
                        return {
                            external_id: `TINY-${p.id}-${index + 1}`, 
                            order_number: String(p.numero),
                            product_id_external: i.id_produto ? String(i.id_produto) : null,
                            sale_date: dataCorrigida, // <--- CAMPO CORRIGIDO
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
                console.error(`Erro no pedido ${itemLista.pedido.id}:`, err);
                return [];
            }
            return [];
        });

        const pageResults = await Promise.all(promises);
        const pageRows = pageResults.flat();
        allRows.push(...pageRows);
        
        pagina++; 
    }

    // 5. SALVAR NO BANCO
    if (allRows.length > 0) {
        console.log(`[TinySync] Salvando ${allRows.length} linhas...`);
        const { error } = await supabase
            .from('sales_history')
            .upsert(allRows, { onConflict: 'external_id' });
        
        if (error) throw error;
        totalSalvo = allRows.length;
    }

    return new Response(
      JSON.stringify({ message: `Sincronização OK!`, upserted_count: totalSalvo }),
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