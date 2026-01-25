import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Delay para não bloquear a API do Tiny
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

    // Limpeza do Token
    let token = TOKEN_TINY;
    if (TOKEN_TINY.includes("=")) {
        token = TOKEN_TINY.split('=').pop()?.trim() || token;
    }
    token = token.trim();

    console.log(`1. Iniciando busca AMPLA no Tiny...`);

    // 1. BUSCA LISTA DE PEDIDOS
    const urlBusca = new URL('https://api.tiny.com.br/api2/pedidos.pesquisa.php');
    urlBusca.searchParams.set('token', token);
    urlBusca.searchParams.set('formato', 'json');
    // REMOVIDO: urlBusca.searchParams.set('situacao', 'aprovado'); -> Agora traz tudo!
    urlBusca.searchParams.set('limit', '50'); // Aumentado para 50 para pegar mais histórico

    const resBusca = await fetch(urlBusca.toString());
    const jsonBusca = await resBusca.json();

    if (jsonBusca.retorno.status === 'Erro') {
        if (jsonBusca.retorno.codigo_erro == 20) { 
            return new Response(JSON.stringify({ message: 'Nenhum pedido encontrado no Tiny.' }), { headers: corsHeaders });
        }
        throw new Error(`Erro Tiny Busca: ${jsonBusca.retorno.erros[0].erro}`);
    }

    const listaPedidos = jsonBusca.retorno.pedidos || [];
    console.log(`2. Lista recebida: ${listaPedidos.length} pedidos. Buscando detalhes...`);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const allRows: any[] = [];

    // 2. DETALHAMENTO DOS PEDIDOS
    for (const item of listaPedidos) {
        const idPedido = item.pedido.id;
        
        const urlDetalhe = new URL('https://api.tiny.com.br/api2/pedido.obter.php');
        urlDetalhe.searchParams.set('token', token);
        urlDetalhe.searchParams.set('id', idPedido);
        urlDetalhe.searchParams.set('formato', 'json');

        const resDetalhe = await fetch(urlDetalhe.toString());
        const jsonDetalhe = await resDetalhe.json();

        // Delay preventivo
        await delay(400); 

        if (jsonDetalhe.retorno.status === 'OK') {
            const p = jsonDetalhe.retorno.pedido;
            
            // Tratamento de data robusto
            let dataVendaISO = new Date().toISOString();
            if (p.data_pedido) {
                // Converte dd/mm/aaaa para aaaa-mm-dd
                const parts = p.data_pedido.split('/');
                if (parts.length === 3) {
                    dataVendaISO = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).toISOString();
                }
            }

            // Garante que existe array de itens
            const itens = p.itens || [{ item: { codigo: 'GENERICO', descricao: 'Descrição não disponível', quantidade: 1, valor_unitario: p.valor_total } }];

            for (const i of itens) {
                const prod = i.item;
                
                allRows.push({
                    external_id: `TINY-${p.id}-${prod.codigo || 'GEN'}`,
                    order_number: String(p.numero),
                    sale_date: dataVendaISO,
                    status: p.situacao, // Agora vai vir "Faturado", "Entregue", etc.
                    notes: p.obs || '',
                    
                    // Cliente
                    contact_id: p.cliente.codigo || null,
                    contact_name: p.cliente.nome,
                    cpf_cnpj: p.cliente.cpf_cnpj,
                    email: p.cliente.email,
                    phone: p.cliente.fone,
                    
                    // Endereço
                    address: p.cliente.endereco,
                    address_number: p.cliente.numero,
                    neighborhood: p.cliente.bairro,
                    city: p.cliente.cidade,
                    state: p.cliente.uf,
                    zip_code: p.cliente.cep,
                    
                    // Produto
                    sku: prod.codigo,
                    description: prod.descricao,
                    quantity: Number(prod.quantidade || 0),
                    unit_price: Number(prod.valor_unitario || 0),
                    
                    // Financeiro
                    total_amount: Number(prod.valor_total || (prod.quantidade * prod.valor_unitario)),
                    total_freight: Number(p.valor_frete || 0), 
                    order_discount: Number(p.valor_desconto || 0),
                    
                    sales_rep: p.ecommerce || 'Tiny ERP', 
                    imported_at: new Date().toISOString()
                });
            }
        }
    }

    console.log(`3. Salvando ${allRows.length} linhas detalhadas...`);

    if (allRows.length > 0) {
        const { error, count } = await supabase
            .from('sales_history')
            .upsert(allRows, { onConflict: 'external_id', count: 'exact' });

        if (error) throw error;

        return new Response(
            JSON.stringify({ message: 'Sincronização Completa!', upserted_count: count }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    return new Response(
        JSON.stringify({ message: 'Conexão OK. Nenhum dado novo processado.', upserted_count: 0 }),
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
