import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

Deno.serve(async (req) => {
  const startTime = performance.now();

  // 1. Permite que o botão no site funcione (CORS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Acesso às chaves secretas
    const TOKEN_TINY = Deno.env.get('OLIST_API_KEY') || ""; 
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');

    if (!TOKEN_TINY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Configuração incompleta nos Secrets (OLIST_API_KEY).');
    }

    let token = TOKEN_TINY;
    if (TOKEN_TINY.includes("=")) {
        token = TOKEN_TINY.split('=').pop()?.trim() || token;
    }
    token = token.trim();

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    console.log(`Iniciando Sincronização Financeira...`);

    let pagina = 1;
    const itemsPorPagina = 50; // Busca em lotes maiores
    let stopExecution = false;
    let totalSalvo = 0;
    const allRows: any[] = [];

    // 3. Loop para buscar todas as páginas do Tiny
    while (!stopExecution) {
        // Proteção de tempo (evita timeout do servidor)
        if ((performance.now() - startTime) > 50000) {
            console.log("Tempo limite atingido. Salvando parcial.");
            break;
        }

        console.log(`--- Buscando Contas Página ${pagina}...`);
        
        const urlBusca = new URL('https://api.tiny.com.br/api2/contas.receber.pesquisa.php');
        urlBusca.searchParams.set('token', token);
        urlBusca.searchParams.set('formato', 'json');
        urlBusca.searchParams.set('limit', String(itemsPorPagina));
        urlBusca.searchParams.set('pagina', String(pagina));

        const resBusca = await fetch(urlBusca.toString());
        const jsonBusca = await resBusca.json();

        // Verifica erros ou fim da lista
        if (jsonBusca.retorno.status === 'Erro') {
            if (jsonBusca.retorno.codigo_erro == 20) {
                stopExecution = true; // Fim da lista
                break;
            }
            console.warn(`Aviso Tiny: ${jsonBusca.retorno.erros[0].erro}`);
            stopExecution = true;
            break;
        }

        const listaContas = jsonBusca.retorno.contas || [];
        if (listaContas.length === 0) {
            stopExecution = true;
            break;
        }

        // 4. Processamento dos Dados
        for (const conta of listaContas) {
            // Tratamento de datas e valores
            const dataVenc = conta.data_vencimento;
            const dataEmissao = conta.data_emissao;
            const dataPagamento = conta.data_pagamento || null;
            const valorDoc = Number(conta.valor);
            const saldo = Number(conta.saldo);
            const recebido = valorDoc - saldo;

            let competencia = null;
            if (dataVenc && dataVenc.length >= 7) {
                competencia = dataVenc.substring(0, 7); // Ex: "2024-01"
            }

            // Preparação do objeto para salvar
            // IMPORTANTE: Só mapeamos campos do Tiny. Campos como 'status_cartorio' não são tocados.
            allRows.push({
                "ID": String(conta.id),
                "Cliente": conta.nome_cliente || 'Cliente Desconhecido',
                "Data Emissão": dataEmissao,
                "Data Vencimento": dataVenc,
                "Data Liquidação": dataPagamento,
                "Valor documento": valorDoc,
                "Saldo": saldo,
                "Situação": conta.situacao,
                "Número documento": conta.numero_doc,
                "Histórico": conta.historico,
                "Competência": competencia,
                "origem": "OLIST", 
                "Recebido": recebido,
                "ult_atuali": new Date().toISOString()
            });
        }

        // 5. Salvar no Banco (Upsert)
        if (allRows.length > 0) {
            const { error } = await supabase
                .from('accounts_receivable')
                .upsert(allRows, { onConflict: 'ID' });
            
            if (error) {
                console.error("Erro ao salvar lote:", error);
            } else {
                totalSalvo += allRows.length;
            }
            allRows.length = 0; // Limpa memória
        }

        pagina++;
        await delay(800); // Pausa para não bloquear a API
    }

    return new Response(
      JSON.stringify({ 
          message: `Sincronização Financeira OK! Atualizados: ${totalSalvo}`, 
          upserted_count: totalSalvo
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error("ERRO FATAL:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
