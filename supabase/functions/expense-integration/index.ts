import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const TIME_LIMIT_MS = 55000;
const PAUSA_API = 4000;

function parseDate(dateStr: string | null): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  try {
    const clean = dateStr.split(' ')[0].trim();
    let y, m, d;
    if (clean.includes('/')) {
        [d, m, y] = clean.split('/');
    } else if (clean.includes('-')) {
        [y, m, d] = clean.split('-');
    } else {
        return null;
    }
    return `${y}-${m}-${d}`;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
      },
    });
  }

  const startTime = performance.now();
  console.log('--> [ExpenseSync] Iniciando (Correção de Estrutura JSON)...');

  try {
    const TOKEN = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY');
    const SB_URL = Deno.env.get('SUPABASE_URL');
    const SB_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TOKEN || !SB_URL || !SB_KEY) throw new Error('Configuração incompleta.');

    let cleanToken = TOKEN.includes('=') ? TOKEN.split('=').pop()?.trim() || TOKEN : TOKEN;
    cleanToken = cleanToken.trim();

    const supabase = createClient(SB_URL, SB_KEY);

    const periodos = [
      { ini: '01/01/2026', fim: '31/12/2026' },
      { ini: '01/01/2025', fim: '31/12/2025' },
    ];

    let totalSalvo = 0;
    let stopGlobal = false;
    const idsProcessados = new Set<string>();

    for (const p of periodos) {
      if (stopGlobal) break;
      let pagina = 1;

      while (true) {
        if (performance.now() - startTime > TIME_LIMIT_MS) {
          console.log(`--> Tempo limite atingido.`);
          stopGlobal = true;
          break;
        }

        console.log(`--> Buscando ${p.ini} - Pág ${pagina}...`);
        await new Promise((r) => setTimeout(r, PAUSA_API));

        const url = new URL('https://api.tiny.com.br/api2/contas.pagar.pesquisa.php');
        url.searchParams.set('token', cleanToken);
        url.searchParams.set('formato', 'json');
        url.searchParams.set('limit', '50');
        url.searchParams.set('pagina', String(pagina));
        url.searchParams.set('data_ini_emissao', p.ini);
        url.searchParams.set('data_fim_emissao', p.fim);

        const res = await fetch(url.toString());
        const json = await res.json();

        if (json.retorno.status === 'Erro') {
          const erroMsg = json.retorno.erros?.[0]?.erro || '';
          if (erroMsg.includes('Bloqueada') || erroMsg.includes('Excedido')) {
            console.error('--> BLOQUEIO TINY.');
            stopGlobal = true;
          } else if (json.retorno.codigo_erro == 20 || erroMsg.toLowerCase().includes('não existe') || erroMsg.includes('não foram encontrados')) {
             console.log(`--> Fim dos registros para ${p.ini}.`);
          }
          break;
        }

        const rawList = json.retorno.contas || [];
        if (rawList.length === 0) break;

        const batch = rawList.map((itemRaw: any) => {
            // CORREÇÃO CRÍTICA: O Tiny retorna { conta: { ... } }
            // Aqui pegamos o objeto interno se existir, ou o próprio item.
            const conta = itemRaw.conta || itemRaw;

            const idStr = String(conta.id);
            if (idsProcessados.has(idStr)) return null;
            idsProcessados.add(idStr);

            const vDoc = parseFloat(conta.valor) || 0;
            const saldo = parseFloat(conta.saldo) || 0;
            const vPago = vDoc - saldo;

            const dataVencParsed = parseDate(conta.data_vencimento);
            const dataEmissaoParsed = parseDate(conta.data_emissao);
            
            // Fallback inteligente para data
            const dataVencFinal = dataVencParsed || dataEmissaoParsed || new Date().toISOString().split('T')[0];

            let comp = null;
            if (conta.data_vencimento && conta.data_vencimento.includes('/')) {
              const parts = conta.data_vencimento.split('/');
              if (parts.length === 3) comp = `${parts[1]}/${parts[2]}`;
            }

            return {
              id: idStr,
              fornecedor: conta.nome_cliente || conta.nome_fornecedor || 'Desconhecido',
              data_emissao: dataEmissaoParsed,
              data_vencimento: dataVencFinal,
              data_liquidacao: parseDate(conta.data_pagamento),
              valor_documento: vDoc,
              saldo: saldo,
              situacao: conta.situacao,
              numero_documento: conta.numero_doc,
              categoria: conta.categoria || null,
              historico: conta.historico,
              valor_pago: vPago,
              competencia: comp,
              forma_pagamento: conta.forma_pagamento || null,
              ult_atuali: new Date().toISOString(),
            };
          })
          .filter((i: any) => i !== null);

        if (batch.length > 0) {
          const { error } = await supabase
            .from('accounts_payable')
            .upsert(batch, { onConflict: 'id' });

          if (error) {
            console.error(`--> Erro SQL Pág ${pagina}:`, error.message);
          } else {
            totalSalvo += batch.length;
            console.log(`--> Salvo: ${batch.length} contas.`);
          }
        }

        pagina++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        count: totalSalvo,
        message: 'Sincronização Finalizada',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('--> ERRO FATAL:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 400 });
  }
});