import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    console.log(`Iniciando Sincronização Financeira (Modo Compatibilidade Estrita)...`);

    let pagina = 1;
    const itemsPorPagina = 50; 
    let stopExecution = false;
    let totalSalvo = 0;
    const allRows: any[] = [];

    while (!stopExecution) {
        // Proteção de tempo: 45s
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

        // Tratamento de Erros / Fim da Lista
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

            // --- MAPEAMENTO EXATO COM O BANCO DE DADOS ---
            // As chaves aqui devem ser IGUAIS às colunas do PostgreSQL (Case Sensitive)
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
                "Recebido": recebido, // Coluna "Recebido"
                
                // Campos mistos (alguns minúsculos no seu banco)
                "origem": "OLIST", 
                "ult_atuali": new Date().toISOString()
            });
        }

        if (allRows.length > 0) {
            const { error } = await supabase
                .from('accounts_receivable')
                .upsert(allRows, { onConflict: 'ID' }); // A chave primária é "ID" maiúsculo
            
            if (error) {
                console.error("Erro ao salvar no banco:", error.message);
                throw error; // Lança o erro para o frontend saber
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
    console.error("ERRO FATAL:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
