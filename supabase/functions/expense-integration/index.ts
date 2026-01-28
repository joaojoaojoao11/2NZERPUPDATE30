import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TINY_TOKEN = "df0900959326f5540306233267d345c267a32900"; 
const TIME_LIMIT_MS = 50000; // Limite de 50s para segurança
const PAUSA_ENTRE_DETALHES = 800; // Milissegundos entre chamadas para não ser bloqueado pelo Tiny

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(">>> SYNC INICIADO: MODO SINGULAR + CORS FIX <<<");

    // Período: 30 dias atrás até 90 dias à frente
    const dataInicio = new Date();
    dataInicio.setDate(dataInicio.getDate() - 30);
    const dataFim = new Date();
    dataFim.setDate(dataFim.getDate() + 90);

    const dataIniStr = dataInicio.toLocaleDateString('pt-BR');
    const dataFimStr = dataFim.toLocaleDateString('pt-BR');

    let pagina = 1;
    let totalProcessado = 0;
    let continuar = true;

    while (continuar) {
      if (Date.now() - startTime > TIME_LIMIT_MS) break;

      // URL CORRETA: conta.pagar (SINGULAR)
      const urlPesquisa = `https://api.tiny.com.br/api2/conta.pagar.pesquisa.php?token=${TINY_TOKEN}&data_inicial_vencimento=${dataIniStr}&data_final_vencimento=${dataFimStr}&pagina=${pagina}&formato=json`;
      
      const resp = await fetch(urlPesquisa);
      const text = await resp.text();

      // Verifica se a resposta é JSON antes de parsear
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        console.error("Erro: Tiny não retornou JSON. Resposta:", text);
        throw new Error("A API do Tiny retornou um formato inválido (provavelmente File Not Found). Verifique a URL.");
      }

      if (json.retorno.status !== 'OK' || !json.retorno.contas) {
        continuar = false;
        break;
      }

      const listaContas = json.retorno.contas;

      for (const itemWrapper of listaContas) {
        const itemBasico = itemWrapper.conta;
        if (Date.now() - startTime > TIME_LIMIT_MS) { continuar = false; break; }

        await new Promise(r => setTimeout(r, PAUSA_ENTRE_DETALHES));

        // Busca Detalhes para pegar Fornecedor e Categoria reais
        let det = {};
        try {
          const urlObter = `https://api.tiny.com.br/api2/conta.pagar.obter.php?token=${TINY_TOKEN}&id=${itemBasico.id}&formato=json`;
          const respDet = await fetch(urlObter);
          const jsonDet = await respDet.json();
          if (jsonDet.retorno.status === 'OK') det = jsonDet.retorno.conta;
        } catch (e) { console.error("Erro ao obter detalhe:", itemBasico.id); }

        const final = { ...itemBasico, ...det };

        // Mapeamento para o seu banco (conforme o esquema enviado)
        const payload = {
          id: final.id.toString(), // Texto
          fornecedor: final.nome_fornecedor || final.cliente?.nome || "Não Identificado",
          data_emissao: final.data_emissao ? final.data_emissao.split('/').reverse().join('-') : null,
          data_vencimento: final.data_vencimento.split('/').reverse().join('-'),
          data_liquidacao: final.data_pagamento ? final.data_pagamento.split('/').reverse().join('-') : null,
          valor_documento: parseFloat(final.valor || 0),
          valor_pago: parseFloat(final.valor_pago || 0),
          saldo: parseFloat(final.saldo || 0),
          situacao: final.situacao?.toLowerCase() || 'pendente',
          numero_documento: final.nro_documento || "",
          categoria: final.categoria || final.classe_financeira || "Geral",
          historico: final.historico || "",
          competencia: final.data_competencia || "",
          forma_pagamento: final.forma_pagamento || "",
          ult_atuali: new Date().toISOString()
        };

        const { error } = await supabase.from('accounts_payable').upsert(payload, { onConflict: 'id' });
        if (!error) totalProcessado++;
      }
      pagina++;
    }

    return new Response(JSON.stringify({ message: "Sync concluído", count: totalProcessado }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (err: any) {
    console.error("ERRO FATAL:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});