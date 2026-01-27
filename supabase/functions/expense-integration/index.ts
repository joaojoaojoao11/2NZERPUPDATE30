import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configurações
const TINY_TOKEN = "df0900959326f5540306233267d345c267a32900"; 
const TIME_LIMIT_MS = 55000; // 55s limite
const PAUSA_ENTRE_DETALHES = 800; // Delay para evitar bloqueio

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(">>> INICIANDO SYNC (MODO ID CORRIGIDO) <<<");

    // 1. Período de Busca (Ampliado para garantir)
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

      // 2. Busca Listagem Resumida
      const urlPesquisa = `https://api.tiny.com.br/api2/conta.pagar.pesquisa.php?token=${TINY_TOKEN}&data_inicial_vencimento=${dataIniStr}&data_final_vencimento=${dataFimStr}&pagina=${pagina}&formato=json`;
      const resp = await fetch(urlPesquisa);
      const json = await resp.json();

      if (json.retorno.status !== 'OK' || !json.retorno.contas) {
        continuar = false;
        break;
      }

      const listaContas = json.retorno.contas;
      console.log(`Página ${pagina}: Processando ${listaContas.length} itens...`);

      // 3. Processamento Item a Item
      for (const itemWrapper of listaContas) {
        const itemBasico = itemWrapper.conta;
        
        if (Date.now() - startTime > TIME_LIMIT_MS) {
          continuar = false;
          break;
        }

        // Delay anti-bloqueio
        await new Promise(r => setTimeout(r, PAUSA_ENTRE_DETALHES));

        // 4. Busca Detalhes (Pente Fino)
        let dadosDetalhados = {};
        try {
            const urlDetalhe = `https://api.tiny.com.br/api2/conta.pagar.obter.php?token=${TINY_TOKEN}&id=${itemBasico.id}&formato=json`;
            const respDet = await fetch(urlDetalhe);
            const jsonDet = await respDet.json();
            if (jsonDet.retorno.status === 'OK' && jsonDet.retorno.conta) {
                dadosDetalhados = jsonDet.retorno.conta;
            }
        } catch (err) {
            console.error(`Erro ao buscar detalhe ${itemBasico.id}`, err);
        }

        // Mescla: O que vier no detalhe sobrescreve o básico
        const final = { ...itemBasico, ...dadosDetalhados };

        // 5. Tratamento de Valores e Status
        const valorDoc = parseFloat(final.valor || 0);
        const valorPago = parseFloat(final.valor_pago || 0);
        const saldo = parseFloat(final.saldo || (valorDoc - valorPago));
        
        // Status Inteligente (Corrige erros do Tiny)
        let situacaoReal = final.situacao;
        if (Math.abs(saldo) < 0.05) situacaoReal = "LIQUIDADO"; // Se deve centavos, considera pago
        else if (situacaoReal === 'Aberto' && final.data_vencimento) {
             const venc = final.data_vencimento.split('/').reverse().join('-');
             if (new Date(venc) < new Date()) situacaoReal = "ATRASADO";
        }

        // Fornecedor: Tenta de todas as formas
        const nomeFornecedor = final.nome_fornecedor || final.cliente?.nome || itemBasico.nome_fornecedor || "Fornecedor Não Identificado";

        // 6. Objeto para o Banco
        const contaPayload = {
          id: final.id.toString(), // AGORA O BANCO ACEITA ISSO COMO CHAVE ÚNICA
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

        // 7. Salvar (UPSERT)
        // Agora sim: Se o ID "389677613" já existe, ele ATUALIZA. Não cria novo.
        const { error } = await supabase
          .from('accounts_payable')
          .upsert(contaPayload, { onConflict: 'id' });

        if (error) console.error(`Erro BD ${final.id}:`, error);
        else totalProcessado++;
      }
      pagina++;
    }

    return new Response(
      JSON.stringify({ message: "Sync Sucesso", count: totalProcessado }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});