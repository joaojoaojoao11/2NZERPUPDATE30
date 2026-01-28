import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Se você gerou um token novo, garanta que ele esteja aqui!
const TINY_TOKEN = "df0900959326f5540306233267d345c267a32900"; 
const TIME_LIMIT_MS = 50000; 
const PAUSA_ENTRE_DETALHES = 800;

function formatDateBR(date: Date): string {
  const d = new Date(date);
  const dia = d.getUTCDate().toString().padStart(2, '0');
  const mes = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const ano = d.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(">>> SYNC INICIADO: CORREÇÃO DE PARAMETROS (INI/FIM) <<<");

    const hoje = new Date();
    const dataInicio = new Date(hoje);
    dataInicio.setDate(hoje.getDate() - 60); 
    
    const dataFim = new Date(hoje);
    dataFim.setDate(hoje.getDate() + 120); 

    const dataIniStr = formatDateBR(dataInicio);
    const dataFimStr = formatDateBR(dataFim);

    console.log(`Buscando de: ${dataIniStr} até ${dataFimStr}`);

    let pagina = 1;
    let totalProcessado = 0;
    let continuar = true;

    while (continuar) {
      if (Date.now() - startTime > TIME_LIMIT_MS) break;

      // === CORREÇÃO AQUI ===
      // Mudamos de 'data_inicial_vencimento' para 'data_ini_vencimento'
      // Mudamos de 'data_final_vencimento' para 'data_fim_vencimento'
      const urlPesquisa = `https://api.tiny.com.br/api2/contas.pagar.pesquisa.php?token=${TINY_TOKEN}&data_ini_vencimento=${dataIniStr}&data_fim_vencimento=${dataFimStr}&pagina=${pagina}&formato=json`;
      
      const resp = await fetch(urlPesquisa);
      const text = await resp.text();

      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        console.error("Erro Tiny JSON:", text);
        throw new Error("Tiny retornou resposta inválida.");
      }

      if (json.retorno.status !== 'OK') {
        if (json.retorno.codigo_erro == '20') {
             console.log("Fim da paginação.");
        } else {
             // Loga o erro exato se não for código 20
             console.error("Erro API Tiny:", JSON.stringify(json.retorno));
        }
        continuar = false; 
        break;
      }

      const listaContas = json.retorno.contas || [];
      if (listaContas.length === 0) {
        continuar = false;
        break;
      }

      console.log(`Página ${pagina}: ${listaContas.length} contas.`);

      for (const itemWrapper of listaContas) {
        const itemBasico = itemWrapper.conta;
        if (Date.now() - startTime > TIME_LIMIT_MS) { continuar = false; break; }

        await new Promise(r => setTimeout(r, PAUSA_ENTRE_DETALHES));

        let det = {};
        try {
          const urlObter = `https://api.tiny.com.br/api2/conta.pagar.obter.php?token=${TINY_TOKEN}&id=${itemBasico.id}&formato=json`;
          const respDet = await fetch(urlObter);
          const jsonDet = await respDet.json();
          if (jsonDet.retorno.status === 'OK') det = jsonDet.retorno.conta;
        } catch (e) { console.warn("Erro detalhe:", itemBasico.id); }

        const final = { ...itemBasico, ...det };

        const payload = {
          id: final.id.toString(),
          fornecedor: final.nome_fornecedor || final.cliente?.nome || "Desconhecido",
          data_emissao: final.data_emissao ? final.data_emissao.split('/').reverse().join('-') : null,
          data_vencimento: final.data_vencimento ? final.data_vencimento.split('/').reverse().join('-') : null,
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