import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// --- FUNÇÃO DE CORREÇÃO DE DATA (CRUCIAL) ---
// Transforma 25/01/2025 em 2025-01-25 para o Banco aceitar
function converterData(data: any): string | null {
    if (!data || typeof data !== 'string') return null;
    const partes = data.split('/');
    if (partes.length === 3) {
        return `${partes[2]}-${partes[1]}-${partes[0]}`; // Retorna YYYY-MM-DD
    }
    return null; 
}

Deno.serve(async (req) => {
  const startTime = performance.now();

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const TOKEN_TINY = Deno.env.get('OLIST_API_KEY') || ""; 
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');

    if (!TOKEN_TINY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Configuração incompleta nos Secrets.');
    }

    let token = TOKEN_TINY;
    if (TOKEN_TINY.includes("=")) {
        token = TOKEN_TINY.split('=').pop()?.trim() || token;
    }
    token = token.trim();

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    console.log(`Iniciando Sincronização Financeira (Com Correção de Datas)...`);

    let pagina = 1;
    const itemsPorPagina = 50; 
    let stopExecution = false;
    let totalSalvo = 0;
    const allRows: any[] = [];

    while (!stopExecution) {
        if ((performance.now() - startTime) > 45000) {
            console.log("Tempo limite atingido.");
            break;
        }

        console.log(`--- Buscando Página ${pagina}...`);
        
        const urlBusca = new URL('https://api.tiny.com.br/api2/contas.receber.pesquisa.php');
        urlBusca.searchParams.set('token', token);
        urlBusca.searchParams.set('formato', 'json');
        urlBusca.searchParams.set('limit', String(itemsPorPagina));
        urlBusca.searchParams.set('pagina', String(pagina));

        const resBusca = await fetch(urlBusca.toString());
        const jsonBusca = await resBusca.json();

        if (jsonBusca.retorno.status === 'Erro') {
            const msgErro = jsonBusca.retorno.erros[0]?.erro || '';
            if (jsonBusca.retorno.codigo_erro == 20 || msgErro.toLowerCase().includes('não existe')) {
                console.log("Fim da lista.");
                stopExecution = true;
                break;
            }
            console.warn(`Aviso Tiny: ${msgErro}`);
            stopExecution = true;
            break;
        }

        const listaContas = jsonBusca.retorno.contas || [];
        if (listaContas.length === 0) {
            stopExecution = true;
            break;
        }

        for (const conta of listaContas) {
            // Converte valores monetários com segurança
            const valorDoc = Number(conta.valor) || 0;
            const saldo = Number(conta.saldo) || 0;
            const recebido = valorDoc - saldo;

            // Extrai a competência (Mês/Ano) da data de vencimento corrigida
            const dataVenc = conta.data_vencimento; 
            let competencia = null;
            if (dataVenc && dataVenc.length >= 7) {
                // Se vier 25/01/2025, pega 01/2025 ou similar
                const partes = dataVenc.split('/');
                if (partes.length === 3) competencia = `${partes[1]}/${partes[2]}`;
            }

            // --- MAPEAMENTO BLINDADO ---
            // Usa nomes exatos das colunas e converte as datas
            allRows.push({
                "ID": String(conta.id),
                "Cliente": conta.nome_cliente || 'Cliente Desconhecido',
                "Data Emissão": converterData(conta.data_emissao),
                "Data Vencimento": converterData(conta.data_vencimento), // Correção aqui!
                "Data Liquidação": converterData(conta.data_pagamento),  // Correção aqui!
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
            // Tenta salvar no banco
            const { error } = await supabase
                .from('accounts_receivable')
                .upsert(allRows, { onConflict: 'ID' });
            
            if (error) {
                // Se der erro, mostramos exatamente o porquê no log
                console.error("ERRO AO SALVAR NO BANCO:", error.message);
                throw new Error(`Falha ao gravar no banco: ${error.message}`);
            } else {
                totalSalvo += allRows.length;
            }
            allRows.length = 0;
        }

        pagina++;
        await delay(200); 
    }

    return new Response(
      JSON.stringify({ 
          message: `Sincronização OK! Atualizados: ${totalSalvo}`, 
          upserted_count: totalSalvo
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error("ERRO FATAL NA FUNÇÃO:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
