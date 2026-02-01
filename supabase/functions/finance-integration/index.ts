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

        // --- RESET TOTAL (OPÇÃO NUCLEAR) ---
        let body = {};
        try { body = await req.json(); } catch (e) { }

        if (body && (body as any).action === 'reset_db') {
            console.log(`[FinanceSync] ☢️ ATENÇÃO: RESET TOTAL SOLICITADO! LIMPANDO BANCO...`);
            const { error: delErr } = await supabase.from('accounts_receivable').delete().neq('ID', '0');
            if (delErr) console.error(`[FinanceSync] Erro ao limpar banco:`, delErr);
            else console.log(`[FinanceSync] Banco limpo com sucesso. Iniciando recarga total.`);
        }

        console.log(`[FinanceSync] Iniciando Sincronização Espelhada (Mirror Mode)...`);

        let totalSalvo = 0;
        const startTime = performance.now();
        const itemsPorPagina = 100;
        const idsProcessados = new Set<string>();

        // 3. ESTRATÉGIAS DE BUSCA 
        const hoje = new Date();
        const sessentaDiasAtras = new Date();
        sessentaDiasAtras.setDate(hoje.getDate() - 60);
        const formatDataTiny = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

        const estrategias = [
            // Estratégia 1: O que mudou recentemente (foco em pagamentos e baixas)
            { nome: "RECÉM PAGOS (60d)", usePagamento: true, dataIni: formatDataTiny(sessentaDiasAtras), dataFim: formatDataTiny(hoje) },
            // Estratégia 2: Varredura Completa por Emissão (Garante que novos títulos entrem)
            { nome: "2026 (ATUAL)", dataIni: "01/01/2026", dataFim: "31/12/2026" },
            { nome: "2025 (ANTERIOR)", dataIni: "01/01/2025", dataFim: "31/12/2025" }
        ];

        for (const est of estrategias) {
            if ((performance.now() - startTime) > 55000) break;

            let pagina = 1;
            const stateId = `finance_receber_${est.nome.replace(/\s/g, '_')}`;

            // Checkpoint para fases longas
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
                if ((performance.now() - startTime) > 55000) {
                    console.log("[FinanceSync] Tempo limite. Encerrando com segurança.");
                    break;
                }

                await sleep(3000); // Respeito à API do Tiny

                const urlBusca = new URL('https://api.tiny.com.br/api2/contas.receber.pesquisa.php');
                urlBusca.searchParams.set('token', token);
                urlBusca.searchParams.set('formato', 'json');
                urlBusca.searchParams.set('limit', String(itemsPorPagina));
                urlBusca.searchParams.set('pagina', String(pagina));

                if (est.usePagamento) {
                    urlBusca.searchParams.set('data_ini_vencimento', est.dataIni);
                    urlBusca.searchParams.set('data_fim_vencimento', est.dataFim);
                } else {
                    urlBusca.searchParams.set('data_ini_emissao', est.dataIni);
                    urlBusca.searchParams.set('data_fim_emissao', est.dataFim);
                }

                const resBusca = await fetch(urlBusca.toString());
                const jsonBusca = await resBusca.json();

                if (jsonBusca.retorno.status === 'Erro') {
                    const msg = jsonBusca.retorno.erros[0].erro;
                    if (msg.includes("Bloqueada") || msg.includes("Excedido")) {
                        await supabase.from('finance_sync_state').upsert({ id: stateId, last_page: pagina - 1 });
                        return new Response(JSON.stringify({ error: "API Bloqueada. Checkpoint Salvo." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 });
                    }
                    if (jsonBusca.retorno.codigo_erro == 20 || msg.toLowerCase().includes('não existe')) {
                        stopFase = true;
                        await supabase.from('finance_sync_state').delete().eq('id', stateId);
                    } else {
                        console.warn(`[FinanceSync] Aviso: ${msg}`);
                        stopFase = true;
                    }
                    console.log(`[FinanceSync] FASE ${est.nome} FINALIZADA.`);
                    break;
                }

                const listaContas = (jsonBusca.retorno.contas || []).map((c: any) => c.conta);
                if (listaContas.length === 0) {
                    stopFase = true;
                    phaseCompleted = true;
                    await supabase.from('finance_sync_state').delete().eq('id', stateId);
                    break;
                }

                console.log(`[FinanceSync] (${est.nome}) Pág ${pagina}: ${listaContas.length} contas.`);

                const allRows: any[] = [];

                for (const conta of listaContas) {
                    if (!conta.id || String(conta.id) === 'undefined') continue;

                    const idStr = String(conta.id);
                    allTinyIDsThisPhase.add(idStr);

                    if (idsProcessados.has(idStr)) continue;
                    idsProcessados.add(idStr);

                    // --- TRATAMENTO DE CAMPOS PURO (SEM REGRAS DE VISUALIZAÇÃO) ---

                    // 1. Datas Principais
                    const dataEmissao = parseTinyDate(conta.data_emissao);
                    const dataVencimentoReal = parseTinyDate(conta.data_vencimento); // NUNCA MAIS ALTERAR ISSO
                    let dataLiquidacao = parseTinyDate(conta.data_pagamento);

                    // 2. Valores Originais
                    let valorOriginal = Number(conta.valor) || 0;
                    let saldo = Number(conta.saldo) || 0;
                    let valorRecebidoCalculado = valorOriginal - saldo;

                    // 3. Normalização de Situação
                    let situacao = conta.situacao;
                    let formaRecebimento = conta.forma_recebimento || "";
                    let categoria = conta.categoria || "";

                    // Se cancelado, mantemos o valor do documento para histórico, mas saldo 0.
                    if (['cancelada', 'cancelado', 'excluida'].includes(String(situacao).toLowerCase())) {
                        saldo = 0;
                        valorRecebidoCalculado = 0;
                    } else {
                        totalValorFase += valorOriginal;
                        totalSaldoFase += saldo;
                    }

                    // --- DEEP FETCH (BUSCA PROFUNDA PARA DADOS FALTANTES) ---
                    // Se está liquidado mas não temos a data real de pagamento ou valor exato pago
                    const estaLiquidado = ['liquidado', 'pago', 'recebido'].includes(String(situacao).toLowerCase());
                    const precisaDetalhes = est.usePagamento || (estaLiquidado && (!dataLiquidacao || !formaRecebimento));

                    if (precisaDetalhes) {
                        // Lógica de Rate Limit e busca detalhada mantida, mas atualizando as variáveis corretas
                        const { data: existing } = await supabase.from('accounts_receivable').select('ID, "Forma de recebimento"').eq('ID', idStr).single();

                        // Só busca se não temos a informação ou se precisamos atualizar pagamento recente
                        if (!existing || !existing["Forma de recebimento"] || est.usePagamento) {
                            if ((performance.now() - startTime) < 50000) {
                                try {
                                    await sleep(1000); // Delay extra para não sobrecarregar
                                    const resDet = await fetch(`https://api.tiny.com.br/api2/conta.receber.obter.php?token=${token}&formato=json&id=${idStr}`);
                                    const jsonDet = await resDet.json();
                                    if (jsonDet.retorno?.status === 'OK') {
                                        const det = jsonDet.retorno.conta;
                                        if (det.data_pagamento) dataLiquidacao = parseTinyDate(det.data_pagamento);
                                        if (det.valor_recebido) valorRecebidoCalculado = Number(det.valor_recebido);
                                        if (det.forma_pagamento) formaRecebimento = det.forma_pagamento;
                                        if (det.categoria) categoria = det.categoria;
                                    }
                                } catch (e) { console.warn('Erro deep fetch', e); }
                            }
                        } else {
                            // Se já temos no banco e não é busca prioritária, usa o do banco para economizar API
                            if (!formaRecebimento) formaRecebimento = existing["Forma de recebimento"];
                        }
                    }

                    // Fallback: Se liquidado e ainda sem data, usa vencimento como data de liquidação (mas mantém vencimento original intacto)
                    if (estaLiquidado && !dataLiquidacao) {
                        dataLiquidacao = dataVencimentoReal;
                    }

                    // Competência
                    let competencia = null;
                    if (conta.data_vencimento && conta.data_vencimento.length >= 7) {
                        const partes = conta.data_vencimento.split('/');
                        if (partes.length === 3) competencia = `${partes[1]}/${partes[2]}`;
                    }

                    // --- MAPEAMENTO FINAL 1:1 ---
                    allRows.push({
                        "ID": idStr,
                        "Cliente": conta.nome_cliente || 'Cliente Desconhecido',
                        "Data Emissão": dataEmissao,

                        // AQUI ESTAVA O ERRO: Agora mapeamos direto
                        "Data Vencimento": dataVencimentoReal,  // Original do Tiny
                        "Data Liquidação": dataLiquidacao,      // Data real do pagamento
                        "data_recebimento": dataLiquidacao,     // Redundância conforme seu schema

                        "Valor documento": valorOriginal,       // Valor cheio original
                        "Recebido": valorRecebidoCalculado,     // O quanto de fato entrou

                        "Saldo": estaLiquidado ? 0 : saldo,
                        "Situação": situacao, // Mantém 'cancelado', 'aberto', 'liquidado' como vem do Tiny

                        "Número documento": conta.numero_doc,
                        "Histórico": conta.historico,
                        "Competência": competencia,
                        "Forma de recebimento": formaRecebimento,
                        "Categoria": categoria,
                        "ult_atuali": new Date().toISOString()
                    });
                }

                if (allRows.length > 0) {
                    const { error } = await supabase.from('accounts_receivable').upsert(allRows, { onConflict: 'ID' });
                    if (error) console.error("Erro Upsert:", error.message);
                    else totalSalvo += allRows.length;
                }

                await supabase.from('finance_sync_state').upsert({ id: stateId, last_page: pagina });
                pagina++;
            }

            // --- GARBAGE COLLECTION (Mantido para limpar IDs deletados no Tiny) ---
            if (phaseCompleted) {
                const toIso = (d: string) => { const [dia, mes, ano] = d.split('/'); return `${ano}-${mes}-${dia}`; };
                const isoIni = toIso(est.dataIni);
                const isoFim = toIso(est.dataFim);
                const campoFiltro = est.usePagamento ? "Data Vencimento" : "Data Emissão";

                const { data: dbItems } = await supabase.from('accounts_receivable').select('ID').gte(campoFiltro, `${isoIni}T00:00:00`).lte(campoFiltro, `${isoFim}T23:59:59`);
                if (dbItems) {
                    const ghosts = dbItems.filter((item: any) => !allTinyIDsThisPhase.has(String(item.ID))).map((g: any) => g.ID);
                    if (ghosts.length > 0) await supabase.from('accounts_receivable').delete().in('ID', ghosts);
                }
            }
        }

        return new Response(JSON.stringify({ message: `Sincronização OK!`, upserted_count: totalSalvo }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

    } catch (err: any) {
        console.error("[FinanceSync] ERRO FATAL:", err.message);
        return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
    }
});