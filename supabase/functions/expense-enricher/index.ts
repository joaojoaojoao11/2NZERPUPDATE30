import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function safeDate(raw: any): string | null {
    if (!raw || typeof raw !== 'string' || raw.trim() === '') return null;
    try {
        const parts = raw.split('/');
        if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    } catch (e) { return null; }
    return null;
}

serve(async (req) => {
  // 1. Resposta para o Preflight (Resolve o erro de CORS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Variáveis de ambiente (Secrets do Supabase)
    const TINY_TOKEN = Deno.env.get('TINY_TOKEN');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!TINY_TOKEN) throw new Error("TINY_TOKEN não configurado.");
    if (!supabaseKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada.");

    const supabase = createClient(supabaseUrl, supabaseKey);
    const PAUSA_ENTRE_REQUISICOES = 1000; 
    const LIMITE_POR_EXECUCAO = 20; 

    console.log(">>> INICIANDO ENRIQUECIMENTO DE DESPESAS <<<");

    // 3. Busca contas pagas sem data de liquidação
    const { data: incompletos, error } = await supabase
      .from('accounts_payable')
      .select('id, fornecedor')
      .or('situacao.ilike.pago,situacao.ilike.liquidado,situacao.ilike.baixado')
      .is('data_liquidacao', null)
      .limit(LIMITE_POR_EXECUCAO);

    if (error) throw error;

    if (!incompletos || incompletos.length === 0) {
        return new Response(JSON.stringify({ message: "Nada para corrigir", corrigidos: 0 }), {
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
                const dataLiq = det.data_pagamento || det.data_baixa;
                const dataFormatada = safeDate(dataLiq);
                
                const updatePayload: any = {
                    ult_atuali: new Date().toISOString()
                };

                if (dataFormatada) updatePayload.data_liquidacao = dataFormatada;
                if (det.data_competencia) updatePayload.competencia = det.data_competencia;
                if (det.linha_digitavel || det.codigo_barras) updatePayload.chave_pix_boleto = det.linha_digitavel || det.codigo_barras;

                if (item.fornecedor === 'Desconhecido') {
                     if (det.cliente?.nome) updatePayload.fornecedor = det.cliente.nome;
                     else if (det.nome_cliente) updatePayload.fornecedor = det.nome_cliente;
                }

                await supabase.from('accounts_payable').update(updatePayload).eq('id', item.id);
                corrigidos++;
                console.log(`ID ${item.id} atualizado.`);
            }
        } catch (err) {
            console.error(`Erro ID ${item.id}:`, err);
        }
    }

    return new Response(JSON.stringify({ message: "Sucesso", corrigidos }), {
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