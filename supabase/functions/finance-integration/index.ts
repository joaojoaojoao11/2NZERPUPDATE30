import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// --- FUNÇÃO DE DATA BLINDADA (Corrige fuso horário) ---
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
        // Fixa ao meio-dia UTC para evitar que o fuso horário mude o dia
        return new Date(`${year}-${month}-${day}T12:00:00.000Z`).toISOString();
    } catch (e) { return null; }
}

// --- PAUSA DE RESPEITO À API (Evita bloqueio 429) ---
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
    // 2. CREDENCIAIS
    const TOKEN_TINY = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY') || "";
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TOKEN_TINY || !SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Configuração incompleta no Supabase.');

    let token = TOKEN_TINY;
    if (token.includes("=")) token = token.split('=').pop()?.trim() || token;
    token = token.trim();

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    console.log(`[FinanceSync] Iniciando Sincronização Definitiva...`);

    let totalSalvo = 0;
    const startTime = performance.now();
    const itemsPorPagina = 100; // Máximo permitido pelo Tiny para agilizar
    const idsProcessados = new Set<string>(); // Evita erros de duplicidade no insert

    // 3. ESTRATÉGIAS DE BUSCA (Ordem: Presente -> Passado)
    const estrategias = [
        { nome: "2026 (ATUAL)", dataIni: "01/01/2026", dataFim: "31/12/2026" },
        { nome: "2025 (ANTERIOR)", dataIni: "01/01/2025", dataFim: "31/12/2025" },
        { nome: "2024 (HISTÓRICO)", dataIni: "01/01/2024", dataFim: "31/12/2024" }
    ];

    for (const est of estrategias) {
        // Trava de tempo global (55s)
        if ((performance.now() - startTime) > 55000) break;

        console.log(`[FinanceSync] >>> FASE: ${est.nome}`);
        let pagina = 1;
        let stopFase = false;

        while (!stopFase) {
            // Trava de tempo interna
            if ((performance.now() - startTime) > 55000) {
                console.log("[FinanceSync] Tempo limite. Encerrando com segurança.");
                break;
            }

            // Pausa de 1.5s entre requisições
            await sleep(1500); 

            const urlBusca = new URL('https://api.tiny.com.br/api2/contas.receber.pesquisa.php');
            urlBusca.searchParams.set('token', token);
            urlBusca.searchParams.set('formato', 'json');
            urlBusca.searchParams.set('limit', String(itemsPorPagina));
            urlBusca.searchParams.set('pagina', String(pagina));
            
            // Filtro por Data de Emissão (Mais seguro que vencimento)
            urlBusca.searchParams.set('data_ini_emissao', est.dataIni);
            urlBusca.searchParams.set('data_fim_emissao', est.dataFim);

            const resBusca = await fetch(urlBusca.toString());
            const jsonBusca = await resBusca.json();

            // Tratamento de Erros da API
            if (jsonBusca.retorno.status === 'Erro') {
                const msg = jsonBusca.retorno.erros[0].erro;
                
                // Erro Crítico: Bloqueio
                if (msg.includes("Bloqueada") || msg.includes("Excedido")) {
                    console.error(`[FinanceSync] BLOQUEIO TINY: ${msg}`);
                    return new Response(
                        JSON.stringify({ error: "API do Tiny bloqueou por excesso de chamadas. Aguarde 5 min." }), 
                        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
                    );
                }

                // Erro Normal: Fim da paginação
                if (jsonBusca.retorno.codigo_erro == 20 || msg.toLowerCase().includes('não existe')) {
                    stopFase = true;
                } else {
                    console.warn(`[FinanceSync] Aviso: ${msg}`);
                    stopFase = true;
                }
                break;
            }

            const listaContas = jsonBusca.retorno.contas || [];
            if (listaContas.length === 0) { stopFase = true; break; }

            console.log(`[FinanceSync] (${est.nome}) Pág ${pagina}: ${listaContas.length} contas.`);
            
            const allRows: any[] = [];
            
            for (const conta of listaContas) {
                const idStr = String(conta.id);

                // Dedup: Se já processamos este ID nesta execução, pula
                if (idsProcessados.has(idStr)) continue;
                idsProcessados.add(idStr);

                // Tratamento de Datas
                const dataVencCorrigida = parseTinyDate(conta.data_vencimento);
                const dataFinalVenc = dataVencCorrigida || parseTinyDate(conta.data_emissao) || new Date().toISOString();
                const dataEmissaoCorrigida = parseTinyDate(conta.data_emissao);
                const dataLiqCorrigida = parseTinyDate(conta.data_pagamento);
                
                // Valores
                const valorDoc = Number(conta.valor) || 0;
                const saldo = Number(conta.saldo) || 0;
                const recebido = valorDoc - saldo;

                // Competência
                let competencia = null;
                if (conta.data_vencimento && conta.data_vencimento.length >= 7) {
                    const partes = conta.data_vencimento.split('/');
                    if (partes.length === 3) competencia = `${partes[1]}/${partes[2]}`;
                }

                allRows.push({
                    "ID": idStr,
                    "Cliente": conta.nome_cliente || 'Cliente Desconhecido',
                    "Data Emissão": dataEmissaoCorrigida,
                    "Data Vencimento": dataFinalVenc,
                    "Data Liquidação": dataLiqCorrigida,
                    "Valor documento": valorDoc,
                    "Saldo": saldo,
                    "Situação": conta.situacao,
                    "Número documento": conta.numero_doc,
                    "Histórico": conta.historico,
                    "Competência": competencia,
                    "Recebido": recebido,
                    "ult_atuali": new Date().toISOString()
                    // OBS: Campo 'origem' removido para evitar erro de constraint no banco
                });
            }

            // Salvar no Banco
            if (allRows.length > 0) {
                const { error } = await supabase.from('accounts_receivable').upsert(allRows, { onConflict: 'ID' });
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
    console.error("[FinanceSync] ERRO FATAL:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});