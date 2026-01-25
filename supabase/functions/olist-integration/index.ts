import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Delay aumentado para 1.5s para evitar bloqueio "API Blocked" do Tiny
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

Deno.serve(async (req) => {
  const startTime = performance.now(); // Marca o início da execução

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const TOKEN_TINY = Deno.env.get('OLIST_API_KEY') || ""; 
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY');

    if (!TOKEN_TINY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Configuração incompleta nos Secrets.');
    }

    let token = TOKEN_TINY;
    if (TOKEN_TINY.includes("=")) {
        token = TOKEN_TINY.split('=').pop()?.trim() || token;
    }
    token = token.trim();

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    console.log(`1. Iniciando Sincronização Segura Tiny -> NZERP...`);

    // --- CONFIGURAÇÃO DE SEGURANÇA ---
    let pagina = 1;
    // Reduzimos para 30 para garantir que dá tempo de processar tudo com o delay lento
    const itemsPorPagina = 30; 
    let totalProcessado = 0;
    const allRows: any[] = [];
    let stopExecution = false;

    // Loop de Páginas
    while (!stopExecution) {
        // Verifica se já passamos de 45 segundos de execução (Limite seguro do Supabase é 60s)
        if ((performance.now() - startTime) > 45000) {
            console.log("Tempo limite de segurança atingido. Salvando lote parcial...");
            break;
        }

        console.log(`--- Buscando Página ${pagina} (Lote de ${itemsPorPagina})...`);
        
        const urlBusca = new URL('https://api.tiny.com.br/api2/pedidos.pesquisa.php');
        urlBusca.searchParams.set('token', token);
        urlBusca.searchParams.set('formato', 'json');
        urlBusca.searchParams.set('limit', String(itemsPorPagina));
        urlBusca.searchParams.set('pagina', String(pagina));
        // urlBusca.searchParams.set('dataInicial', '01/01/2025'); // Opcional

        const resBusca = await fetch(urlBusca.toString());
        const jsonBusca = await resBusca.json();

        // Tratamento especial para erro de bloqueio
        if (jsonBusca.retorno.status === 'Erro') {
            const erroMsg = jsonBusca.retorno.erros[0].erro;
            
            if (jsonBusca.retorno.codigo_erro == 20) {
                console.log("Fim da lista de pedidos no Tiny.");
                stopExecution = true;
                break;
            }
            
            if (erroMsg.includes("API Bloqueada") || erroMsg.includes("acessos")) {
                console.warn("Alerta de Bloqueio Tiny: Parando por agora.");
                stopExecution = true;
                break;
            }
            
            throw new Error(`Erro Tiny Busca: ${erroMsg}`);
        }

        const listaPedidos = jsonBusca.retorno.pedidos || [];
        if (listaPedidos.length === 0) {
            stopExecution = true;
            break;
        }

        // Loop de Pedidos (Detalhes)
        for (const itemLista of listaPedidos) {
            // Verificação de tempo dentro do loop também
            if ((performance.now() - startTime) > 48000) {
                stopExecution = true;
                break;
            }

            const idPedido = itemLista.pedido.id;
            
            const urlDetalhe = new URL('https://api.tiny.com.br/api2/pedido.obter.php');
            urlDetalhe.searchParams.set('token', token);
            urlDetalhe.searchParams.set('id', idPedido);
            urlDetalhe.searchParams.set('formato', 'json');

            try {
                // DELAY AUMENTADO: 1.5 segundos entre pedidos (aprox 40 req/min, seguro)
                await delay(1500); 
                
                const resDetalhe = await fetch(urlDetalhe.toString());
                const jsonDetalhe = await resDetalhe.json();

                if (jsonDetalhe.retorno.status === 'OK') {
                    const p = jsonDetalhe.retorno.pedido;
                    
                    let dataVendaISO = new Date().toISOString();
                    if (p.data_pedido) {
                        const parts = p.data_pedido.split('/'); 
                        if (parts.length === 3) {
                            dataVendaISO = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`).toISOString();
                        }
                    }

                    const itens = p.itens || [{ item: { codigo: 'GEN', descricao: 'Item Genérico', quantidade: 1, valor_unitario: p.valor_total } }];

                    itens.forEach((wrapper: any, index: number) => {
                        const i = wrapper.item;
                        // ID Único: ID_Pedido + Index
                        let uniqueRowId = `TINY-${p.id}-${index + 1}`; 

                        allRows.push({
                            external_id: uniqueRowId, 
                            order_number: String(p.numero),
                            product_id_external: i.id_produto ? String(i.id_produto) : null,
                            
                            sale_date: dataVendaISO,
                            status: p.situacao,
                            imported_at: new Date().toISOString(),
                            
                            contact_id: p.cliente.codigo || null,
                            contact_name: p.cliente.nome,
                            cpf_cnpj: p.cliente.cpf_cnpj,
                            email: p.cliente.email,
                            phone: p.cliente.fone || p.cliente.celular,
                            
                            address: p.cliente.endereco,
                            address_number: p.cliente.numero,
                            neighborhood: p.cliente.bairro,
                            city: p.cliente.cidade,
                            state: p.cliente.uf,
                            zip_code: p.cliente.cep,
                            complement: p.cliente.complemento,
                            
                            sku: i.codigo,
                            description: i.descricao,
                            quantity: Number(i.quantidade || 0),
                            unit_price: Number(i.valor_unitario || 0),
                            
                            total_amount: Number(i.valor_total || (Number(i.quantidade) * Number(i.valor_unitario))),
                            total_freight: Number(p.valor_frete || 0),
                            total_discount: Number(p.valor_desconto || 0),
                            
                            sales_rep: p.vendedor || 'Tiny ERP'
                        });
                    });
                } else if (jsonDetalhe.retorno.status === 'Erro' && jsonDetalhe.retorno.erros[0].erro.includes("Bloqueada")) {
                     console.warn("Bloqueio detectado no detalhe. Parando.");
                     stopExecution = true;
                     break;
                }

            } catch (err) {
                console.error(`Erro processando pedido ${idPedido}:`, err);
            }
        }

        totalProcessado += listaPedidos.length;
        console.log(`Pagina ${pagina} OK.`);
        pagina++; // Prepara próxima página se houver tempo
    }

    // Salvamento Final
    console.log(`3. Salvando ${allRows.length} linhas processadas...`);
    if (allRows.length > 0) {
        const { error, count } = await supabase
            .from('sales_history')
            .upsert(allRows, { onConflict: 'external_id', count: 'exact' });
        
        if (error) {
            console.error("Erro Supabase:", error);
            throw error;
        }
    }

    return new Response(
      JSON.stringify({ 
          message: stopExecution 
            ? `Sincronização Parcial (Segurança): ${allRows.length} itens salvos. Clique novamente para continuar.` 
            : `Sincronização Completa! ${allRows.length} itens salvos.`, 
          upserted_count: allRows.length,
          partial: stopExecution
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error("ERRO FATAL:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
