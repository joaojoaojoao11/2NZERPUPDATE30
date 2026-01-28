import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TINY_TOKEN = "df0900959326f5540306233267d345c267a32900"; 
const TIME_LIMIT_MS = 50000; 
const PAUSA_ENTRE_DETALHES = 800;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(">>> SYNC INICIADO: CORREÇÃO URL PLURAL/SINGULAR <<<");

    // Período de busca
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

      // CORREÇÃO 1: PESQUISA É NO PLURAL (contas)
      const urlPesquisa = `https://api.tiny.com.br/api2/contas.pagar.pesquisa.php?token=${TINY_TOKEN}&data_inicial_vencimento=${dataIniStr}&data_final_vencimento=${dataFimStr}&pagina=${pagina}&formato=json`;
      
      const resp = await fetch(urlPesquisa);
      const text = await resp.text();

      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        console.error("Erro Tiny JSON:", text);
        throw new Error("Tiny retornou erro na pesquisa. Verifique logs.");
      }

      if (json.retorno.status !== 'OK') {
        continuar = false; 
        break;
      }

      const listaContas = json.retorno.contas || [];
      if (listaContas.length === 0) {
        continuar = false;
        break;
      }

      for (const itemWrapper of listaContas) {
        const itemBasico = itemWrapper.conta;
        if (Date.now() - startTime > TIME_LIMIT_MS) { continuar = false; break; }

        await new Promise(r => setTimeout(r, PAUSA_ENTRE_DETALHES));

        // CORREÇÃO 2: OBTER DETALHE É NO SINGULAR (conta)
        let det = {};
        try {
          const urlObter = `https://api.tiny.com.br/api2/conta.pagar.obter.php?token=${TINY_TOKEN}&id=${itemBasico.id}&formato=json`;
          const respDet = await fetch(urlObter);
          const jsonDet = await respDet.json();
          if (jsonDet.retorno.status === 'OK') det = jsonDet.retorno.conta;
        } catch (e) { console.warn("Erro detalhe:", itemBasico.id); }

        const final = { ...itemBasico, ...det };

        // CORREÇÃO 3: PROTEÇÃO CONTRA DATA NULA (Evita crash no .split)
        const dtVenc = final.data_vencimento ? final.data_vencimento.split('/').reverse().join('-') : null;
        const dtEmis = final.data_emissao ? final.data_emissao.split('/').reverse().join('-') : null;
        const dtLiq = final.data_pagamento ? final.data_pagamento.split('/').reverse().join('-') : null;

        const payload = {
          id: final.id.toString(),
          fornecedor: final.nome_fornecedor || final.cliente?.nome || "Desconhecido",
          data_emissao: dtEmis,
          data_vencimento: dtVenc,
          data_liquidacao: dtLiq,
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

    return new Response(JSON.stringify({ message: "Sync OK", count: totalProcessado }), {
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