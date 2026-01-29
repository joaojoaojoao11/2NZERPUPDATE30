import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TINY_TOKEN = "54ba8ea7422b4e6f4264dc2ed007f48498ec8f973b499fe3694f225573d290e0";

// --- NOVA FUNÇÃO SEGURA PARA DATA DE LIQUIDAÇÃO (Espelhado de expense-integration) ---
function safeDate(raw: any): string | null {
  // Tenta pegar data_pagamento OU data_baixa se vier um objeto, ou usa o proprio valor se for string
  // Mas no enricher o 'raw' passado ja é o valor escolhido. 
  // Vamos manter a assinatura mas melhorar a logica interna com base na integration.

  if (!raw || typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const parts = raw.split('/');
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  } catch (e) { return null; }
  return null;
}

serve(async (req) => {
  // 1. Resposta imediata para o Preflight do Navegador (Resolve o erro de CORS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. BUSCA DINÂMICA DOS SECRETS (Pega o que você cadastrou no painel)
    // Atualizado para usar token fixo conforme expense-integration
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = (Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) || '';

    // Validacao simplificada
    if (!supabaseKey) throw new Error("SERVICE_ROLE_KEY (ou SUPABASE_SERVICE_ROLE_KEY) não configurada.");

    const supabase = createClient(supabaseUrl, supabaseKey);
    const PAUSA_ENTRE_REQUISICOES = 1000;
    const LIMITE_POR_EXECUCAO = 20;

    console.log(">>> EXPENSE ENRICHER: Iniciando ciclo...");

    // 3. Busca contas pagas sem data de liquidação
    const { data: incompletos, error } = await supabase
      .from('accounts_payable')
      .select('id, fornecedor')
      .or('situacao.ilike.pago,situacao.ilike.liquidado,situacao.ilike.baixado')
      .is('data_liquidacao', null)
      .limit(LIMITE_POR_EXECUCAO);

    if (error) throw error;

    if (!incompletos || incompletos.length === 0) {
      return new Response(JSON.stringify({ message: "Nada pendente.", corrigidos: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

    let corrigidos = 0;

    for (const item of incompletos) {
      await new Promise(r => setTimeout(r, PAUSA_ENTRE_REQUISICOES));

      try {
        const url = `https://api.tiny.com.br/api2/conta.pagar.obter.php?token=${TINY_TOKEN}&id=${item.id}&formato=json`;
        const resp = await fetch(url);
        const json = await resp.json();

        if (json.retorno.status === 'OK') {
          const det = json.retorno.conta;
          console.log(`[DEBUG ID ${item.id}] Dados Brutos Tiny:`, JSON.stringify(det)); // LOG 1: O que veio do Tiny?

          // CORRECAO: O Tiny retorna 'liquidacao' neste endpoint, nao 'data_pagamento'
          const dataLiq = det.liquidacao || det.data_pagamento || det.data_baixa;
          const dataFormatada = safeDate(dataLiq);
          console.log(`[DEBUG ID ${item.id}] Data Liq Raw: "${dataLiq}" -> Formatada: "${dataFormatada}"`); // LOG 2: A data funcionou?

          const updatePayload: any = {
            ult_atuali: new Date().toISOString()
          };

          if (dataFormatada) updatePayload.data_liquidacao = dataFormatada;

          // CORRECAO: O Tiny retorna 'competencia' direto
          if (det.competencia || det.data_competencia) updatePayload.competencia = det.competencia || det.data_competencia;

          // CORRECAO: O Tiny retorna 'categoria'
          if (det.categoria) updatePayload.categoria = det.categoria;

          // Correção potencial para forma de pagamento que as vezes vem como forma_pagamento ou meiopagamento
          if (det.forma_pagamento) updatePayload.forma_pagamento = det.forma_pagamento;

          if (det.linha_digitavel || det.codigo_barras) updatePayload.chave_pix_boleto = det.linha_digitavel || det.codigo_barras;

          if (item.fornecedor === 'Desconhecido') {
            if (det.cliente?.nome) updatePayload.fornecedor = det.cliente.nome;
            else if (det.nome_cliente) updatePayload.fornecedor = det.nome_cliente;
          }

          console.log(`[DEBUG ID ${item.id}] Payload Final:`, JSON.stringify(updatePayload)); // LOG 3: O que vamos salvar?

          const { error: errUpdate } = await supabase.from('accounts_payable').update(updatePayload).eq('id', item.id);
          if (errUpdate) console.error(`[ERRO UPDATE ${item.id}]`, errUpdate);
          else corrigidos++;
        }
      } catch (err) {
        console.error(`Erro no ID ${item.id}:`, err);
      }
    }

    return new Response(JSON.stringify({ message: "Concluído", corrigidos }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
