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
        // 2. CREDENCIAISfiz 
        const TOKEN_TINY = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY') || "";
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!TOKEN_TINY || !SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Configuração incompleta no Supabase.');

        let token = TOKEN_TINY;
        if (token.includes("=")) token = token.split('=').pop()?.trim() || token;
        token = token.trim();

        const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // --- RESET TOTAL (OPÇÃO NUCLEAR) ---
        // Se a requisição pedir 'reset_db', limpamos tudo antes de começar.
        let body = {};
        try { body = await req.json(); } catch (e) { }

        if (body && (body as any).action === 'reset_db') {
            console.log(`[FinanceSync] ☢️ ATENÇÃO: RESET TOTAL SOLICITADO! LIMPANDO BANCO...`);
            const { error: delErr } = await supabase.from('accounts_receivable').delete().neq('ID', '0'); // Delete *
            if (delErr) console.error(`[FinanceSync] Erro ao limpar banco:`, delErr);
            else console.log(`[FinanceSync] Banco limpo com sucesso. Iniciando recarga total.`);
        }

        console.log(`[FinanceSync] Iniciando Sincronização Definitiva...`);

        let totalSalvo = 0;
        const startTime = performance.now();
        const itemsPorPagina = 100; // Máximo permitido pelo Tiny para agilizar
        const idsProcessados = new Set<string>(); // Evita erros de duplicidade no insert

        // 3. ESTRATÉGIAS DE BUSCA (Ordem: Pagamentos Recentes -> Presente -> Passado)
        // Calculando datas dinâmicas para "Pagamentos Recentes" (últimos 60 dias)
        const hoje = new Date();
        const sessentaDiasAtras = new Date();
        sessentaDiasAtras.setDate(hoje.getDate() - 60);
        const formatDataTiny = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

        const estrategias = [
            // Estratégia CRÍTICA: Buscar pelo que foi PAGO recentemente (Pega contas antigas que foram baixadas agora)
            { nome: "RECÉM PAGOS (60d)", usePagamento: true, dataIni: formatDataTiny(sessentaDiasAtras), dataFim: formatDataTiny(hoje) },

            // Estratégias de Cobertura (Por Emissão)
            { nome: "2026 (ATUAL)", dataIni: "01/01/2026", dataFim: "31/12/2026" },
            { nome: "2025 (ANTERIOR)", dataIni: "01/01/2025", dataFim: "31/12/2025" }
        ];

        for (const est of estrategias) {
            // Trava de tempo global (55s)
            if ((performance.now() - startTime) > 55000) break;

            // --- LÓGICA DE CHECKPOINT (MEMÓRIA) ---
            // Verifica se jpa paramos em alguma página antes
            let pagina = 1;
            const stateId = `finance_receber_${est.nome.replace(/\s/g, '_')}`;

            // Apenas para as fases Grandes (Anuais) usamos checkpoint para não ficar preso.
            // Para "Recém Pagos" (Curto prazo), sempre é bom reler tudo para garantir.
            // Mas se estiver dando timeout até no Recente, o checkpoint ajuda. Vamos habilitar geral.

            const { data: savedState } = await supabase.from('finance_sync_state').select('last_page').eq('id', stateId).single();
            if (savedState && savedState.last_page) {
                console.log(`[Checkpoint] Retomando fase ${est.nome} da página ${savedState.last_page + 1}`);
                pagina = savedState.last_page + 1;
            }

            let stopFase = false;
            let totalValorFase = 0;
            let totalSaldoFase = 0;
            const allTinyIDsThisPhase = new Set<string>();
            let phaseCompleted = false;

            while (!stopFase) {
                // Trava de tempo interna
                if ((performance.now() - startTime) > 55000) {
                    console.log("[FinanceSync] Tempo limite. Encerrando com segurança.");
                    break;
                }

                // Pausa de 3s entre requisições de página (Evita bloqueio geral)
                await sleep(3000);

                const urlBusca = new URL('https://api.tiny.com.br/api2/contas.receber.pesquisa.php');
                urlBusca.searchParams.set('token', token);
                urlBusca.searchParams.set('formato', 'json');
                urlBusca.searchParams.set('limit', String(itemsPorPagina));
                urlBusca.searchParams.set('pagina', String(pagina));

                // Filtro Dinâmico (Emissão ou Vencimento)
                if (est.usePagamento) {
                    urlBusca.searchParams.set('data_ini_vencimento', est.dataIni);
                    urlBusca.searchParams.set('data_fim_vencimento', est.dataFim);
                } else {
                    urlBusca.searchParams.set('data_ini_emissao', est.dataIni);
                    urlBusca.searchParams.set('data_fim_emissao', est.dataFim);
                }

                const resBusca = await fetch(urlBusca.toString());
                const jsonBusca = await resBusca.json();

                // Tratamento de Erros da API
                if (jsonBusca.retorno.status === 'Erro') {
                    const msg = jsonBusca.retorno.erros[0].erro;

                    // Erro Crítico: Bloqueio
                    if (msg.includes("Bloqueada") || msg.includes("Excedido")) {
                        console.error(`[FinanceSync] BLOQUEIO TINY: ${msg}`);
                        // Salva onde parou para tentar de novo depois
                        await supabase.from('finance_sync_state').upsert({ id: stateId, last_page: pagina - 1 });
                        return new Response(
                            JSON.stringify({ error: "API Bloqueada. Checkpoint Salvo." }),
                            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
                        );
                    }

                    // Erro Normal: Fim da paginação
                    if (jsonBusca.retorno.codigo_erro == 20 || msg.toLowerCase().includes('não existe')) {
                        stopFase = true;
                        // Se acabou, limpa o state
                        await supabase.from('finance_sync_state').delete().eq('id', stateId);
                    } else {
                        console.warn(`[FinanceSync] Aviso: ${msg}`);
                        stopFase = true;
                    }
                    console.log(`[FinanceSync] FASE ${est.nome} FINALIZADA. Total Valor: R$ ${totalValorFase.toFixed(2)} | Total Saldo: R$ ${totalSaldoFase.toFixed(2)}`);
                    break;
                }

                const listaContas = (jsonBusca.retorno.contas || []).map((c: any) => c.conta);
                if (listaContas.length === 0) {
                    console.log(`[FinanceSync] FASE ${est.nome} FINALIZADA (Sem contas).`);
                    stopFase = true;
                    phaseCompleted = true;
                    // Se acabou, limpa o state para recomeçar na próxima
                    await supabase.from('finance_sync_state').delete().eq('id', stateId);
                    break;
                }

                console.log(`[FinanceSync] (${est.nome}) Pág ${pagina}: ${listaContas.length} contas.`);

                const allRows: any[] = [];
                // ... (Processamento dos itens continua igual) ...

                for (const conta of listaContas) {
                    // PROTEÇÃO CONTRA GHOSTS: Se não tem ID ou é 'undefined', ignora
                    if (!conta.id || String(conta.id) === 'undefined') continue;

                    const idStr = String(conta.id);
                    allTinyIDsThisPhase.add(idStr); // COLETA ID PARA GC

                    // SPY e Deep Fetch (Enriquecimento) apenas para estratégia prioritária
                    let formaRecebimento = conta.forma_recebimento || "";
                    let categoria = conta.categoria || "";

                    // Dedup: Se já processamos este ID nesta execução, pula
                    if (idsProcessados.has(idStr)) continue;
                    idsProcessados.add(idStr);

                    // Tratamento de Datas
                    const dataVencCorrigida = parseTinyDate(conta.data_vencimento);
                    let dataFinalVenc = dataVencCorrigida || parseTinyDate(conta.data_emissao) || new Date().toISOString();
                    const dataEmissaoCorrigida = parseTinyDate(conta.data_emissao);
                    let dataLiqCorrigida = parseTinyDate(conta.data_pagamento);

                    // Valores
                    let valorDoc = Number(conta.valor) || 0;
                    let saldo = Number(conta.saldo) || 0;
                    let recebido = valorDoc - saldo;

                    // Normalização de Situação
                    let situacaoFinal = conta.situacao;

                    // Tratamento de Cancelados (Manter histórico, mas zerar valor financeiro)
                    if (['cancelada', 'cancelado', 'excluida'].includes(String(situacaoFinal).toLowerCase())) {
                        console.log(`[FinanceSync] Item cancelado/excluído ID ${idStr}. Zerando valores...`);
                        valorDoc = 0;
                        saldo = 0;
                        recebido = 0;
                        // Não deletamos mais (continue), vamos deixar o upsert atualizar com valores zerados.
                    } else {
                        // Acumuladores de Fase (Diagnóstico de Divergência) - Somente Válidos
                        totalValorFase += valorDoc;
                        totalSaldoFase += saldo;
                    }

                    if (['liquidado', 'pago', 'recebido'].includes(String(situacaoFinal).toLowerCase())) {
                        situacaoFinal = 'Liquidado';
                        // FALLBACK: Se está pago mas não veio data_pagamento, usa vencimento
                        if (!dataLiqCorrigida) {
                            dataLiqCorrigida = dataFinalVenc;
                        }
                    }

                    // --- REFATORAÇÃO DE DATAS E VALORES (FLUXO REAL) ---
                    // Objetivo: O Dashboard deve mostrar quando o dinheiro entrou e quanto entrou.

                    let dataParaFrontend = dataFinalVenc; // Default: Vencimento Original
                    let valorParaFrontend = valorDoc;     // Default: Valor Documento

                    // Se Liquidado:
                    if (situacaoFinal === 'Liquidado') {
                        // 1. DATA: Usar Data de Liquidação (Se existir)
                        if (dataLiqCorrigida) {
                            dataParaFrontend = dataLiqCorrigida;
                        }

                        // 2. VALOR: Usar Valor Recebido (Se existir e for > 0)
                        if (recebido > 0) {
                            valorParaFrontend = recebido;
                        }
                    }

                    // --- LÓGICA DE DEEP FETCH (ENRIQUECIMENTO) ---
                    // Trigger: 
                    // 1. Estratégia 'Recém Pagos' (prioridade para detalhes atuais).
                    // 2. CORREÇÃO: Item 'Liquidado' mas sem 'data_pagamento' na listagem (obriga buscar para corrigir data).

                    const precisaCorrigirData = (situacaoFinal === 'Liquidado' && !dataLiqCorrigida);
                    const deveBuscarDetalhes = est.usePagamento || precisaCorrigirData;

                    if (deveBuscarDetalhes && situacaoFinal === 'Liquidado') {
                        const { data: existing } = await supabase
                            .from('accounts_receivable')
                            .select('ID, "Forma de recebimento"')
                            .eq('ID', idStr)
                            .single();

                        // Se não tem no banco, OU falta info, OU precisamos corrigir a data faltante
                        if (!existing || !existing["Forma de recebimento"] || existing["Forma de recebimento"] === "" || precisaCorrigirData) {
                            // Rate Limit Safety: 50s (Security Margin)
                            if ((performance.now() - startTime) > 50000) {
                                console.log("[FinanceSync] Tempo limite atingido. Parando processamento para salvar parcial.");
                                break;
                            }

                            try {
                                await sleep(1000); // AUMENTADO PARA 1s (Evitar Bloqueio API)
                                const urlDetalhe = new URL('https://api.tiny.com.br/api2/conta.receber.obter.php');
                                urlDetalhe.searchParams.set('token', token);
                                urlDetalhe.searchParams.set('formato', 'json');
                                urlDetalhe.searchParams.set('id', idStr);

                                const resDet = await fetch(urlDetalhe.toString());
                                const jsonDet = await resDet.json();

                                if (jsonDet.retorno && jsonDet.retorno.status === 'OK' && jsonDet.retorno.conta) {
                                    const det = jsonDet.retorno.conta;

                                    // 1. DATA PAGAMENTO
                                    if (det.data_pagamento) {
                                        dataLiqCorrigida = parseTinyDate(det.data_pagamento);
                                        // Se corrigiu a data, atualiza o frontend também
                                        if (dataLiqCorrigida) dataParaFrontend = dataLiqCorrigida;
                                    }

                                    // 2. VALOR RECEBIDO (Priodadade Máxima)
                                    // A listagem as vezes não traz o valor real pago com juros/multa corretos, o detalhe traz.
                                    if (det.valor_recebido) {
                                        const valRecDetalhe = Number(det.valor_recebido);
                                        if (!isNaN(valRecDetalhe) && valRecDetalhe > 0) {
                                            // Se houve diferença significativa, logamos
                                            if (Math.abs(valRecDetalhe - recebido) > 0.05) {
                                                console.log(`[DeepFetch] Valor Ajustado ID ${idStr}: Listagem=${recebido} -> Detalhe=${valRecDetalhe}`);
                                            }
                                            recebido = valRecDetalhe;
                                            valorParaFrontend = valRecDetalhe;
                                        }
                                    }

                                    if (det.forma_pagamento) formaRecebimento = det.forma_pagamento;
                                    if (det.categoria) categoria = det.categoria;
                                } else if (jsonDet.retorno && jsonDet.retorno.status === 'Erro' && jsonDet.retorno.codigo === '31') {
                                    console.warn("[DeepFetch] API Bloqueada (Rate Limit)! Aguardando 5s...");
                                    await sleep(5000);
                                }
                            } catch (e) { console.warn(`[DeepFetch] Erro:`, e); }
                        } else {
                            if (!formaRecebimento) formaRecebimento = existing["Forma de recebimento"];
                        }
                    }

                    // --- AUTO-FIX: RECEBÍVEIS VENCIDOS E PAGOS ---
                    // Fallback final: Se ainda assim não tiver data liq, usa o vencimento.
                    if (situacaoFinal === 'Liquidado' && (!dataLiqCorrigida || dataLiqCorrigida === "")) {
                        console.log(`[AUTO-FIX] ID ${idStr} Liquidado sem data (falha deep fetch). Usando Vencimento: ${dataFinalVenc}`);
                        dataLiqCorrigida = dataFinalVenc;
                        dataParaFrontend = dataFinalVenc; // Garante consistência
                    }

                    // Competência (BASEADA NA DATA EFETIVA)
                    // Se foi pago em Dezembro, entra na competência de Dezembro, mesmo que vencesse em Novembro.
                    let competencia = null;
                    const dateForCompetencia = dataParaFrontend; // Usa a data definida (Liq ou Venc)

                    if (dateForCompetencia) {
                        // Formato ISO: YYYY-MM-DDTHH...
                        // Extrair Mês e Ano
                        try {
                            const dObj = new Date(dateForCompetencia);
                            if (!isNaN(dObj.getTime())) {
                                const mes = String(dObj.getUTCMonth() + 1).padStart(2, '0');
                                const ano = dObj.getUTCFullYear();
                                competencia = `${mes}/${ano}`;
                            }
                        } catch (e) {
                            // Fallback para string parsing se necessário
                            const parts = dateForCompetencia.split('-');
                            if (parts.length >= 3) competencia = `${parts[1]}/${parts[0]}`;
                        }
                    }

                    // Fallback antigo se falhar
                    if (!competencia && conta.data_vencimento && conta.data_vencimento.length >= 7) {
                        const partes = conta.data_vencimento.split('/');
                        if (partes.length === 3) competencia = `${partes[1]}/${partes[2]}`;
                    }

                    // Mapping para o Schema do Banco
                    allRows.push({
                        "ID": idStr,
                        "Cliente": conta.nome_cliente || 'Cliente Desconhecido',
                        "Data Emissão": dataEmissaoCorrigida,

                        // SWAP DE DATA E VALOR
                        "Data Vencimento": dataParaFrontend,        // DATA REAL (Para o Gráfico/Filtro)
                        "Valor documento": valorParaFrontend,       // VALOR REAL (Para a Soma)

                        // PRESERVANDO ORIGINAIS (Colunas Novas ou Existentes Auxiliares?)
                        // Se o banco não tiver essas colunas, o Supabase ignora silenciosamente se o schema for "strict", 
                        // ou precisamos garantir que o usuario crie. 
                        // Vou assumir que por enquanto vamos sobrescrever as principais para corrigir o dash.
                        // "Data Vencimento Original": dataFinalVenc,

                        "Data Liquidação": dataLiqCorrigida,
                        "Saldo": situacaoFinal === 'Liquidado' ? 0 : saldo,
                        "Situação": situacaoFinal,
                        "Número documento": conta.numero_doc,
                        "Histórico": conta.historico,
                        "Competência": competencia,
                        "Recebido": recebido,
                        "Forma de recebimento": formaRecebimento,
                        "Categoria": categoria,
                        "ult_atuali": new Date().toISOString()
                    });
                }

                // Salvar no Banco
                if (allRows.length > 0) {
                    const { error } = await supabase.from('accounts_receivable').upsert(allRows, { onConflict: 'ID' });
                    if (error) {
                        console.error("Erro no Upsert:", error.message);
                    } else {
                        totalSalvo += allRows.length;
                        // --- CHECKPOINT SALVO COM SUCESSO ---
                        await supabase.from('finance_sync_state').upsert({ id: stateId, last_page: pagina });
                    }
                } else {
                    // Mesmo se vazio (mas não fim, ex: filtro local), avança state
                    await supabase.from('finance_sync_state').upsert({ id: stateId, last_page: pagina });
                }
                pagina++;
            }

            // --- GARBAGE COLLECTION (O FAXINEIRO) ---
            // Se a fase completou 100% sem timeout ou erro, podemos confiar que a lista 'allTinyIDsThisPhase' é a verdade absoluta.
            // Qualquer ID no Supabase para este período que NÃO esteja nessa lista é um fantasma e deve ser deletado.
            if (phaseCompleted) {
                console.log(`[GC] Fase ${est.nome} completa. Iniciando busca de Fantasmas...`);

                // 1. Converter datas para formato ISO (YYYY-MM-DD) para query no Supabase
                // formatTinyDate retorna DD/MM/YYYY. Precisamos converter.
                const toIso = (d: string) => {
                    const [dia, mes, ano] = d.split('/');
                    return `${ano}-${mes}-${dia}`;
                };
                const isoIni = toIso(est.dataIni);
                const isoFim = toIso(est.dataFim);
                const campoFiltro = est.usePagamento ? "Data Vencimento" : "Data Emissão";

                // 2. Buscar TODOS IDs do Supabase neste range (Paginação interna se necessário, mas aqui assumimos < 1000)
                const { data: dbItems, error: dbErr } = await supabase
                    .from('accounts_receivable')
                    .select('ID')
                    .gte(campoFiltro, `${isoIni}T00:00:00`)
                    .lte(campoFiltro, `${isoFim}T23:59:59`);

                if (!dbErr && dbItems) {
                    const ghosts = dbItems.filter((item: any) => !allTinyIDsThisPhase.has(String(item.ID)));

                    if (ghosts.length > 0) {
                        console.log(`[GC] ${ghosts.length} FANTASMAS ENCONTRADOS na fase ${est.nome}. Exterminando...`);
                        const ghostIDs = ghosts.map((g: any) => g.ID);

                        // Delete em lote
                        const { error: delErr } = await supabase
                            .from('accounts_receivable')
                            .delete()
                            .in('ID', ghostIDs);

                        if (delErr) console.error(`[GC] Erro ao deletar fantasmas:`, delErr);
                        else console.log(`[GC] Limpeza concluída com sucesso.`);
                    } else {
                        console.log(`[GC] Nenhum fantasma encontrado. Banco limpo.`);
                    }
                }
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