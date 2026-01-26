import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req) => {
  // 1. Trata o Preflight (CORS) para o navegador não bloquear
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Pega as chaves corretas dos Segredos
    // OBS: Mudei para TINY_TOKEN pois o código é do Tiny
    const TOKEN_TINY = Deno.env.get('TINY_TOKEN') || ""; 
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TOKEN_TINY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(`Configuração incompleta! Verifique se TINY_TOKEN e chaves do Supabase estão nos Secrets.`);
    }

    // Limpeza do token caso venha com lixo
    let token = TOKEN_TINY;
    if (TOKEN_TINY.includes("=")) {
        token = TOKEN_TINY.split('=').pop()?.trim() || token;
    }
    token = token.trim();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log(`[TinySync] Iniciando Sincronização...`);

    let pagina = 1;
    const itemsPorPagina = 50; 
    let stopExecution = false;
    let totalSalvo = 0;
    let totalIgnorado = 0;
    const allRows: any[] = [];
    const startTime = performance.now();

    while (!stopExecution) {
        // Limite de tempo de execução (Edge Functions têm limite)
        if ((performance.now() - startTime) > 50000) {
            console.log("[TinySync] Tempo limite de segurança atingido.");
            break;
        }

        console.log(`[TinySync] Buscando Página ${pagina}...`);
        
        const urlBusca = new URL('https://api.tiny.com.br/api2/pedidos.pesquisa.php');
        urlBusca.searchParams.set('token', token);
        urlBusca.searchParams.set('formato', 'json');
        urlBusca.searchParams.set('limit', String(itemsPorPagina));
        urlBusca.searchParams.set('pagina', String(pagina));

        const resBusca = await fetch(urlBusca.toString());
        const jsonBusca = await resBusca.json();

        // Tratamento de erros da API do Tiny
        if (jsonBusca.retorno.status === 'Erro') {
            if (jsonBusca.retorno.codigo_erro == 20) { // Erro 20 = Fim da lista/Vazio
                console.log("[TinySync] Fim da lista encontrado.");
                stopExecution = true;
                break;
            }
            console.warn(`[TinySync] Aviso Tiny: ${jsonBusca.retorno.erros[0].erro}`);
            // Se for erro de token inválido, para tudo
            if (jsonBusca.retorno.erros[0].erro.includes('token')) {
                throw new Error("Token do Tiny inválido ou expirado.");
            }
            stopExecution = true;
            break;
        }

        const listaPedidos = jsonBusca.retorno.pedidos || [];
        if (listaPedidos.length === 0) {
            stopExecution = true;
            break;
        }

        console.log(`[TinySync] Processando ${listaPedidos.length} pedidos da página ${pagina}...`);

        // Busca detalhes de cada pedido
        for (const itemLista of listaPedidos) {
            const idPedido = itemLista.pedido.id;
            
            try {
                // Pequeno delay para não bloquear a API do Tiny
                // await new Promise(r => setTimeout(r, 200)); 
                
                const urlDetalhe = new URL('https://api.tiny.com.br/api2/pedido.obter.php');
                urlDetalhe.searchParams.set('token', token);
                urlDetalhe.searchParams.set('id', idPedido);
                urlDetalhe.searchParams.set('formato', 'json');

                const resDetalhe = await fetch(urlDetalhe.toString());
                const jsonDetalhe = await resDetalhe.json();

                if (jsonDetalhe.retorno.status === 'OK') {
                    const p = jsonDetalhe.retorno.pedido;
                    
                    // Tratamento de Datas
                    let dataVendaISO = new Date().toISOString();
                    if (p.data_pedido) {
                        const parts = p.data_pedido.split('/'); 
                        if (parts.length === 3) {
                            dataVendaISO = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`).toISOString();
                        }
                    }

                    // Lógica de Vendedor
                    let nomeVendedor = null;
                    if (p.nome_vendedor && p.nome_vendedor.length > 1) nomeVendedor = p.nome_vendedor;
                    if (!nomeVendedor && p.vendedor?.nome) nomeVendedor = p.vendedor.nome;
                    if (!nomeVendedor && typeof p.vendedor === 'string') nomeVendedor = p.vendedor;
                    const vendedorFinal = nomeVendedor || p.ecommerce || 'SISTEMA';

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
                            sku: i.codigo,
                            description: i.descricao,
                            quantity: Number(i.quantidade || 0),
                            unit_price: Number(i.valor_unitario || 0),
                            total_amount: Number(i.valor_total || (Number(i.quantidade) * Number(i.valor_unitario))),
                            sales_rep: vendedorFinal
                        });
                    });
                }
            } catch (err) {
                console.error(`Erro pedido ${idPedido}:`, err);
            }
        }
        pagina++; 
    }

    // Salva tudo no Banco de Dados
    if (allRows.length > 0) {
        const { error } = await supabase
            .from('sales_history')
            .upsert(allRows, { onConflict: 'external_id' });
        
        if (error) throw error;
        totalSalvo = allRows.length;
    }

    return new Response(
      JSON.stringify({ 
          message: `Sincronização Tiny Concluída!`, 
          upserted_count: totalSalvo,
          skipped_count: totalIgnorado
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error("ERRO FATAL NA FUNCTION:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});