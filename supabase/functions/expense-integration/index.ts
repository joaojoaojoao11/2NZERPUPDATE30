import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TINY_TOKEN = "df0900959326f5540306233267d345c267a32900"; 
const TIME_LIMIT_MS = 55000;
const PAUSA_ENTRE_DETALHES = 800;

serve(async (req) => {
  // Preflight request handler
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Configuração do Supabase ausente (URL ou Key).");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log(">>> SYNC INICIADO: MODO ROBUSTO <<<");

    // Datas
    const hoje = new Date();
    const dataInicio = new Date();
    dataInicio.setDate(hoje.getDate() - 60); 
    const dataFim = new Date();
    dataFim.setDate(hoje.getDate() + 120);

    const dataIniStr = dataInicio.toISOString().split('T')[0].split('-').reverse().join('/');
    const dataFimStr = dataFim.toISOString().split('T')[0].split('-').reverse().join('/');

    let pagina = 1;
    let totalProcessado = 0;
    let continuar = true;

    while (continuar) {
      if (Date.now() - startTime > TIME_LIMIT_MS) break;

      // 1. URL da API (Verifique se não há espaços extras)
      const urlPesquisa = `https://api.tiny.com.br/api2/contas.pagar.pesquisa.php?token=${TINY_TOKEN}&data_inicial_vencimento=${dataIniStr}&data_final_vencimento=${dataFimStr}&pagina=${pagina}&formato=json`;
      
      console.log(`Buscando URL: ${urlPesquisa.replace(TINY_TOKEN, '***')}`);

      const resp = await fetch(urlPesquisa);
      
      // Checagem de Erro de Rede/API
      if (!resp.ok) {
        throw new Error(`Erro HTTP Tiny: ${resp.status} - ${resp.statusText}`);
      }

      // Leitura Segura do JSON
      const textResponse = await resp.text();
      let json;
      try {
        json = JSON.parse(textResponse);
      } catch (e) {
        console.error("Resposta não é JSON:", textResponse);
        throw new Error(`Tiny retornou resposta inválida: ${textResponse.substring(0, 100)}...`);
      }

      // Validação da Resposta do Tiny
      if (json.retorno.status !== 'OK') {
        if (json.retorno.codigo_erro === '20') { // Nenhum registro encontrado
             console.log("Fim da paginação (código 20).");
             continuar = false;
             break;
        }
        // Se houver erro real, loga mas não quebra se for apenas "sem dados"
        if (!json.retorno.contas) {
            continuar = false;
            break;
        }
      }

      const listaContas = json.retorno.contas || [];
      console.log(`Página ${pagina}: ${listaContas.length} itens.`);

      if (listaContas.length === 0) {
        continuar = false;
        break;
      }

      // Processamento
      for (const itemWrapper of listaContas) {
        const itemBasico = itemWrapper.conta;
        
        if (Date.now() - startTime > TIME_LIMIT_MS) {
          continuar = false;
          break;
        }

        await new Promise(r => setTimeout(r, PAUSA_ENTRE_DETALHES));

        // Detalhes (Try-catch isolado para não parar o loop)
        let dadosDetalhados = {};
        try {
            const urlDetalhe = `https://api.tiny.com.br/api2/conta.pagar.obter.php?token=${TINY_TOKEN}&id=${itemBasico.id}&formato=json`;
            const respDet = await fetch(urlDetalhe);
            const textDet = await respDet.text();
            const jsonDet = JSON.parse(textDet);
            
            if (jsonDet.retorno.status === 'OK' && jsonDet.retorno.conta) {
                dadosDetalhados = jsonDet.retorno.conta;
            }
        } catch (err) {
            console.warn(`Aviso: Falha ao buscar detalhes ID ${itemBasico.id}`, err);
        }

        const final = { ...itemBasico, ...dadosDetalhados };

        // Normalização
        const valorDoc = parseFloat(final.valor || 0);
        const valorPago = parseFloat(final.valor_pago || 0);
        const saldo = parseFloat(final.saldo || (valorDoc - valorPago));
        
        let situacaoReal = final.situacao;
        // Lógica de Status
        if (Math.abs(saldo) < 0.05) situacaoReal = "LIQUIDADO";
        else if (situacaoReal === 'Aberto' && final.data_vencimento) {
             const venc = final.data_vencimento.split('/').reverse().join('-');
             if (new Date(venc) < new Date()) situacaoReal = "ATRASADO";
        }

        const nomeFornecedor = final.nome_fornecedor || final.cliente?.nome || itemBasico.nome_fornecedor || "Fornecedor Não Identificado";

        const contaPayload = {
          id: final.id.toString(),
          fornecedor: nomeFornecedor,
          data_emissao: final.data_emissao ? final.data_emissao.split('/').reverse().join('-') : null,
          data_vencimento: final.data_vencimento ? final.data_vencimento.split('/').reverse().join('-') : null,
          data_liquidacao: final.data_pagamento ? final.data_pagamento.split('/').reverse().join('-') : null,
          valor_documento: valorDoc,
          valor_pago: valorPago,
          saldo: saldo,
          situacao: situacaoReal,
          numero_documento: final.nro_documento || "",
          competencia: final.data_competencia || "",
          historico: final.historico || `Conta ${final.id}`,
          categoria: final.categoria || final.classe_financeira || "Despesa Geral",
          forma_pagamento: final.forma_pagamento || "Boleto",
          updated_at: new Date().toISOString()
        };

        const { error } = await supabase
          .from('accounts_payable')
          .upsert(contaPayload, { onConflict: 'id' });

        if (error) {
            console.error(`Erro BD ID ${final.id}:`, error.message);
        } else {
            totalProcessado++;
        }
      }
      pagina++;
    }

    return new Response(
      JSON.stringify({ message: "Sync Finalizado", count: totalProcessado }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error("ERRO CRÍTICO NA FUNCTION:", err);
    // Retorna erro formatado para o front-end não ficar "cego"
    return new Response(
      JSON.stringify({ error: err.message, detail: "Verifique os logs do Supabase" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});