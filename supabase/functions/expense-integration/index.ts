import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// --- CONFIGURAÇÕES ---
const TIME_LIMIT_MS = 45000; // 45 segundos (limite de segurança)
const PAUSA_API = 1000;      // 1 segundo entre chamadas

// --- FUNÇÃO DE DATA ---
function parseDate(dateStr: string | null): string | null {
    if (!dateStr || typeof dateStr !== 'string') return null;
    try {
        const clean = dateStr.split(' ')[0].trim();
        let y, m, d;
        if (clean.includes('/')) [d, m, y] = clean.split('/');
        else if (clean.includes('-')) [y, m, d] = clean.split('-');
        else return null;
        return `${y}-${m}-${d}`;
    } catch { return null; }
}

Deno.serve(async (req) => {
  // CORS Check
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    });
  }

  const startTime = performance.now();
  console.log("--> [ExpenseSync] Iniciando...");

  try {
    const TOKEN = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY');
    const SB_URL = Deno.env.get('SUPABASE_URL');
    const SB_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TOKEN || !SB_URL || !SB_KEY) throw new Error('Configuração incompleta.');

    // Limpa token se necessário
    let cleanToken = TOKEN.includes("=") ? TOKEN.split('=').pop()?.trim() || TOKEN : TOKEN;

    const supabase = createClient(SB_URL, SB_KEY);
    
    // ESTRATÉGIA: Buscar 2026, depois 2025.
    const periodos = [
        { ini: "01/01/2026", fim: "31/12/2026" },
        { ini: "01/01/2025", fim: "31/12/2025" }
    ];

    let totalSalvo = 0;
    let stopGlobal = false;
    const idsProcessados = new Set<string>();

    for (const p of periodos) {
        if (stopGlobal) break;
        let pagina = 1;

        while (true) {
            // VERIFICAÇÃO DE TEMPO CRÍTICA
            if ((performance.now() - startTime) > TIME_LIMIT_MS) {
                console.log(`--> [ExpenseSync] Tempo limite (${TIME_LIMIT_MS}ms) atingido. Salvando e encerrando.`);
                stopGlobal = true;
                break;
            }

            console.log(`--> Buscando ${p.ini} Pág ${pagina}...`);
            await new Promise(r => setTimeout(r, PAUSA_API));

            const url = new URL('https://api.tiny.com.br/api2/contas.pagar.pesquisa.php');
            url.searchParams.set('token', cleanToken);
            url.searchParams.set('formato', 'json');
            url.searchParams.set('limit', "100");
            url.searchParams.set('pagina', String(pagina));
            url.searchParams.set('data_ini_emissao', p.ini);
            url.searchParams.set('data_fim_emissao', p.fim);

            const res = await fetch(url.toString());
            const json = await res.json();

            if (json.retorno.status === 'Erro') {
                const erro = json.retorno.erros[0].erro;
                if (erro.includes("Bloqueada") || erro.includes("Excedido")) {
                    console.log("--> API Bloqueada.");
                    stopGlobal = true;
                } else {
                    console.log(`--> Fim da lista ou erro: ${erro}`);
                }
                break;
            }

            const contas = json.retorno.contas || [];
            if (contas.length === 0) break;

            // --- MAPEAMENTO EXATO (SCHEMA SQL) ---
            const batch = contas.map((c: any) => {
                const id = String(c.id);
                if (idsProcessados.has(id)) return null;
                idsProcessados.add(id);

                const vDoc = parseFloat(c.valor) || 0;
                const saldo = parseFloat(c.saldo) || 0;
                
                // Competência (MM/AAAA)
                let comp = null;
                if (c.data_vencimento && c.data_vencimento.includes('/')) {
                    const parts = c.data_vencimento.split('/');
                    if (parts.length === 3) comp = `${parts[1]}/${parts[2]}`;
                }

                return {
                    id: id,                                         // id text
                    fornecedor: c.nome_cliente || c.nome_fornecedor || 'Desconhecido', // fornecedor text
                    data_emissao: parseDate(c.data_emissao),        // data_emissao date
                    data_vencimento: parseDate(c.data_vencimento),  // data_vencimento date
                    data_liquidacao: parseDate(c.data_pagamento),   // data_liquidacao date
                    valor_documento: vDoc,                          // valor_documento numeric
                    saldo: saldo,                                   // saldo numeric
                    situacao: c.situacao,                           // situacao text
                    numero_documento: c.numero_doc,                 // numero_documento text
                    historico: c.historico,                         // historico text
                    valor_pago: vDoc - saldo,                       // valor_pago numeric
                    competencia: comp,                              // competencia text
                    ult_atuali: new Date().toISOString()            // ult_atuali timestamp
                };
            }).filter((i: any) => i !== null); // Remove duplicados locais

            if (batch.length > 0) {
                // UPSERT usando 'id' minúsculo
                const { error } = await supabase.from('accounts_payable').upsert(batch, { onConflict: 'id' });
                
                if (error) {
                    console.error(`--> Erro SQL Pág ${pagina}:`, error.message);
                } else {
                    totalSalvo += batch.length;
                    console.log(`--> Salvo: ${batch.length} registros.`);
                }
            }
            pagina++;
        }
    }

    return new Response(
      JSON.stringify({ success: true, count: totalSalvo, message: stopGlobal ? "Parcial (Tempo)" : "Completo" }),
      { 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        } 
      }
    );

  } catch (err: any) {
    console.error("--> ERRO FATAL:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
});