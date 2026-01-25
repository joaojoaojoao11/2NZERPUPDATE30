import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Delay para respeitar o limite de requisições do Tiny
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

Deno.serve(async (req) => {
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
    console.log(`1. Iniciando Sincronização Tiny -> NZERP...`);

    let pagina = 1;
    const itemsPorPagina = 50; 
    let continuarBuscando = true;
    let totalProcessado = 0;
    const allRows: any[] = [];

    // --- LOOP INFINITO (Busca até acabar os pedidos) ---
    while (continuarBuscando) {
        console.log(`--- Processando Página ${pagina}...`);
        
        // 1. Busca lista de IDs
        const urlBusca = new URL('https://api.tiny.com.br/api2/pedidos.pesquisa.php');
        urlBusca.searchParams.set('token', token);
        urlBusca.searchParams.set('formato', 'json');
        urlBusca.searchParams.set('limit', String(itemsPorPagina));
        urlBusca.searchParams.set('pagina', String(pagina));
        // urlBusca.searchParams.set('dataInicial', '01/01/2025'); // Opcional: Filtro de data

        const resBusca = await fetch(urlBusca.toString());
        const jsonBusca = await resBusca.json();

        if (jsonBusca.retorno.status === 'Erro') {
            if (jsonBusca.retorno.codigo_erro == 20) {
                console.log("Fim da lista de pedidos no Tiny.");
                continuarBuscando = false;
                break;
            }
            throw new Error(`Erro Tiny Busca: ${jsonBusca.retorno.erros[0].erro}`);
        }

        const listaPedidos = jsonBusca.retorno.pedidos || [];
        if (listaPedidos.length === 0) {
            continuarBuscando = false;
            break;
        }

        // 2. Busca detalhes de cada pedido
        for (const itemLista of listaPedidos) {
            const idPedido = itemLista.pedido.id;
            
            const urlDetalhe = new URL('https://api.tiny.com.br/api2/pedido.obter.php');
            urlDetalhe.searchParams.set('token', token);
            urlDetalhe.searchParams.set('id', idPedido);
            urlDetalhe.searchParams.set('formato', 'json');

            try {
                await delay(200); // Pausa leve
                
                const resDetalhe = await fetch(urlDetalhe.toString());
                const jsonDetalhe = await resDetalhe.json();

                if (jsonDetalhe.retorno.status === 'OK') {
                    const p = jsonDetalhe.retorno.pedido;
                    
                    // Formata Data (dd/mm/aaaa -> ISO)
                    let dataVendaISO = new Date().toISOString();
                    if (p.data_pedido) {
                        const parts = p.data_pedido.split('/'); 
                        if (parts.length === 3) {
                            dataVendaISO = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`).toISOString();
                        }
                    }

                    const itens = p.itens || [{ item: { codigo: 'GEN', descricao: 'Item Genérico', quantidade: 1, valor_unitario: p.valor_total } }];

                    // PROCESSA CADA ITEM DO PEDIDO (Linhas da sua Planilha)
                    itens.forEach((wrapper: any, index: number) => {
                        const i = wrapper.item;
                        
                        // ID ÚNICO INFALÍVEL: ID_PEDIDO + ÍNDICE_DO_ITEM (ex: 388162264-1)
                        // Isso garante que se tiver 2 itens, teremos 2 linhas no banco, igual na planilha.
                        let uniqueRowId = `TINY-${p.id}-${index + 1}`; 

                        allRows.push({
                            // --- Chaves e IDs ---
                            external_id: uniqueRowId, 
                            order_number: String(p.numero),
                            product_id_external: i.id_produto ? String(i.id_produto) : null, // Coluna "ID produto"
                            
                            // --- Datas e Status ---
                            sale_date: dataVendaISO,
                            status: p.situacao, // "Em aberto", "Faturado", etc.
                            imported_at: new Date().toISOString(),
                            
                            // --- Cliente (Colunas de Contato) ---
                            contact_id: p.cliente.codigo || null,
                            contact_name: p.cliente.nome,
                            cpf_cnpj: p.cliente.cpf_cnpj,
                            email: p.cliente.email,
                            phone: p.cliente.fone || p.cliente.celular, // Tenta fone, se não tiver, celular
                            
                            // --- Endereço (Colunas de Endereço) ---
                            address: p.cliente.endereco,
                            address_number: p.cliente.numero,
                            neighborhood: p.cliente.bairro,
                            city: p.cliente.cidade,
                            state: p.cliente.uf,
                            zip_code: p.cliente.cep,
                            complement: p.cliente.complemento,
                            
                            // --- Produto (Colunas de Item) ---
                            sku: i.codigo,
                            description: i.descricao,
                            quantity: Number(i.quantidade || 0),
                            unit_price: Number(i.valor_unitario || 0),
                            
                            // --- Valores Financeiros (DRE) ---
                            // Valor Total da Linha = Qtd * Unitário
                            total_amount: Number(i.valor_total || (Number(i.quantidade) * Number(i.valor_unitario))),
                            
                            // Rateios (Valores do Pedido repetidos nas linhas para cálculo)
                            total_freight: Number(p.valor_frete || 0),
                            total_discount: Number(p.valor_desconto || 0),
                            order_freight: Number(p.valor_frete || 0),
                            order_discount: Number(p.valor_desconto || 0),
                            
                            sales_rep: p.vendedor || 'Tiny ERP' // Coluna "Vendedor"
                        });
                    });
                }
            } catch (err) {
                console.error(`Erro ao processar pedido ${idPedido}:`, err);
            }
        }

        totalProcessado += listaPedidos.length;
        console.log(`Pagina ${pagina} OK. Acumulado: ${allRows.length} linhas.`);
        
        pagina++;
        
        // SALVAMENTO EM LOTES (Para não estourar memória)
        if (allRows.length >= 200) {
             const { error } = await supabase
                .from('sales_history')
                .upsert(allRows, { onConflict: 'external_id', count: 'exact' });
             
             if (error) throw error;
             
             console.log(`LOTE SALVO: ${allRows.length} itens.`);
             allRows.length = 0; // Esvazia a memória
        }
    }

    // Salva o que sobrou no final
    if (allRows.length > 0) {
        const { error, count } = await supabase
            .from('sales_history')
            .upsert(allRows, { onConflict: 'external_id', count: 'exact' });
        
        if (error) throw error;
    }

    return new Response(
      JSON.stringify({ 
          message: 'Sincronização Completa!', 
          upserted_count: totalProcessado,
          details: 'Todos os pedidos foram importados.'
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
