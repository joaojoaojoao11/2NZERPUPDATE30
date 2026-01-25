import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

Deno.serve(async (req) => {
  const startTime = performance.now();

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
    console.log(`1. Iniciando Sincronização Corretiva Tiny -> NZERP...`);

    let pagina = 1;
    const itemsPorPagina = 30; 
    let stopExecution = false;
    let totalSalvo = 0;
    let totalIgnorado = 0;
    const allRows: any[] = [];

    while (!stopExecution) {
        if ((performance.now() - startTime) > 45000) {
            console.log("Tempo limite de segurança atingido.");
            break;
        }

        console.log(`--- Analisando Página ${pagina}...`);
        
        const urlBusca = new URL('https://api.tiny.com.br/api2/pedidos.pesquisa.php');
        urlBusca.searchParams.set('token', token);
        urlBusca.searchParams.set('formato', 'json');
        urlBusca.searchParams.set('limit', String(itemsPorPagina));
        urlBusca.searchParams.set('pagina', String(pagina));

        const resBusca = await fetch(urlBusca.toString());
        const jsonBusca = await resBusca.json();

        if (jsonBusca.retorno.status === 'Erro') {
            if (jsonBusca.retorno.codigo_erro == 20) {
                console.log("Fim do histórico.");
                stopExecution = true;
                break;
            }
            console.warn(`Aviso Tiny: ${jsonBusca.retorno.erros[0].erro}`);
            stopExecution = true;
            break;
        }

        const listaPedidos = jsonBusca.retorno.pedidos || [];
        if (listaPedidos.length === 0) {
            stopExecution = true;
            break;
        }

        // --- INTELIGÊNCIA APRIMORADA (Status + Vendedor) ---
        const numerosPedidos = listaPedidos.map((i: any) => String(i.pedido.numero));
        
        // Agora buscamos também o 'sales_rep' para conferir se está genérico
        const { data: existentes } = await supabase
            .from('sales_history')
            .select('order_number, status, sales_rep')
            .in('order_number', numerosPedidos);

        const mapaExistentes = new Map();
        existentes?.forEach((row: any) => {
            // Guardamos um objeto com status e vendedor
            mapaExistentes.set(row.order_number, { status: row.status, vendedor: row.sales_rep });
        });

        // Filtro Inteligente
        const pedidosParaProcessar = listaPedidos.filter((i: any) => {
            const numero = String(i.pedido.numero);
            const statusTiny = i.pedido.situacao;
            const dadosBanco = mapaExistentes.get(numero);

            // 1. Se não existe no banco, processa (Novo)
            if (!dadosBanco) return true;

            // 2. Se o status mudou, processa (Atualização)
            if (dadosBanco.status !== statusTiny) return true;

            // 3. Se o Vendedor no banco é o genérico "Tiny ERP", FORÇA A ATUALIZAÇÃO
            //    (Isso vai corrigir os nomes que ficaram errados)
            if (dadosBanco.vendedor === 'Tiny ERP') return true;
            
            // Se tudo estiver certo e igual, ignora
            return false;
        });

        const ignoradosNessaPagina = listaPedidos.length - pedidosParaProcessar.length;
        totalIgnorado += ignoradosNessaPagina;

        if (pedidosParaProcessar.length === 0) {
            console.log(`>> Página ${pagina} perfeita. Pulando...`);
            pagina++;
            continue; 
        }

        console.log(`>> Processando ${pedidosParaProcessar.length} pedidos (Novos/Correções)...`);

        for (const itemLista of pedidosParaProcessar) {
            if ((performance.now() - startTime) > 48000) {
                stopExecution = true;
                break;
            }

            const idPedido = itemLista.pedido.id;
            
            try {
                await delay(1500); 
                
                const urlDetalhe = new URL('https://api.tiny.com.br/api2/pedido.obter.php');
                urlDetalhe.searchParams.set('token', token);
                urlDetalhe.searchParams.set('id', idPedido);
                urlDetalhe.searchParams.set('formato', 'json');

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

                    // Tenta encontrar o nome correto em vários campos
                    const vendedorFinal = p.nome_vendedor || p.vendedor || p.ecommerce || 'Tiny ERP';

                    const itens = p.itens || [{ item: { codigo: 'GEN', descricao: 'Item Genérico', quantidade: 1, valor_unitario: p.valor_total } }];

                    itens.forEach((wrapper: any, index: number) => {
                        const i = wrapper.item;
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
                            sales_rep: vendedorFinal // Atualiza o nome aqui
                        });
                    });
                }
            } catch (err) {
                console.error(`Erro pedido ${idPedido}:`, err);
            }
        }

        pagina++; 
    }

    if (allRows.length > 0) {
        const { error, count } = await supabase
            .from('sales_history')
            .upsert(allRows, { onConflict: 'external_id', count: 'exact' });
        
        if (error) throw error;
        totalSalvo = allRows.length;
    }

    return new Response(
      JSON.stringify({ 
          message: `Processado! Salvos/Corrigidos: ${totalSalvo}. Ignorados: ${totalIgnorado}.`, 
          upserted_count: totalSalvo,
          skipped_count: totalIgnorado,
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
