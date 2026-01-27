import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// --- CONFIGURAÇÕES DE PERFORMANCE ---
const TIME_LIMIT_MS = 55000;      // 55s (Limite de segurança do Supabase)
const PAUSA_ENTRE_DETALHES = 800; // 0.8s entre chamadas (Otimizado para não bloquear)

// Função de Data segura
function parseDate(dateStr: string | null): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  try {
    const clean = dateStr.split(' ')[0].trim();
    let y, m, d;
    if (clean.includes('/')) [d, m, y] = clean.split('/');
    else if (clean.includes('-')) [y, m, d] = clean.split('-');
    else return null;
    return `${y}-${m}-${d}`;
  } catch { return null; }
}

Deno.serve(async (req) => {
  // CORS Check (Permite conexão do Front)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform' } });
  }

  const startTime = performance.now();
  console.log('--> [ExpenseSync] Iniciando Sincronização DETALHADA (Buscando Categorias)...');

  try {
    const TOKEN = Deno.env.get('TINY_TOKEN') || Deno.env.get('OLIST_API_KEY');
    const SB_URL = Deno.env.get('SUPABASE_URL');
    const SB_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TOKEN || !SB_URL || !SB_KEY) throw new Error('Configuração incompleta.');
    const cleanToken = TOKEN.includes('=') ? TOKEN.split('=').pop()?.trim() || TOKEN : TOKEN;
    const supabase = createClient(SB_URL, SB_KEY);

    // Focamos em 2026 e 2025
    const periodos = [
      { ini: '01/01/2026', fim: '31/12/2026' },
      { ini: '01/01/2025', fim: '31/12/2025' },
    ];

    let totalSalvo = 0;
    let stopGlobal = false;
    const idsProcessados = new Set<string>();

    for (const p of periodos) {
      if (stopGlobal) break;
      let pagina = 1;

      while (true) {
        // Verifica se o tempo está acabando (deixa 5s de margem)
        if (performance.now() - startTime > (TIME_LIMIT_MS - 5000)) {
          console.log(`--> Tempo limite (${TIME_LIMIT_MS}ms) próximo. Salvando progresso e encerrando.`);
          stopGlobal = true;
          break;
        }

        console.log(`--> Lendo Lista Resumida ${p.ini} - Pág ${pagina}...`);
        
        // 1. BUSCA A LISTA (RESUMIDA) - Lote de 20 para dar tempo de processar os detalhes
        const urlList = new URL('https://api.tiny.com.br/api2/contas.pagar.pesquisa.php');
        urlList.searchParams.set('token', cleanToken);
        urlList.searchParams.set('formato', 'json');
        urlList.searchParams.set('limit', '20'); 
        urlList.searchParams.set('pagina', String(pagina));
        urlList.searchParams.set('data_ini_emissao', p.ini);
        urlList.searchParams.set('data_fim_emissao', p.fim);

        const resList = await fetch(urlList.toString());
        const jsonList = await resList.json();

        if (jsonList.retorno.status === 'Erro') {
            const erro = jsonList.retorno.erros?.[0]?.erro || '';
            if (erro.includes('não foram encontrados') || jsonList.retorno.codigo_erro == 20) {
                console.log(`--> Fim da lista para ${p.ini}.`);
            } else {
                console.log(`--> Erro na lista: ${erro}`);
            }
            break; 
        }

        const listaResumida = jsonList.retorno.contas || [];
        if (listaResumida.length === 0) break;

        const batchDetalhado = [];

        // 2. LOOP DE DETALHES (BUSCA DADOS COMPLETOS UM POR UM)
        for (const itemResumido of listaResumida) {
            // Checagem de tempo dentro do loop
            if (performance.now() - startTime > (TIME_LIMIT_MS - 2000)) { stopGlobal = true; break; }

            const contaBasic = itemResumido.conta || itemResumido;
            const idConta = String(contaBasic.id);

            // Evita duplicidade
            if (idsProcessados.has(idConta)) continue;
            idsProcessados.add(idConta);

            // Pausa rápida para a API não bloquear
            await new Promise(r => setTimeout(r, PAUSA_ENTRE_DETALHES));

            try {
                // --> AQUI ESTÁ O SEGREDO: Endpoint "obter" traz a categoria
                const urlDetalhe = new URL('https://api.tiny.com.br/api2/conta.pagar.obter.php');
                urlDetalhe.searchParams.set('token', cleanToken);
                urlDetalhe.searchParams.set('formato', 'json');
                urlDetalhe.searchParams.set('id', idConta);

                const resDet = await fetch(urlDetalhe.toString());
                const jsonDet = await resDet.json();
                
                // Se o detalhe falhar, usamos o básico. Se funcionar, usamos o completo.
                const contaFull = (jsonDet.retorno.status === 'OK') ? jsonDet.retorno.conta : contaBasic;
                
                // Extração de Valores e Datas
                const vDoc = parseFloat(contaFull.valor) || 0;
                const saldo = parseFloat(contaFull.saldo) || 0;
                const dataVenc = parseDate(contaFull.data_vencimento);
                const dataEmis = parseDate(contaFull.data_emissao);

                // --- CAÇA À CATEGORIA ---
                // Tenta pegar de 'categoria', 'classe_financeira' ou 'grupo_contas'
                let categoriaReal = contaFull.categoria || contaFull.classe_financeira || contaFull.grupo_contas || null;
                
                // Se ainda for null, tenta garantir que não salve "undefined"
                if (!categoriaReal) categoriaReal = null;

                let comp = null;
                if (contaFull.data_vencimento && contaFull.data_vencimento.includes('/')) {
                    const parts = contaFull.data_vencimento.split('/');
                    if (parts.length === 3) comp = `${parts[1]}/${parts[2]}`;
                }

                batchDetalhado.push({
                    id: idConta,
                    fornecedor: contaFull.nome_cliente || contaFull.nome_fornecedor || 'Desconhecido',
                    data_emissao: dataEmis,
                    data_vencimento: dataVenc || dataEmis || new Date().toISOString().split('T')[0],
                    data_liquidacao: parseDate(contaFull.data_pagamento),
                    valor_documento: vDoc,
                    saldo: saldo,
                    situacao: contaFull.situacao,
                    numero_documento: contaFull.numero_doc,
                    categoria: categoriaReal,  // <--- AGORA VEM PREENCHIDA
                    historico: contaFull.historico,
                    valor_pago: vDoc - saldo,
                    competencia: comp,
                    ult_atuali: new Date().toISOString(),
                });

            } catch (err) {
                console.error(`Erro ao detalhar conta ${idConta}`, err);
            }
        }

        // 3. SALVAR NO BANCO (Upsert: Atualiza se já existir)
        if (batchDetalhado.length > 0) {
            const { error } = await supabase.from('accounts_payable').upsert(batchDetalhado, { onConflict: 'id' });
            if (!error) {
                totalSalvo += batchDetalhado.length;
                console.log(`--> Salvo lote de ${batchDetalhado.length} contas DETALHADAS.`);
            } else {
                console.error('Erro SQL:', error.message);