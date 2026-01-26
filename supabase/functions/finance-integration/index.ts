import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Reduzi o tempo de espera para evitar Timeout do navegador
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

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
    console.log(`Iniciando Sincronização Financeira (V2 Otimizada)...`);

    let pagina = 1;
    const itemsPorPagina = 50; 
    let stopExecution = false;
    let totalSalvo = 0;
    const allRows: any[] = [];

    while (!stopExecution) {
        // Proteção de tempo: para aos 45s para garantir que responde ao frontend
        if ((performance.now() - startTime) > 45000) {
            console.log("Tempo limite de segurança atingido. Finalizando...");
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

        // Lógica melhorada para detectar o fim da lista
        if (jsonBusca.retorno.status === 'Erro') {
            const msgErro = jsonBusca.retorno.erros[0]?.erro || '';
            
            // Código 20 OU mensagem de página inexistente = Fim normal
            if (jsonBusca.retorno.codigo_erro == 20 || msgErro.toLowerCase().includes('não existe')) {
                console.log("Fim da lista de contas.");
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
            const dataVenc = conta.data_vencimento;
            const dataEmissao = conta.data_emissao;
            const dataPagamento = conta.data_pagamento || null;
            const valorDoc = Number(conta.valor);
            const saldo = Number(conta.saldo);
            const recebido = valorDoc - saldo;

            let competencia = null;
            if (dataVenc && dataVenc.length >= 7) {
                competencia = dataVenc.substring(0, 7);
            }

            // Mapeamento usando chaves em MINÚSCULO (snake_case)
            // Se o seu banco usa "ID" (maiúsculo), o Supabase geralmente aceita minúsculo se não houver aspas na criação.
            // Se isso falhar, teremos que confirmar o nome exato das colunas no seu Table Editor.
            allRows.push({
                id: String(conta.id),
                cliente: conta.nome_cliente || 'Cliente Desconhecido',
                data_emissao: dataEmissao,
                data_vencimento: dataVenc,
                data_liquidacao: dataPagamento,
                valor_documento: valorDoc,
                saldo: saldo,
                situacao: conta.situacao,
                numero_documento: conta.numero_doc,
                historico: conta.historico,
                competencia: competencia,
                origem: "OLIST", 
                valor_recebido: recebido, // Ajustado para bater com seu frontend (valor_recebido)
                ult_atuali: new Date().toISOString()
            });
        }

        if (allRows.length > 0) {
            // Tenta salvar usando id minúsculo
            const { error } = await supabase
                .from('accounts_receivable')
                .upsert(allRows, { onConflict: 'id' }); // 'id' minúsculo
            
            if (error) {
                console.error("Erro ao salvar lote (Tentativa 1):", error.message);
                // Se der erro, tenta com ID Maiúsculo (caso o banco seja Case Sensitive)
                if (error.message.includes('column') || error.message.includes('relation')) {
                     console.log("Tentando salvar com chaves Maiúsculas...");
                     const rowsUpper = allRows.map(r => ({
                        "ID": r.id,
                        "Cliente": r.cliente,
                        "Data Emissão": r.data_emissao,
                        "Data Vencimento": r.data_vencimento,
                        "Data Liquidação": r.data_liquidacao,
                        "Valor documento": r.valor_documento,
                        "Saldo": r.saldo,
                        "Situação": r.situacao,
                        "Número documento": r.numero_documento,
                        "Histórico": r.historico,
                        "Competência": r.competencia,
                        "origem": r.origem,
                        "Recebido": r.valor_recebido
                     }));
                     const { error: error2 } = await supabase
                        .from('accounts_receivable')
                        .upsert(rowsUpper, { onConflict: 'ID' });
                     
                     if (error2) console.error("Erro final ao salvar:", error2.message);
                     else totalSalvo += allRows.length;
                }
            } else {
                totalSalvo += allRows.length;
            }
            allRows.length = 0;
        }

        pagina++;
        await delay(200); // 200ms é suficiente
    }

    return new Response(
      JSON.stringify({ 
          message: `Sincronização OK! Registros processados: ${totalSalvo}`, 
          upserted_count: totalSalvo
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error("ERRO CRÍTICO:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
