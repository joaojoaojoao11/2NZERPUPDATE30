
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// --- FUNÇÃO PARA CORRIGIR AS DATAS ---
function parseTinyDate(dateStr: string | null): string {
  if (!dateStr) return new Date().toISOString();
  try {
    const cleanDate = dateStr.split(' ')[0].trim();
    let year, month, day;
    if (cleanDate.includes('/')) {
      [day, month, year] = cleanDate.split('/');
    } else if (cleanDate.includes('-')) {
      [year, month, day] = cleanDate.split('-');
    } else {
      return new Date().toISOString();
    }
    return new Date(`${year}-${month}-${day}T12:00:00.000Z`).toISOString();
  } catch (e) {
    return new Date().toISOString();
  }
}

// --- HELPER DE DELAY PARA EVITAR RATE LIMIT ---
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get('Origin') || '*';
  const corsHeaders = {
    'Access-Control-Allow-Origin': requestOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const TOKEN = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY') || "";
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TOKEN || !SUPABASE_URL || !SUPABASE_KEY) throw new Error("Configuração incompleta.");

    // Limpa token se vier sujo
    const cleanToken = TOKEN.includes("=") ? TOKEN.split('=').pop()?.trim() || TOKEN : TOKEN;

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log(`[TinySync] Iniciando (Modo Reverso + Rate Limit Control)...`);

    const ITEMS_PER_PAGE = 50;
    let totalSalvo = 0;
    const startTime = performance.now();

    // 1. Descobrir Total de Páginas (Meta)
    const urlInit = `https://api.tiny.com.br/api2/pedidos.pesquisa.php?token=${cleanToken}&formato=json&limit=${ITEMS_PER_PAGE}&pagina=1`;
    const resInit = await fetch(urlInit);
    const jsonInit = await resInit.json();

    if (jsonInit.retorno.status === 'Erro') throw new Error(`Tiny API Error: ${jsonInit.retorno.erros[0].erro}`);

    const totalPaginas = Number(jsonInit.retorno.numero_paginas || 1);
    console.log(`[TinySync] Total Páginas: ${totalPaginas}. Começando da última.`);

    // 2. Loop Reverso (Última -> Primeira)
    // Processamos no máximo 5 páginas para não estourar o tempo de execução (50s)
    const MAX_PAGES = 5;
    const startPage = totalPaginas;
    const endPage = Math.max(1, totalPaginas - MAX_PAGES + 1);

    for (let p = startPage; p >= endPage; p--) {
      if ((performance.now() - startTime) > 45000) { // Safety margin 45s
        console.log("[TinySync] Timeout preventivo. Encerrando.");
        break;
      }

      console.log(`[TinySync] Lendo Página ${p}...`);

      // Fetch Lista da Página
      const urlPage = `https://api.tiny.com.br/api2/pedidos.pesquisa.php?token=${cleanToken}&formato=json&limit=${ITEMS_PER_PAGE}&pagina=${p}`;
      const resPage = await fetch(urlPage);
      const jsonPage = await resPage.json();

      if (jsonPage.retorno.status === 'Erro') {
        const msg = jsonPage.retorno.erros[0].erro;
        if (msg.includes('Bloqueada') || msg.includes('Excedido')) {
          console.warn("[TinySync] API Rate Limit atingido! Esperando 2s...");
          await sleep(2000);
          continue; // Tenta próxima iteração (ou repete? aqui vamos pular para eivar loop infinito)
        }
        console.warn(`[TinySync] Erro Pág ${p}: ${msg}`);
        continue;
      }

      const pedidosList = jsonPage.retorno.pedidos || [];
      if (pedidosList.length === 0) continue;

      console.log(`[TinySync] Detalhando ${pedidosList.length} pedidos (com delay)...`);

      const pageRows: any[] = [];

      // BUSCA DETALHES COM THROTTLING (Seqüencial ou Chunks pequenos)
      // Tiny suporta pouca concorrência. Vamos de 1 em 1 para garantir, é lento mas seguro.
      // Ou chunks de 3.
      // BUSCA DETALHES COM THROTTLING EXTREMO (1 por 1)
      // Tiny API Limit: aprox 60 req/min.
      // Processando 1 a 1 com delay de 600ms garante ~50-60 req/min.
      const CHUNK_SIZE = 1;
      for (let i = 0; i < pedidosList.length; i += CHUNK_SIZE) {
        // Trava de segurança de tempo no meio do loop
        if ((performance.now() - startTime) > 50000) {
          console.log("[TinySync] Timeout iminente durante processamento. Salvando o que temos...");
          break;
        }

        const chunk = pedidosList.slice(i, i + CHUNK_SIZE);
        const chunkPromises = chunk.map(async (item: any) => {
          try {
            const urlDet = `https://api.tiny.com.br/api2/pedido.obter.php?token=${cleanToken}&formato=json&id=${item.pedido.id}`;
            const resDet = await fetch(urlDet);
            const jsonDet = await resDet.json();

            if (jsonDet.retorno.status !== 'OK') return [];

            const pd = jsonDet.retorno.pedido;
            const saleDate = parseTinyDate(pd.data_pedido);

            // Filtro Data Corte (30 dias)
            if (new Date(saleDate) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) return [];

            // Fallback para itens (caso não haja lista de itens, usa o total do pedido como item único)
            const itens = pd.itens || [{
              item: {
                codigo: 'GEN',
                descricao: 'Item Genérico',
                quantidade: 1,
                valor_unitario: pd.valor_total,
                valor_total: pd.valor_total // Adicionado para garantir total no item genérico
              }
            }];

            return itens.map((iw: any, idx: number) => ({
              external_id: `TINY-${pd.id}-${idx + 1}`,
              order_number: String(pd.numero),
              product_id_external: iw.item.id_produto ? String(iw.item.id_produto) : null,
              sale_date: saleDate,
              status: pd.situacao,
              contact_name: pd.cliente.nome,
              contact_id: pd.cliente.codigo || null,
              cpf_cnpj: pd.cliente.cpf_cnpj,
              email: pd.cliente.email,
              phone: pd.cliente.fone || pd.cliente.celular,
              sku: iw.item.codigo,
              description: iw.item.descricao,
              quantity: Number(iw.item.quantidade || 0),
              unit_price: Number(iw.item.valor_unitario || 0),
              // PRECO TOTAL: Se o item não tiver 'valor_total' explícito, calcula (qtd * unitario)
              total_amount: Number(iw.item.valor_total) || (Number(iw.item.quantidade || 0) * Number(iw.item.valor_unitario || 0)),
              sales_rep: pd.nome_vendedor || pd.vendedor?.nome || 'SISTEMA',
              imported_at: new Date().toISOString()
            }));

          } catch (e) {
            return [];
          }
        });

        const results = await Promise.all(chunkPromises);
        pageRows.push(...results.flat());

        // Delay para respeitar limite (600ms + network latency ~= 1s por request)
        await sleep(600);
      }

      // SALVA PÁGINA
      if (pageRows.length > 0) {
        const { error: upsertError } = await supabase.from('sales_history').upsert(pageRows, { onConflict: 'external_id' });
        if (!upsertError) {
          totalSalvo += pageRows.length;
          console.log(`[TinySync] Salvo pág ${p}: ${pageRows.length} itens.`);
        } else {
          console.error(`[TinySync] Erro ao salvar pág ${p}:`, upsertError);
        }
      }
    }

    return new Response(
      JSON.stringify({ message: "Sincronização Finalizada", upserted_count: totalSalvo }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});