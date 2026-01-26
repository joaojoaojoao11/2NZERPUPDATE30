import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Pausa para não sobrecarregar a API
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// Função de Conversão de Datas (Essencial para não dar erro no Banco)
function converterData(data: any): string | null {
    if (!data || typeof data !== 'string') return null;
    const partes = data.split('/');
    if (partes.length === 3) {
        return `${partes[2]}-${partes[1]}-${partes[0]}`; // YYYY-MM-DD
    }
    return null; 
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = performance.now();

  try {
    const TOKEN_TINY = Deno.env.get('OLIST_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');

    if (!TOKEN_TINY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Configuração de Segredos (API KEYS) incompleta no Supabase.');
    }

    let token = TOKEN_TINY;
    if (token.includes("=")) token = token.split('=').pop()?.trim() || token;
    token = token.trim();

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    console.log(`[START] Iniciando Sincronização Financeira (V3 - Robustez Total)...`);

    let pagina = 1;
    const itemsPorPagina = 50; 
    let stopExecution = false;
    let totalSalvo = 0;
    
    while (!stopExecution) {
        // Timeout de segurança (45s)
        if ((performance.now() - startTime) > 45000) {
            console.log("[TIMEOUT] Tempo limite atingido. Encerrando execução de forma segura.");
            break;
        }

        console.log(`--- Processando Página ${pagina}...`);
        
        const urlBusca = new URL('https://api.tiny.com.br/api2/contas.receber.pesquisa.php');
        urlBusca.searchParams.set('token', token);
        urlBusca.searchParams.set('formato', 'json');
        urlBusca.searchParams.set('limit', String(itemsPorPagina));
        urlBusca.searchParams.set('pagina', String(pagina));

        const resBusca = await fetch(urlBusca.toString());
        const jsonBusca = await resBusca.json();

        // --- CORREÇÃO DO ERRO ---
        if (jsonBusca.retorno.status === 'Erro') {
            // AQUI ESTAVA O ERRO: Forçamos converter para String() para evitar o crash
            const rawErro = jsonBusca.retorno.erros ? jsonBusca.retorno.erros[0]?.erro : '';
            const msgErro = String(rawErro || ''); 

            // Erro 20 ou "não existe" indica apenas que acabaram as páginas
            if (jsonBusca.retorno.codigo_erro == 20 || msgErro.toLowerCase().includes('não existe')) {
                console.log("[INFO] Fim da lista de contas encontrada.");
                stopExecution = true;
                break;
            }
            console.warn(`[TINY WARN] ${msgErro}`);
            stopExecution = true; 
            break;
        }

        const listaContas = jsonBusca.retorno.contas || [];
        if (listaContas.length === 0) {
            stopExecution = true;
            break;
        }

        const allRows: any[] = [];

        for (const conta of listaContas) {
            // Conversão de data segura
            const dataVencCorrigida = converterData(conta.data_vencimento);
            
            // PULA se não tiver data válida (para não quebrar o banco)
            if (!dataVencCorrigida) {
                console.warn(`[SKIP] Conta ${conta.id} ignorada: Data vencimento inválida.`);
                continue; 
            }

            const dataEmissaoCorrigida = converterData(conta.data_emissao);
            const dataLiqCorrigida = converterData(conta.data_pagamento);

            const valorDoc = Number(conta.valor) || 0;
            const saldo = Number(conta.saldo) || 0;
            const recebido = valorDoc - saldo;

            let competencia = null;
            if (conta.data_vencimento && conta.data_vencimento.length >= 7) {
                const partes = conta.data_vencimento.split('/');
                if (partes.length === 3) competencia = `${partes[1]}/${partes[2]}`;
            }

            // Mapeamento EXATO (Case Sensitive)
            allRows.push({
                "ID": String(conta.id),
                "Cliente": conta.nome_cliente || 'Cliente Desconhecido',
                "Data Emissão": dataEmissaoCorrigida,
                "Data Vencimento": dataVencCorrigida,
                "Data Liquidação": dataLiqCorrigida,
                "Valor documento": valorDoc,
                "Saldo": saldo,
                "Situação": conta.situacao,
                "Número documento": conta.numero_doc,
                "Histórico": conta.historico,
                "Competência": competencia,
                "Recebido": recebido,
                "origem": "OLIST", 
                "ult_atuali": new Date().toISOString()
            });
        }

        if (allRows.length > 0) {
            const { error } = await supabase
                .from('accounts_receivable')
                .upsert(allRows, { onConflict: 'ID' });
            
            if (error) {
                console.error(`[DB ERROR] Falha ao salvar página ${pagina}:`, error.message);
                throw new Error(`Erro SQL: ${error.message}`);
            } else {
                totalSalvo += allRows.length;
                console.log(`[SUCCESS] +${allRows.length} contas salvas.`);
            }
        }

        pagina++;
        await delay(200); 
    }

    return new Response(
      JSON.stringify({ 
          message: `Sincronização concluída! Processados: ${totalSalvo}`, 
          upserted_count: totalSalvo
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error("[FATAL ERROR]", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
