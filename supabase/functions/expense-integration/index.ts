// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TINY_TOKEN = "54ba8ea7422b4e6f4264dc2ed007f48498ec8f973b499fe3694f225573d290e0";
const TIME_LIMIT_MS = 55000;
const PAUSA_NOVO_ITEM = 3000;
const PAUSA_ITEM_EXISTENTE = 0;
const LIMITE_REQUISICOES_TINY = 15;

// === MODO SNIPER (Opcional) ===
// Deixe vazio "" para modo automático (Recomendado para o dia a dia)
const FORCE_START = "";
const FORCE_END = "";

function formatDateBR(date: Date): string {
  const d = new Date(date);
  const dia = d.getUTCDate().toString().padStart(2, '0');
  const mes = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const ano = d.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
}

// --- NOVA FUNÇÃO SEGURA PARA DATA DE LIQUIDAÇÃO ---
function getDataLiquidacao(item: any): string | null {
  // Tenta pegar liquidacao ("27/01/2026") OU data_pagamento OU data_baixa
  const raw = item.liquidacao || item.data_pagamento || item.data_baixa || item.data_liquidacao;

  // Se não tiver nada ou for string vazia, retorna null
  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }

  // Tenta formatar de DD/MM/YYYY para YYYY-MM-DD
  try {
    const parts = raw.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  } catch (e) {
    return null;
  }

  return null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startTime = Date.now();

  try {

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    // @ts-ignore
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseKey) {
      console.error("FATAL: SUPABASE_SERVICE_ROLE_KEY NÃO ENCONTRADA! Usando modo anônimo (pode causar bloqueio RLS).");
    } else {
      console.log("Service Key carregada. Comprimento: " + supabaseKey.length);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    let dataIniStr = "";
    let dataFimStr = "";
    let modoExecucao = "";

    // --- DEFINIÇÃO DO PERÍODO DE BUSCA ---

    if (FORCE_START && FORCE_END) {
      // MODO 1: SNIPER (Manual)
      modoExecucao = "SNIPER";
      console.log(`>>> EXPENSE SYNC: MODO SNIPER (${FORCE_START} até ${FORCE_END}) <<<`);
      dataIniStr = FORCE_START;
      dataFimStr = FORCE_END;

    } else {
      // ESTRATÉGIA "FOCUS MODE" (SOLICITADO PELO USUÁRIO)
      // Focamos apenas na quinzena atual (+/- 20 dias) para garantir que o que importa
      // (o mês atual) seja atualizado rápido e sem bloqueios de API.
      // O histórico antigo pode ser corrigido em rotinas noturnas se necessário.
      console.log(">>> EXPENSE SYNC: MODO FOCUS (20 dias atrás -> 20 dias futuro) <<<");

      const DAYS_PAST = 20;
      const DAYS_FUTURE = 20;

      const hoje = new Date();

      const dataInicio = new Date(hoje);
      dataInicio.setDate(hoje.getDate() - DAYS_PAST);

      const dataFim = new Date(hoje);
      dataFim.setDate(hoje.getDate() + DAYS_FUTURE);

      dataIniStr = formatDateBR(dataInicio);
      dataFimStr = formatDateBR(dataFim);
    }

    const isoStart = dataIniStr.split('/').reverse().join('-');
    const { data: existingData } = await supabase
      .from('accounts_payable')
      .select('id, situacao, ult_atuali')
      .gte('data_vencimento', isoStart);

    const existingMap = new Map();
    if (existingData) {
      existingData.forEach((item: any) => existingMap.set(String(item.id), {
        situacao: item.situacao,
        ult_atuali: item.ult_atuali
      }));
    }

    // 0. QUERY INICIAL PARA DESCOBRIR TOTAL PÁGINAS
    const urlInit = `https://api.tiny.com.br/api2/contas.pagar.pesquisa.php?token=${TINY_TOKEN}&data_ini_vencimento=${dataIniStr}&data_fim_vencimento=${dataFimStr}&pagina=1&formato=json`;
    const resInit = await fetch(urlInit);
    const jsonInit = await resInit.json();

    // Variáveis de Controle
    let continuar = true;
    let totalProcessado = 0;
    let novosInseridos = 0;
    let requisicoesFeitas = 0;
    let errosEncontrados: string[] = [];

    // Se não tiver nada ou der erro no init, encerra
    if (!jsonInit.retorno || jsonInit.retorno.status !== 'OK') {
      console.log("Nenhum registro encontrado no período ou erro inicial.");
      continuar = false;
    }

    const totalPaginas = Number(jsonInit.retorno.numero_paginas || 1);

    console.log(`>>> SYNC V2.1 STARTED - AUTO-FIX ENABLED - Total de Páginas: ${totalPaginas} <<<`);

    // ESTRATÉGIA DIRETA: Começa da Primeira Página (datas mais antigas no range) e avança.
    // Isso garante que resolvemos pendências de Janeiro antes de olhar Fevereiro.
    let pagina = 1;
    const maxPagina = totalPaginas; // Processa até o fim

    while (pagina <= maxPagina && continuar) {
      if (Date.now() - startTime > TIME_LIMIT_MS) break;
      if (requisicoesFeitas >= LIMITE_REQUISICOES_TINY) {
        console.log("Limite de API atingido. Pausando.");
        break;
      }

      console.log(`Processando Página ${pagina}...`);
      const urlPesquisa = `https://api.tiny.com.br/api2/contas.pagar.pesquisa.php?token=${TINY_TOKEN}&data_ini_vencimento=${dataIniStr}&data_fim_vencimento=${dataFimStr}&pagina=${pagina}&formato=json`;

      // Se já buscamos a pág 1 no init, poderíamos reutilizar, mas para simplificar a lógica reversa, buscamos de novo se cair nela.
      // (O custo de buscar a lista é baixo, o caro é o detalhe)
      let json = jsonInit;
      // Se NÃO for a página 1 (que já buscamos no init), faz fetch
      if (pagina !== 1 || (pagina === 1 && totalPaginas > 1)) {
        const resp = await fetch(urlPesquisa);
        const text = await resp.text();
        requisicoesFeitas++;
        try { json = JSON.parse(text); } catch (e) { throw new Error(`Erro JSON Tiny`); }
      }

      if (json.retorno.status !== 'OK') {
        console.error("Erro Tiny pag " + pagina, json.retorno.erros);
        pagina++; // Tenta próxima
        continue;
      }

      const listaContas = json.retorno.contas || [];
      if (listaContas.length === 0) {
        pagina++;
        continue;
      }

      // ... RESTO DO LOOP FOR ...


      for (const itemWrapper of listaContas) {
        if (Date.now() - startTime > TIME_LIMIT_MS) { continuar = false; break; }

        const itemBasico = itemWrapper.conta;
        const idString = itemBasico.id.toString();
        const situacaoTiny = itemBasico.situacao?.toLowerCase() || 'pendente';

        if (existingMap.has(idString)) {
          const dadosBanco = existingMap.get(idString);
          const situacaoBanco = dadosBanco.situacao;
          const ultAtuali = dadosBanco.ult_atuali;

          // MUDANÇA RADICAL:
          // A lista do Tiny parece não estar entregando o status atualizado ("pago") em alguns casos,
          // ou o status 'aberto' persiste na pesquisa rápida.
          // Para resolver definitivamente: Se no Banco está "ABERTO/PENDENTE", vamos FORÇAR a busca do detalhe
          // para confirmar se realmente está aberto ou se foi pago.
          // Isso consome limite de API, mas garante a verdade (35 itens por vez a cada 10 min).

          const bancoPago = situacaoBanco?.includes('pago') || situacaoBanco?.includes('liquidado');
          let itemPrecisaVerificacao = !bancoPago; // Se não está pago no banco, verifica!

          // OTIMIZAÇÃO DE RATE LIMIT:
          // Se o item está Aberto, mas já verificamos ele nos últimos 60 minutos, não verifica de novo agora.
          // Isso evita bombardiar a API do Tiny com os mesmos itens "Aberto" a cada execução.
          if (itemPrecisaVerificacao && ultAtuali) {
            const diffMs = Date.now() - new Date(ultAtuali).getTime();
            const diffMins = diffMs / (1000 * 60);

            // EXCEÇÃO DEBUG: Se for INOVA FILM ou ID específico, força a verificação SEMPRE
            const nomeForn = itemBasico.nome_fornecedor || itemBasico.nome || "";
            const isDebugTarget = (nomeForn && nomeForn.toUpperCase().includes("INOVA FILM")) || idString === "385844686" || idString === "385778113";

            if (isDebugTarget) {
              console.log(`>>> [ALVO DETECTADO] ID: ${idString}, Fornecedor: ${nomeForn} - FORÇANDO VERIFICAÇÃO!`);
            }

            if (diffMins < 60 && !isDebugTarget) {
              // Já verificado recentemente. Confia na lista simples por enquanto.
              itemPrecisaVerificacao = false;
            }
          }

          const statusMudouNaLista = situacaoBanco !== situacaoTiny;

          if (itemPrecisaVerificacao || statusMudouNaLista) {
            if (requisicoesFeitas >= LIMITE_REQUISICOES_TINY) {
              // Se atingiu o limite, mas o item precisava de verificação, paramos para não deixar nada para trás errado.
              // Mas como o loop continua nas próximas execuções (cron), tudo bem parar aqui.
              continuar = false;
              break;
            }

            // Fetch Detalhado (A Verdade Absoluta)
            await new Promise(r => setTimeout(r, PAUSA_NOVO_ITEM));
            let det: any = {};
            let fetchSuccess = false;
            try {
              const urlObter = `https://api.tiny.com.br/api2/conta.pagar.obter.php?token=${TINY_TOKEN}&id=${itemBasico.id}&formato=json`;
              const respDet = await fetch(urlObter);
              const jsonDet = await respDet.json();
              requisicoesFeitas++;

              if (jsonDet.retorno.status === 'OK') {
                det = jsonDet.retorno.conta;
                fetchSuccess = true;

                // DEBUG ESPIÃO: Verificar especificamente a conta da INOVA FILM OU IDs problematicos
                try {
                  const spyIds = ["385770458", "391552502", "390206695"];
                  if ((det.nome_fornecedor && det.nome_fornecedor.toUpperCase().includes("INOVA FILM")) || spyIds.includes(idString)) {
                    console.log(`>>> [ESPIÃO ${idString}] JSON RETORNADO PELO TINY:`, JSON.stringify(det));
                  }
                } catch (err_espiao) { }

                // LOGICA DE "PRESUMED PAID" (Regra do Usuário: "Nunca atraso")
                // Se está ABERTO mas já VENCEU (vencimento < hoje), assumimos que foi PAGO.
                if (det.situacao === 'aberto' && det.data_vencimento) {
                  try {
                    const [d, m, y] = det.data_vencimento.split('/');
                    const venc = new Date(`${y}-${m}-${d}T00:00:00`); // Force Local Time interpretation-ish
                    const hoje = new Date();
                    hoje.setHours(0, 0, 0, 0);

                    // Ajuste de fuso horário simples pra garantir comparação de datas
                    const vencTime = venc.getTime();
                    const hojeTime = hoje.getTime();

                    if (vencTime < hojeTime) {
                      console.log(`[AUTO-FIX] ID ${idString} Vencido (${det.data_vencimento}) < Hoje. Forçando 'pago' conforme regra "Nunca Atraso".`);
                      det.situacao = 'pago';
                      // Força a data de pagamento para ser igual ao vencimento (formato DD/MM/YYYY para o parser)
                      det.data_pagamento = det.data_vencimento;
                      // Tamém define outros campos para garantir
                      det.data_liquidacao = det.data_vencimento;
                      det.data_baixa = det.data_vencimento;
                    }
                  } catch (err_date) {
                    console.warn("Erro ao processar data vencimento auto-fix:", err_date);
                  }
                }

                // DEBUG: Ver o que veio no detalhe
                console.log(`[DEBUG] Detalhe ID ${idString}: Sit=${det.situacao}, Venc=${det.data_vencimento}, DtLiq=${det.data_liquidacao}, VlPago=${det.valor_pago}`);
              } else {
                const errors = jsonDet.retorno.erros || [];
                const errorMsg = JSON.stringify(errors);
                console.warn(`[WARN] Falha Detalhe ID ${idString}:`, errorMsg);

                // BACKOFF STRATEGY: Se a API bloquear, esperar 25 segundos antes de qualquer coisa para resetar limites
                if (errorMsg.includes("API Bloqueada")) {
                  console.warn(">>> API BLOQUEADA DETECTADA! APLICANDO PENALTY BOX (25s) para resfriar <<<");
                  errosEncontrados.push(`API BLOQUEADA ID ${idString} - Pausando 25s`);
                  await new Promise(r => setTimeout(r, 25000));
                }
              }
            } catch (e: any) {
              console.warn("Erro Fetch Exception:", itemBasico.id);
              errosEncontrados.push(`Erro ID ${itemBasico.id}: ${e.message}`);
            }

            // CRÍTICO: Se a busca do detalhe falhou, NÃO atualize com dados parciais da lista.
            // A lista pode estar desatualizada (cache). Se não conseguimos o detalhe, abortamos esse item.
            if (!fetchSuccess) {
              console.log(`[SKIP] ID ${idString} ignorado pois falhou busca detalhe.`);
              if (!errosEncontrados.length || !errosEncontrados[errosEncontrados.length - 1].includes(idString)) {
                errosEncontrados.push(`Falha detalhe ID ${idString} (Possível Block API)`);
              }
              continue;
            }

            const final = { ...itemBasico, ...det };

            // Payload Completo com a Verdade do Detalhe
            const dtLiqCheck = getDataLiquidacao(final);
            let situacaoReal = final.situacao?.toLowerCase() || 'pendente';

            // CORREÇÃO CRÍTICA: Se tem data de liquidação, É PAGO. Não importa o que o Tiny diga no status.
            if (dtLiqCheck) {
              situacaoReal = 'pago';
            }

            // CALCULAR FORNECEDOR (Igual ao bloco de inserção para garantir Upsert Seguro)
            let nomeFinalUpdate = "";
            if (det.cliente && det.cliente.nome) nomeFinalUpdate = det.cliente.nome;
            else if (det.nome_cliente) nomeFinalUpdate = det.nome_cliente;
            else if (det.nome_fornecedor) nomeFinalUpdate = det.nome_fornecedor;
            else if (itemBasico.cliente && itemBasico.cliente.nome) nomeFinalUpdate = itemBasico.cliente.nome;
            else if (itemBasico.nome_cliente) nomeFinalUpdate = itemBasico.nome_cliente;
            else if (itemBasico.nome_fornecedor) nomeFinalUpdate = itemBasico.nome_fornecedor;

            if (!nomeFinalUpdate || nomeFinalUpdate.trim() === "") {
              nomeFinalUpdate = "Fornecedor Não Identificado";
            }

            const payloadUpdate = {
              id: idString,
              situacao: situacaoReal,
              fornecedor: nomeFinalUpdate,
              data_emissao: final.data_emissao ? final.data_emissao.split('/').reverse().join('-') : new Date().toISOString().split('T')[0],
              data_vencimento: final.data_vencimento ? final.data_vencimento.split('/').reverse().join('-') : new Date().toISOString().split('T')[0],
              saldo: parseFloat(final.saldo || 0),
              valor_pago: parseFloat(final.valor_pago || 0),
              data_liquidacao: dtLiqCheck,
              competencia: final.data_competencia || "",
              categoria: final.categoria || final.classe_financeira || "Geral",
              forma_pagamento: final.forma_pagamento || "",
              ult_atuali: new Date().toISOString()
            };

            const { data: upsertData, error: upsertError } = await supabase
              .from('accounts_payable')
              .upsert(payloadUpdate, { onConflict: 'id' })
              .select();

            if (upsertError) {
              console.error(`[ERROR DB] Falha ao atualizar ID ${idString}:`, upsertError);
            } else if (!upsertData || upsertData.length === 0) {
              console.error(`[FATAL RLS] ID ${idString}: Supabase retornou sucesso mas NÃO GRAVOU nada! Verifique políticas RLS ou Chave de Serviço.`);
            }

            // Log de sucesso apenas se não houve erro E houve retorno
            if (!upsertError && upsertData && upsertData.length > 0 && situacaoBanco !== situacaoReal) {
              console.log(`[FIX] ID ${idString} corrigido: ${situacaoBanco} -> ${situacaoReal}`);
            }
            totalProcessado++;

          } else {
            // Se já está pago no banco E pago na lista... não faz nada (continue lá em cima pegou isso)
            // Ou se é apenas atualização cadastral de itens pagos
            // CALCULAR FORNECEDOR BASICO (Igual aos outros blocos)
            let nomeFinalBasico = "";
            if (itemBasico.cliente && itemBasico.cliente.nome) nomeFinalBasico = itemBasico.cliente.nome;
            else if (itemBasico.nome_cliente) nomeFinalBasico = itemBasico.nome_cliente;
            else if (itemBasico.nome_fornecedor) nomeFinalBasico = itemBasico.nome_fornecedor;

            if (!nomeFinalBasico || nomeFinalBasico.trim() === "") {
              nomeFinalBasico = "Fornecedor Não Identificado";
            }

            const payloadBasico = {
              id: idString,
              situacao: situacaoTiny,
              fornecedor: nomeFinalBasico,
              data_emissao: itemBasico.data_emissao ? itemBasico.data_emissao.split('/').reverse().join('-') : new Date().toISOString().split('T')[0],
              data_vencimento: itemBasico.data_vencimento ? itemBasico.data_vencimento.split('/').reverse().join('-') : new Date().toISOString().split('T')[0],
              saldo: parseFloat(itemBasico.saldo || 0),
              data_liquidacao: getDataLiquidacao(itemBasico),
              ult_atuali: new Date().toISOString()
            };
            const { error: upsertErrorBasico } = await supabase.from('accounts_payable').upsert(payloadBasico, { onConflict: 'id' });

            if (upsertErrorBasico) {
              console.error(`[ERROR DB] Falha ao atualizar (Basico) ID ${idString}:`, upsertErrorBasico);
            }
            totalProcessado++;
          }

        } else {
          if (requisicoesFeitas >= LIMITE_REQUISICOES_TINY) {
            continuar = false;
            break;
          }

          await new Promise(r => setTimeout(r, PAUSA_NOVO_ITEM));
          let det: any = {};
          try {
            const urlObter = `https://api.tiny.com.br/api2/conta.pagar.obter.php?token=${TINY_TOKEN}&id=${itemBasico.id}&formato=json`;
            const respDet = await fetch(urlObter);
            const jsonDet = await respDet.json();
            requisicoesFeitas++;
            if (jsonDet.retorno.status === 'OK') det = jsonDet.retorno.conta;
          } catch (e) { console.warn("Erro det:", itemBasico.id); }

          let nomeFinal = "";
          if (det.cliente && det.cliente.nome) nomeFinal = det.cliente.nome;
          else if (det.nome_cliente) nomeFinal = det.nome_cliente;
          else if (det.nome_fornecedor) nomeFinal = det.nome_fornecedor;
          else if (itemBasico.cliente && itemBasico.cliente.nome) nomeFinal = itemBasico.cliente.nome;
          else if (itemBasico.nome_cliente) nomeFinal = itemBasico.nome_cliente;
          else if (itemBasico.nome_fornecedor) nomeFinal = itemBasico.nome_fornecedor;

          // GARANTIA DE PREENCHIMENTO (Fix constraint null violation)
          if (!nomeFinal || nomeFinal.trim() === "") {
            nomeFinal = "Fornecedor Não Identificado";
          }

          const final = { ...itemBasico, ...det };

          const payloadNovo = {
            id: idString,
            fornecedor: nomeFinal,
            data_emissao: final.data_emissao ? final.data_emissao.split('/').reverse().join('-') : null,
            data_vencimento: final.data_vencimento ? final.data_vencimento.split('/').reverse().join('-') : null,
            // AQUI: Usa a nova função segura
            data_liquidacao: getDataLiquidacao(final),
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

          const { data: insertData, error: insertError } = await supabase
            .from('accounts_payable')
            .upsert(payloadNovo, { onConflict: 'id' })
            .select();

          if (insertError) {
            console.error(`[ERROR DB] Falha ao inserir novo ID ${idString}:`, insertError);
          } else if (!insertData || insertData.length === 0) {
            console.error(`[FATAL RLS] NOVO ID ${idString}: Supabase retornou sucesso mas NÃO GRAVOU nada! Verifique políticas RLS.`);
          } else {
            console.log(`[NEW] ID ${idString} inserido com sucesso.`);
            totalProcessado++;
            novosInseridos++;
          }
        }
      }
      pagina++;
    }

    return new Response(JSON.stringify({
      message: errosEncontrados.length > 0 ? "Sincronização com Avisos" : "Expense Sync OK",
      mode: modoExecucao,
      periodo: `${dataIniStr} -> ${dataFimStr}`,
      novos: novosInseridos,
      atualizados: totalProcessado,
      erros: errosEncontrados,
      totalErros: errosEncontrados.length
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