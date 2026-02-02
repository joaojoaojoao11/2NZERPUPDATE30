import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// --- CONFIGURAÇÕES ---
const START_DATE_DEFAULT = '2025-12-01';
const SYNC_CURSOR_ID = 'finance_sync_day_cursor';

function parseTinyDate(dateStr: string | null): string | null {
    if (!dateStr || typeof dateStr !== 'string') return null;
    try {
        const cleanDate = dateStr.split(' ')[0].trim();
        let year, month, day;
        if (cleanDate.includes('/')) {
            [day, month, year] = cleanDate.split('/');
        } else if (cleanDate.includes('-')) {
            [year, month, day] = cleanDate.split('-');
        } else { return null; }
        return new Date(`${year}-${month}-${day}T12:00:00.000Z`).toISOString();
    } catch (e) { return null; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
        const TOKEN_TINY = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY') || "";
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!TOKEN_TINY || !SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Configuração incompleta.');
        let token = TOKEN_TINY.includes("=") ? TOKEN_TINY.split('=').pop()?.trim() || TOKEN_TINY : TOKEN_TINY.trim();
        const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // --- RESET ---
        let body = {};
        try { body = await req.json(); } catch (e) { }
        if (body && (body as any).action === 'reset_db') {
            console.log(`[FinanceSync] ☢️ RESET DB...`);
            await supabase.from('accounts_receivable').delete().neq('ID', '0');
            await supabase.from('finance_sync_state').delete().eq('id', SYNC_CURSOR_ID);
        }

        // --- CURSOR (FORÇA DEZ 2025 SE ANTERIOR) ---
        let currentDateStr = START_DATE_DEFAULT;
        const { data: stateData } = await supabase.from('finance_sync_state').select('last_date').eq('id', SYNC_CURSOR_ID).single();

        if (stateData && stateData.last_date) {
            const cursorDb = new Date(stateData.last_date);
            const targetStart = new Date(START_DATE_DEFAULT);

            if (cursorDb < targetStart) {
                // Se o cursor for velho, avança
                currentDateStr = START_DATE_DEFAULT;
                console.log(`[FinanceSync] ⏩ Avançando cursor antigo (${stateData.last_date}) para alvo: ${currentDateStr}`);
            } else {
                const lastDate = new Date(stateData.last_date + "T12:00:00.000Z");
                lastDate.setDate(lastDate.getDate() + 1);
                currentDateStr = lastDate.toISOString().split('T')[0];
                console.log(`[FinanceSync] 🔄 Retomando de: ${currentDateStr}`);
            }
        } else {
            console.log(`[FinanceSync] 🚀 Iniciando alvo: ${currentDateStr}`);
        }

        const startTime = performance.now();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let daysProcessed = 0;
        let cursorDate = new Date(currentDateStr + "T12:00:00.000Z");

        while (cursorDate <= today) {
            if ((performance.now() - startTime) > 50000) {
                console.log(`[FinanceSync] ⏳ Tempo limite. Parando em ${currentDateStr}.`);
                break;
            }

            const visualDate = cursorDate.toISOString().split('T')[0];
            const tinyDateFmt = `${String(cursorDate.getDate()).padStart(2, '0')}/${String(cursorDate.getMonth() + 1).padStart(2, '0')}/${cursorDate.getFullYear()}`;

            console.log(`[FinanceSync] 📅 Processando VENCIMENTOS dia: ${tinyDateFmt} ...`);

            let pagina = 1;
            let temMaisPaginas = true;

            while (temMaisPaginas) {
                await sleep(1500); // 1.5s entre chamadas de lista

                const url = new URL('https://api.tiny.com.br/api2/contas.receber.pesquisa.php');
                url.searchParams.set('token', token);
                url.searchParams.set('formato', 'json');
                url.searchParams.set('limit', '100');
                url.searchParams.set('pagina', String(pagina));
                // [MUDANÇA] Filtro por VENCIMENTO (Melhor proxy para Liquidação)
                url.searchParams.set('data_ini_vencimento', tinyDateFmt);
                url.searchParams.set('data_fim_vencimento', tinyDateFmt);

                const res = await fetch(url.toString());
                const json = await res.json();

                if (json.retorno.status === 'Erro') {
                    const msg = json.retorno.erros[0].erro;
                    if (json.retorno.codigo_erro == 20 || msg.toLowerCase().includes('não existe')) {
                        temMaisPaginas = false;
                    } else if (msg.includes('Bloqueada') || msg.includes('Excedido')) {
                        console.error(`[FinanceSync] 🛑 BLOQUEIO TINY no dia ${tinyDateFmt}. Salvando estado anterior.`);
                        // Não avança o cursor, apenas para.
                        return new Response(JSON.stringify({ error: "API Bloqueada" }), { headers: corsHeaders, status: 429 });
                    } else {
                        console.warn(`[FinanceSync] Aviso dia ${tinyDateFmt}: ${msg}`);
                        temMaisPaginas = false;
                    }
                } else {
                    const contas = (json.retorno.contas || []).map((c: any) => c.conta);
                    if (contas.length === 0) {
                        temMaisPaginas = false;
                    } else {
                        console.log(`   -> Dia ${tinyDateFmt} - Pág ${pagina}: ${contas.length} contas.`);
                        await processarContas(supabase, contas, token, startTime);
                        if (contas.length < 100) temMaisPaginas = false;
                        else pagina++;
                    }
                }
            }

            // --- SAVEPOINT ---
            await supabase.from('finance_sync_state').upsert({
                id: SYNC_CURSOR_ID,
                last_date: visualDate
            });

            console.log(`[FinanceSync] ✅ Dia ${tinyDateFmt} Sucesso.`);
            daysProcessed++;
            cursorDate.setDate(cursorDate.getDate() + 1);
        }

        return new Response(JSON.stringify({ message: "Sync Executado", days: daysProcessed }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

    } catch (err: any) {
        console.error(err);
        return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
    }
});

async function processarContas(supabase: any, contas: any[], token: string, startTime: number) {
    const allRows = [];

    for (const conta of contas) {
        if (!conta.id) continue;
        const idStr = String(conta.id);

        const dataEmissao = parseTinyDate(conta.data_emissao);
        const dataVencimento = parseTinyDate(conta.data_vencimento);
        let dataLiquidacao = parseTinyDate(conta.data_pagamento);

        let valorOriginal = Number(conta.valor) || 0;
        let saldo = Number(conta.saldo) || 0;
        let valorRecebido: number | undefined = undefined;

        let situacao = String(conta.situacao).trim();
        let formaRecebimento = conta.forma_recebimento || null;
        let categoria = conta.categoria || null;

        const isLiquidado = ['liquidado', 'pago', 'recebido'].includes(situacao.toLowerCase());
        const isCancelado = ['cancelada', 'cancelado', 'excluida'].includes(situacao.toLowerCase());

        if (isCancelado) { saldo = 0; valorRecebido = 0; }
        else if (isLiquidado) { situacao = "Liquidado"; saldo = 0; }

        if (isLiquidado) {
            // --- THROTTLE 2s ---
            if ((performance.now() - startTime) < 55000) {
                await sleep(2000); // 2 SEGUNDOS DE SEGURANÇA

                try {
                    const resp = await fetch(`https://api.tiny.com.br/api2/conta.receber.obter.php?token=${token}&formato=json&id=${idStr}`);
                    const json = await resp.json();
                    if (json.retorno?.status === 'OK') {
                        const det = json.retorno.conta;
                        if (det.data_pagamento) dataLiquidacao = parseTinyDate(det.data_pagamento);
                        if (det.valor_recebido) valorRecebido = Number(det.valor_recebido);
                        if (det.forma_pagamento) formaRecebimento = det.forma_pagamento;
                        if (det.categoria) categoria = det.categoria;

                        // --- ESPIÃO ---
                        if (isLiquidado && !dataLiquidacao) {
                            console.log(`[ESPIÃO] 🚨 ID ${idStr} Liq s/ Data. Tiny:`, JSON.stringify(det));
                        }
                    }
                } catch (e) { console.warn(`Erro deep fetch ${idStr}`, e); }
            }
        }

        if (isLiquidado && !dataLiquidacao) console.warn(`[ANOMALIA] ID ${idStr} Liquidado s/ data.`);
        if (valorRecebido === undefined) valorRecebido = valorOriginal - saldo;

        let competencia = null;
        if (conta.data_vencimento && conta.data_vencimento.includes('/')) {
            const [d, m, y] = conta.data_vencimento.split('/');
            competencia = `${m}/${y}`;
        }

        allRows.push({
            "ID": idStr,
            "Cliente": conta.nome_cliente || 'Cliente Desconhecido',
            "Data Emissão": dataEmissao,
            "Data Vencimento": dataVencimento,
            "Data Liquidação": dataLiquidacao,
            "data_recebimento": dataLiquidacao,
            "Valor documento": valorOriginal,
            "Recebido": valorRecebido,
            "Saldo": saldo,
            "Situação": situacao,
            "Número documento": conta.numero_doc,
            "Histórico": conta.historico,
            "Competência": competencia,
            "Forma de recebimento": formaRecebimento,
            "Categoria": categoria,
            "ult_atuali": new Date().toISOString()
        });
    }

    if (allRows.length > 0) {
        await supabase.from('accounts_receivable').upsert(allRows, { onConflict: 'ID' });
    }
}