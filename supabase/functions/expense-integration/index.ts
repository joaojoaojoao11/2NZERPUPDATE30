import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// --- CONFIGURAÇÕES ---
const TIME_LIMIT_MS = 45000; // 45 segundos (limite de segurança antes do Supabase cortar)
const PAUSA_API = 1000;      // 1 segundo entre chamadas para respeitar o rate-limit do Tiny

// --- FUNÇÃO AUXILIAR DE DATA ---
function parseDate(dateStr: string | null): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  try {
    const clean = dateStr.split(' ')[0].trim();
    let y, m, d;
    // Formato DD/MM/AAAA
    if (clean.includes('/')) {
        [d, m, y] = clean.split('/');
    } 
    // Formato AAAA-MM-DD
    else if (clean.includes('-')) {
        [y, m, d] = clean.split('-');
    } 
    else {
        return null;
    }
    return `${y}-${m}-${d}`;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  // 1. Configuração CORS (Permite que seu frontend chame esta função)
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
      },
    });
  }

  const startTime = performance.now();
  console.log('--> [ExpenseSync] Iniciando Sincronização de Contas a Pagar...');

  try {
    // 2. Credenciais
    const TOKEN = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY');
    const SB_URL = Deno.env.get('SUPABASE_URL');
    const SB_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TOKEN || !SB_URL || !SB_KEY) throw new Error('Configuração incompleta: Verifique as variáveis de ambiente (TINY_TOKEN, SUPABASE_URL, SERVICE_ROLE_KEY).');

    // Limpa o token se vier no formato "token=123..."
    let cleanToken = TOKEN.includes('=') ? TOKEN.split('=').pop()?.trim() || TOKEN : TOKEN;
    cleanToken = cleanToken.trim();

    const supabase = createClient(SB_URL, SB_KEY);

    // 3. Estratégia de Busca (Prioridade: Futuro -> Passado)
    const periodos = [
      { ini: '01/01/2026', fim: '31/12/2026' },
      { ini: '01/01/2025', fim: '31/12/2025' },
    ];

    let totalSalvo = 0;
    let stopGlobal = false;
    const idsProcessados = new Set<string>(); // Evita duplicidade na mesma execução

    for (const p of periodos) {
      if (stopGlobal) break;
      let pagina = 1;

      while (true) {
        // --- CHECK DE SEGURANÇA DE TEMPO ---
        if (performance.now() - startTime > TIME_LIMIT_MS) {
          console.log(`--> [ExpenseSync] Tempo limite atingido. Encerrando execução.`);
          stopGlobal = true;
          break;
        }

        console.log(`--> Buscando período ${p.ini} - Pág ${pagina}...`);
        
        // Pausa para não bloquear a API do Tiny
        await new Promise((r) => setTimeout(r, PAUSA_API));

        const url = new URL('https://api.tiny.com.br/api2/contas.pagar.pesquisa.php');
        url.searchParams.set('token', cleanToken);
        url.searchParams.set('formato', 'json');
        url.searchParams.set('limit', '100');
        url.searchParams.set('pagina', String(pagina));
        url.searchParams.set('data_ini_emissao', p.ini);
        url.searchParams.set('data_fim_emissao', p.fim);

        const res = await fetch(url.toString());
        const json = await res.json();

        // Verifica erros da API
        if (json.retorno.status === 'Erro') {
          const erroMsg = json.retorno.erros?.[0]?.erro || 'Erro desconhecido';
          
          if (erroMsg.includes('Bloqueada') || erroMsg.includes('Excedido')) {
            console.error('--> API Bloqueada pelo Tiny (Too Many Requests).');
            stopGlobal = true;
          } else if (erroMsg.toLowerCase().includes('não foram encontrados') || json.retorno.codigo_erro == 20) {
             console.log(`--> Fim dos registros para ${p.ini}.`);
          } else {
             console.warn(`--> Erro na API: ${erroMsg}`);
          }
          break; // Sai do loop de páginas e vai para o próximo período
        }

        const contas = json.retorno.contas || [];
        if (contas.length === 0) break;

        // 4. Mapeamento para o Schema do Banco (accounts_payable)
        const batch = contas.map((c: any) => {
            const idStr = String(c.id);
            
            // Se já processamos esse ID hoje, ignora
            if (idsProcessados.has(idStr)) return null;
            idsProcessados.add(idStr);

            const vDoc = parseFloat(c.valor) || 0;
            const saldo = parseFloat(c.saldo) || 0;
            const vPago = vDoc - saldo;

            // Tratamento da Competência (MM/AAAA) baseado no vencimento
            let comp = null;
            if (c.data_vencimento && c.data_vencimento.includes('/')) {
              const parts = c.data_vencimento.split('/');
              if (parts.length === 3) comp = `${parts[1]}/${parts[2]}`;
            }

            // Objeto que corresponde examente às colunas da sua tabela
            return {
              id: idStr,
              fornecedor: c.nome_cliente || c.nome_fornecedor || 'Desconhecido',
              data_emissao: parseDate(c.data_emissao),
              data_vencimento: parseDate(c.data_vencimento),
              data_liquidacao: parseDate(c.data_pagamento), // No Tiny, data_pagamento é a liquidação
              valor_documento: vDoc,
              saldo: saldo,
              situacao: c.situacao, // Aberto, Pago, Parcialmente Pago
              numero_documento: c.numero_doc,
              categoria: c.categoria || null, // Nem sempre vem na pesquisa simples
              historico: c.historico,
              valor_pago: vPago,
              competencia: comp,
              forma_pagamento: c.forma_pagamento || null, // Nem sempre vem na pesquisa simples
              chave_pix_boleto: null, // Campo específico não retornado na lista padrão
              ult_atuali: new Date().toISOString(),
            };
          })
          .filter((i: any) => i !== null);

        // 5. Salvar no Banco (Upsert)
        if (batch.length > 0) {
          const { error } = await supabase
            .from('accounts_payable')
            .upsert(batch, { onConflict: 'id' });

          if (error) {
            console.error(`--> Erro ao salvar Pág ${pagina}:`, error.message);
          } else {
            totalSalvo += batch.length;
            console.log(`--> Salvo: ${batch.length} contas.`);
          }
        }

        pagina++;
      }
    }

    // 6. Resposta Final para o Frontend
    return new Response(
      JSON.stringify({
        success: true,
        count: totalSalvo,
        message: stopGlobal ? 'Sincronização Parcial (Limite de Tempo)' : 'Sincronização Completa',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
        },
      }
    );

  } catch (err: any) {
    console.error('--> ERRO FATAL:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
      },
    });
  }
});