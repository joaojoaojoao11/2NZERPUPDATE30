import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TINY_TOKEN = "54ba8ea7422b4e6f4264dc2ed007f48498ec8f973b499fe3694f225573d290e0"; 
const TIME_LIMIT_MS = 55000; 
const PAUSA_NOVO_ITEM = 1000; 
const PAUSA_ITEM_EXISTENTE = 0; 

// Limite de segurança
const LIMITE_REQUISICOES_TINY = 35; 

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

    console.log(">>> EXPENSE SYNC: MODO INCREMENTAL (Cursor de Data) <<<");

    // 1. Descobrir onde paramos (Última data de vencimento salva no CONTAS A PAGAR)
    const { data: lastRecord } = await supabase
      .from('accounts_payable')
      .select('data_vencimento')
      .order('data_vencimento', { ascending: false })
      .limit(1)
      .single();

    const hoje = new Date();
    let dataInicio = new Date();
    
    // Lógica do Pulo:
    // Se tem registro, começamos 5 dias antes da última data (margem de segurança).
    // Assim, pulamos todos os meses anteriores automaticamente.
    if (lastRecord && lastRecord.data_vencimento) {
        dataInicio = new Date(lastRecord.data_vencimento);
        dataInicio.setDate(dataInicio.getDate() - 5); 
        console.log(`Último registro em: ${lastRecord.data_vencimento}. Retomando de: ${formatDateBR(dataInicio)}`);
    } else {
        // Se o banco estiver vazio, aí sim buscamos 1 ano para trás
        dataInicio.setDate(hoje.getDate() - 365);
        console.log("Banco vazio. Iniciando carga completa (365 dias).");
    }

    // Buscamos até 180 dias no futuro
    const dataFim = new Date(hoje);
    dataFim.setDate(hoje.getDate() + 180); 

    const dataIniStr = formatDateBR(dataInicio);
    const dataFimStr = formatDateBR(dataFim);

    // Carrega cache apenas desse período recente (muito mais rápido)
    const { data: existingData } = await supabase
        .from('accounts_payable')
        .select('id, situacao')
        .gte('data_vencimento', lastRecord ? lastRecord.data_vencimento : '2000-01-01');

    const existingMap = new Map();
    if (existingData) {
        existingData.forEach(item => existingMap.set(item.id, item.situacao));
    }

    let pagina = 1;
    let totalProcessado = 0;
    let novosInseridos = 0;
    let requisicoesFeitas = 0;
    let continuar = true;

    while (continuar) {
      if (Date.now() - startTime > TIME_LIMIT_MS) break;
      
      if (requisicoesFeitas >= LIMITE_REQUISICOES_TINY) {
          console.log("Limite de API atingido. Pausando.");
          break;
      }

      // Chama a API do Tiny apenas para o período "em aberto"
      const urlPesquisa = `https://api.tiny.com.br/api2/contas.pagar.pesquisa.php?token=${TINY_TOKEN}&data_ini_vencimento=${dataIniStr}&data_fim_vencimento=${dataFimStr}&pagina=${pagina}&formato=json`;
      
      const resp = await fetch(urlPesquisa);
      const text = await resp.text();
      requisicoesFeitas++; 

      let json;
      try { json = JSON.parse(text); } catch (e) { throw new Error(`Erro JSON Tiny`); }

      if (json.retorno.status !== 'OK') {
        // Código 20 ou 23 significa que acabou a lista nessa data
        if (json.retorno.codigo_erro == '20' || json.retorno.codigo_erro == '23') {
             console.log("Fim dos registros neste período.");
        } else {
             console.error("Erro Tiny:", JSON.stringify(json.retorno));
        }
        continuar = false; 
        break;
      }

      const listaContas = json.retorno.contas || [];
      if (listaContas.length === 0) { continuar = false; break; }

      console.log(`Pág ${pagina} (${dataIniStr} - ${dataFimStr}): ${listaContas.length} itens.`);

      for (const itemWrapper of listaContas) {
        if (Date.now() - startTime > TIME_LIMIT_MS) { continuar = false; break; }
        
        const itemBasico = itemWrapper.conta;
        const idString = itemBasico.id.toString();
        const situacaoTiny = itemBasico.situacao?.toLowerCase() || 'pendente';
        
        if (existingMap.has(idString)) {
            const situacaoBanco = existingMap.get(idString);
            
            // Se já existe e está pago, pula (não gasta processamento)
            if (situacaoBanco === 'pago' && situacaoTiny === 'pago') continue;

            // Se mudou algo, atualiza (update leve)
            const payloadBasico = {
                id: idString,
                situacao: situacaoTiny,
                saldo: parseFloat(itemBasico.saldo || 0),
                data_liquidacao: itemBasico.data_pagamento ? itemBasico.data_pagamento.split('/').reverse().join('-') : null,
                ult_atuali: new Date().toISOString()
            };
            
            await supabase.from('accounts_payable').upsert(payloadBasico, { onConflict: 'id' });
            totalProcessado++;
            
        } else {
            // Se é NOVO, busca detalhes (gasta API, mas só para o que é novo)
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
                requisicoesFeitas++;
                if (jsonDet.retorno.status === 'OK') det = jsonDet.retorno.conta;
            } catch (e) { console.warn("Erro det:", itemBasico.id); }

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
            if (!error) {
                totalProcessado++;
                novosInseridos++;
            }
        }
      }
      pagina++;
    }

    return new Response(JSON.stringify({ 
        message: "Expense Sync Incremental OK", 
        inicio_busca: formatDateBR(dataInicio), // Para você confirmar nos logs
        novos: novosInseridos,
        atualizados: totalProcessado,
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