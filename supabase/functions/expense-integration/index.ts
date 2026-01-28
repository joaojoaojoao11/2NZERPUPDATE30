import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Mantenha os imports e o token...

const TINY_TOKEN = "54ba8ea7422b4e6f4264dc2ed007f48498ec8f973b499fe3694f225573d290e0"; 
const TIME_LIMIT_MS = 55000; 
const PAUSA_NOVO_ITEM = 1000; 
const PAUSA_ITEM_EXISTENTE = 0; 

// === AJUSTE DE SEGURANÇA ===
// Reduzido de 55 para 40 para evitar Erro 6 (API Bloqueada)
const LIMITE_REQUISICOES_TINY = 40; 

// ... resto do código igual ...

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

    console.log(">>> SYNC: MODO SMART (Ignora detalhes de conhecidos) <<<");

    // 1. Carrega IDs existentes para não perder tempo com eles
    const { data: existingData } = await supabase.from('accounts_payable').select('id');
    const existingIds = new Set(existingData?.map(x => x.id) || []);
    console.log(`Banco possui ${existingIds.size} registros.`);

    const hoje = new Date();
    const dataInicio = new Date(hoje);
    dataInicio.setDate(hoje.getDate() - 60); 
    const dataFim = new Date(hoje);
    dataFim.setDate(hoje.getDate() + 120); 

    const dataIniStr = formatDateBR(dataInicio);
    const dataFimStr = formatDateBR(dataFim);

    let pagina = 1;
    let totalProcessado = 0;
    let requisicoesFeitas = 0;
    let continuar = true;

    while (continuar) {
      if (Date.now() - startTime > TIME_LIMIT_MS) break;
      // Se já fizemos muitas chamadas pesadas ao Tiny, paramos para não bloquear
      if (requisicoesFeitas >= LIMITE_REQUISICOES_TINY) {
          console.log("Limite de requisições API atingido. Parando lote.");
          break;
      }

      const urlPesquisa = `https://api.tiny.com.br/api2/contas.pagar.pesquisa.php?token=${TINY_TOKEN}&data_ini_vencimento=${dataIniStr}&data_fim_vencimento=${dataFimStr}&pagina=${pagina}&formato=json`;
      
      const resp = await fetch(urlPesquisa);
      const text = await resp.text();
      // Contabiliza requisição de pesquisa
      requisicoesFeitas++; 

      let json;
      try { json = JSON.parse(text); } catch (e) { throw new Error(`Erro JSON Tiny`); }

      if (json.retorno.status !== 'OK') {
        if (json.retorno.codigo_erro != '20') console.error("Erro Tiny:", JSON.stringify(json.retorno));
        continuar = false; 
        break;
      }

      const listaContas = json.retorno.contas || [];
      if (listaContas.length === 0) { continuar = false; break; }

      console.log(`Pág ${pagina}: ${listaContas.length} itens.`);

      for (const itemWrapper of listaContas) {
        if (Date.now() - startTime > TIME_LIMIT_MS) { continuar = false; break; }
        
        const itemBasico = itemWrapper.conta;
        const idString = itemBasico.id.toString();
        const jaExiste = existingIds.has(idString);

        if (jaExiste) {
            // === MODO RÁPIDO (UPDATE) ===
            // Se já existe, atualizamos apenas status/saldo usando dados básicos
            // Não chamamos API de detalhes -> Economiza tempo e cota
            await new Promise(r => setTimeout(r, PAUSA_ITEM_EXISTENTE));
            
            const payloadBasico = {
                id: idString,
                situacao: itemBasico.situacao?.toLowerCase() || 'pendente',
                saldo: parseFloat(itemBasico.saldo || 0),
                data_liquidacao: itemBasico.data_pagamento ? itemBasico.data_pagamento.split('/').reverse().join('-') : null,
                ult_atuali: new Date().toISOString()
            };
            
            await supabase.from('accounts_payable').upsert(payloadBasico, { onConflict: 'id' });
            
        } else {
            // === MODO COMPLETO (INSERT) ===
            // Item novo: Precisa de detalhes (Nome, Categoria, etc)
            if (requisicoesFeitas >= LIMITE_REQUISICOES_TINY) {
                continuar = false;
                break;
            }

            await new Promise(r => setTimeout(r, PAUSA_NOVO_ITEM));
            
            let det = {};
            try {
                const urlObter = `https://api.tiny.com.br/api2/conta.pagar.obter.php?token=${TINY_TOKEN}&id=${itemBasico.id}&formato=json`;
                const respDet = await fetch(urlObter);
                const jsonDet = await respDet.json();
                requisicoesFeitas++; // Contabiliza requisição pesada
                if (jsonDet.retorno.status === 'OK') det = jsonDet.retorno.conta;
            } catch (e) { console.warn("Erro det:", itemBasico.id); }

            // Lógica de nome (Detetive)
            let nomeFinal = "Desconhecido";
            if (det.cliente && det.cliente.nome) nomeFinal = det.cliente.nome;
            else if (det.nome_cliente) nomeFinal = det.nome_cliente;
            else if (det.nome_fornecedor) nomeFinal = det.nome_fornecedor;
            else if (itemBasico.cliente && itemBasico.cliente.nome) nomeFinal = itemBasico.cliente.nome;
            else if (itemBasico.nome_cliente) nomeFinal = itemBasico.nome_cliente;
            else if (itemBasico.nome_fornecedor) nomeFinal = itemBasico.nome_fornecedor;

            const final = { ...itemBasico, ...det };
            
            const payloadNovo = {
                id: idString,
                fornecedor: nomeFinal,
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

            const { error } = await supabase.from('accounts_payable').upsert(payloadNovo, { onConflict: 'id' });
            if (!error) totalProcessado++;
        }
      }
      pagina++;
    }

    return new Response(JSON.stringify({ 
        message: "Sync OK", 
        novos: totalProcessado, 
        reqs: requisicoesFeitas 
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