import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TINY_TOKEN = "54ba8ea7422b4e6f4264dc2ed007f48498ec8f973b499fe3694f225573d290e0"; 
const PAUSA_ENTRE_REQUISICOES = 1000; 
const LIMITE_POR_EXECUCAO = 20; 

function safeDate(raw: any): string | null {
    if (!raw || typeof raw !== 'string' || raw.trim() === '') return null;
    try {
        const parts = raw.split('/');
        if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    } catch (e) { return null; }
    return null;
}

serve(async (req) => {
  // 1. Tratamento de CORS (Essencial para o botão funcionar)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!supabaseKey) {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada.");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(">>> EXPENSE ENRICHER: Buscando contas pagas sem detalhes... <<<");

    // 2. Busca apenas contas PAGAS que estão com DATA DE LIQUIDAÇÃO VAZIA
    const { data: incompletos, error } = await supabase
      .from('accounts_payable')
      .select('id, fornecedor')
      .or('situacao.ilike.pago,situacao.ilike.liquidado,situacao.ilike.baixado')
      .is('data_liquidacao', null) // O alvo do robô
      .limit(LIMITE_POR_EXECUCAO);

    if (error) throw error;

    if (!incompletos || incompletos.length === 0) {
        return new Response(JSON.stringify({ 
            message: "Nada pendente de correção.", 
            corrigidos: 0,
            analisados: 0
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });
    }

    console.log(`Encontradas ${incompletos.length} contas para corrigir.`);
    let corrigidos = 0;

    // 3. Busca os detalhes no Tiny para cada conta incompleta
    for (const item of incompletos) {
        await new Promise(r => setTimeout(r, PAUSA_ENTRE_REQUISICOES));

        try {
            const url = `https://api.tiny.com.br/api2/conta.pagar.obter.php?token=${TINY_TOKEN}&id=${item.id}&formato=json`;
            const resp = await fetch(url);
            const json = await resp.json();

            if (json.retorno.status === 'OK') {
                const det = json.retorno.conta;
                
                // Extrai dados ricos
                const dataLiq = det.data_pagamento || det.data_baixa;
                const dataFormatada = safeDate(dataLiq);
                
                const updatePayload: any = {
                    ult_atuali: new Date().toISOString()
                };

                // Só preenche o que achou
                if (dataFormatada) updatePayload.data_liquidacao = dataFormatada;
                if (det.data_competencia) updatePayload.competencia = det.data_competencia;
                if (det.linha_digitavel || det.codigo_barras) updatePayload.chave_pix_boleto = det.linha_digitavel || det.codigo_barras;

                // Atualiza nomes genéricos
                if (item.fornecedor === 'Desconhecido') {
                     if (det.cliente && det.cliente.nome) updatePayload.fornecedor = det.cliente.nome;
                     else if (det.nome_cliente) updatePayload.fornecedor = det.nome_cliente;
                     else if (det.nome_fornecedor) updatePayload.fornecedor = det.nome_fornecedor;
                }

                // Salva no banco
                const { error: upError } = await supabase
                    .from('accounts_payable')
                    .update(updatePayload)
                    .eq('id', item.id);

                if (!upError) {
                    corrigidos++;
                    console.log(`Corrigido ID ${item.id} - Data: ${dataFormatada}`);
                }
            }
        } catch (err) {
            console.error(`Erro ID ${item.id}:`, err);
        }
    }

    return new Response(JSON.stringify({ 
        message: "Ciclo de Enriquecimento Concluído", 
        analisados: incompletos.length,
        corrigidos: corrigidos 
    }), {
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