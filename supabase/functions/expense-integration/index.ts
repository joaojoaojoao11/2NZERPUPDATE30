import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// --- FUNÇÃO DE DATA BLINDADA ---
function parseTinyDate(dateStr: string | null): string | null {
    if (!dateStr || typeof dateStr !== 'string') return null;
    try {
        const cleanDate = dateStr.split(' ')[0].trim();
        let year, month, day;
        if (cleanDate.includes('/')) {
            [day, month, year] = cleanDate.split('/');
        } else if (cleanDate.includes('-')) {
            [year, month, day] = cleanDate.split('-');
        } else {
            return null;
        }
        return new Date(`${year}-${month}-${day}T12:00:00.000Z`).toISOString();
    } catch (e) { return null; }
}

// --- PAUSA PARA NÃO BLOQUEAR A API ---
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  // 1. CONFIGURAÇÃO CORS
  const requestOrigin = req.headers.get('Origin') || '*';
  const corsHeaders = {
    'Access-Control-Allow-Origin': requestOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const TOKEN_TINY = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY') || "";
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TOKEN_TINY || !SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Configuração incompleta.');

    let token = TOKEN_TINY;
    if (token.includes("=")) token = token.split('=').pop()?.trim() || token;
    token = token.trim();

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    console.log(`[ExpenseSync] Iniciando Sincronização (Schema Validado)...`);

    let totalSalvo = 0;
    const startTime = performance.now();
    const itemsPorPagina = 100;
    const idsProcessados = new Set<string>();

    // 2. ESTRATÉGIA: DO FUTURO PARA O PASSADO
    const estrategias = [
        { nome: "PAGAR 2026", dataIni: "01/01/2026", dataFim: "31/12/2026" },
        { nome: "PAGAR 2025", dataIni: "01/01/2025", dataFim: "31/12/2025" },
        { nome: "PAGAR 2024", dataIni: "01/01/2024", dataFim: "31/12/2024" }
    ];

    for (const est of estrategias) {
        if ((performance.now() - startTime) > 55000) break;

        console.log(`[ExpenseSync] >>> FASE: ${est.nome}`);
        let pagina = 1;
        let stopFase = false;

        while (!stopFase) {
            if ((performance.now() - startTime) > 55000) {
                console.log("[ExpenseSync] Tempo limite. Encerrando.");
                break;
            }

            await sleep(1500); 

            const urlBusca = new URL('https://api.tiny.com.br/api2/contas.pagar.pesquisa.php');
            urlBusca.searchParams.set('token', token);
            urlBusca.searchParams.set('formato', 'json');
            urlBusca.searchParams.set('limit', String(itemsPorPagina));
            urlBusca.searchParams.set('pagina', String(pagina));
            urlBusca.searchParams.set('data_ini_emissao', est.dataIni);
            urlBusca.searchParams.set('data_fim_emissao', est.dataFim);

            const resBusca = await fetch(urlBusca.toString());
            const jsonBusca = await resBusca.json();

            if (jsonBusca.retorno.status === 'Erro') {
                const msg = jsonBusca.retorno.erros[0].erro;
                if (msg.includes("Bloqueada") || msg.includes("Excedido")) {
                    return new Response(JSON.stringify({ error: "Tiny bloqueou (API Limit)." }), { status: 429 });
                }
                if (jsonBusca.retorno.codigo_erro == 20 || msg.toLowerCase().includes('não existe')) {
                    stopFase = true; 
                } else {
                    console.warn(`[ExpenseSync] Aviso: ${msg}`);
                    stopFase = true;
                }
                break;
            }

            const listaContas = jsonBusca.retorno.contas || [];
            if (listaContas.length === 0) { stopFase = true; break; }

            console.log(`[ExpenseSync] (${est.nome}) Pág ${pagina}: ${listaContas.length} contas.`);
            
            const allRows: any[] = [];
            
            for (const conta of listaContas) {
                const idStr = String(conta.id);

                if (idsProcessados.has(idStr)) continue;
                idsProcessados.add(idStr);

                const dataVencCorrigida = parseTinyDate(conta.data_vencimento);
                const dataFinalVenc = dataVencCorrigida || parseTinyDate(conta.data_emissao) || new Date().toISOString();
                const dataEmissaoCorrigida = parseTinyDate(conta.data_emissao);
                const dataLiqCorrigida = parseTinyDate(conta.data_pagamento);
                
                const valorDoc = Number(conta.valor) || 0;
                const saldo = Number(conta.saldo) || 0;
                const valorPago = valorDoc - saldo;

                let competencia = null;
                if (conta.data_vencimento && conta.data_vencimento.length >= 7) {
                    const partes = conta.data_vencimento.split('/');
                    if (partes.length === 3) competencia = `${partes[1]}/${partes[2]}`;
                }

                // --- MAPEAMENTO EXATO COM O ESQUEMA SQL ---
                allRows.push({
                    id: idStr,                               // id (text)
                    fornecedor: conta.nome_cliente || conta.nome_fornecedor || 'Desconhecido', // fornecedor (text)
                    data_emissao: dataEmissaoCorrigida,      // data_emissao (date)
                    data_vencimento: dataFinalVenc,          // data_vencimento (date)
                    data_liquidacao: dataLiqCorrigida,       // data_liquidacao (date)
                    valor_documento: valorDoc,               // valor_documento (numeric)
                    saldo: saldo,                            // saldo (numeric)
                    situacao: conta.situacao,                // situacao (text)
                    numero_documento: conta.numero_doc,      // numero_documento (text)
                    // categoria: null,                      // categoria (não vem fácil na lista do Tiny, deixamos null ou o banco assume default)
                    historico: conta.historico,              // historico (text)
                    valor_pago: valorPago,                   // valor_pago (numeric)
                    competencia: competencia,                // competencia (text)
                    // forma_pagamento: null,                // forma_pagamento (não vem na lista simples, deixamos null)
                    // chave_pix_boleto: null,               // chave_pix_boleto (deixamos null)
                    ult_atuali: new Date().toISOString()     // ult_atuali (timestamp)
                });
            }

            if (allRows.length > 0) {
                // Upsert usando a chave primária 'id' (minúsculo)
                const { error } = await supabase.from('accounts_payable').upsert(allRows, { onConflict: 'id' });
                
                if (error) {
                    console.error("Erro no Upsert:", error.message);
                } else {
                    totalSalvo += allRows.length;
                }
            }
            pagina++;
        }
    }

    return new Response(
      JSON.stringify({ 
          message: `Sincronização OK!`, 
          upserted_count: totalSalvo
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (err: any) {
    console.error("[ExpenseSync] ERRO FATAL:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});