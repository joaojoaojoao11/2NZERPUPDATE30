import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Delay para respeitar o limite de requisições do Tiny (evita erro 429)
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

Deno.serve(async (req) => {
  // Marca o início para controlar o tempo limite
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
    console.log(`1. Iniciando Sincronização Inteligente Tiny -> NZERP...`);

    let pagina = 1;
    const itemsPorPagina = 30; // Lote seguro
    let stopExecution = false;
    let totalSalvo = 0;
    let totalIgnorado = 0;
    const allRows: any[] = [];

    // --- LOOP DE PÁGINAS ---
    while (!stopExecution) {
        // Verifica tempo limite (45s de segurança)
        if ((performance.now() - startTime) > 45000) {
            console.log("Tempo limite atingido. Encerrando ciclo.");
            break;
        }

        console.log(`--- Analisando Página ${pagina}...`);
        
        // 1. Busca lista da página atual
        const urlBusca = new URL('https://api.tiny.com.br/api2/pedidos.pesquisa.php');
        urlBusca.searchParams.set('token', token);
        urlBusca.searchParams.set('formato', 'json');
        urlBusca.searchParams.set('limit', String(itemsPorPagina));
        urlBusca.searchParams.set('pagina', String(pagina));

        const resBusca = await fetch(urlBusca.toString());
        const jsonBusca = await resBusca.json();

        if (jsonBusca.retorno.status === 'Erro') {
            if (jsonBusca.retorno.codigo_erro == 20) {
                console.log("Fim do histórico de pedidos.");
                stopExecution = true;
                break;
            }
            // Se der erro de API, paramos sem quebrar tudo
            console.warn(`Aviso Tiny: ${jsonBusca.retorno.erros[0].erro}`);
            stopExecution = true;
            break;
        }

        const listaPedidos = jsonBusca.retorno.pedidos || [];
        if (listaPedidos.length === 0) {
            stopExecution = true;
            break;
        }

        // 2. VERIFICAÇÃO INTELIGENTE (O Pulo do Gato 🐈)
        // Extrai os números dos pedidos dessa página
        const numerosPedidos = listaPedidos.map((i: any) => String(i.pedido.numero));
        
        // Consulta no banco quais desses já existem
        const { data: existentes } = await supabase
            .from('sales_history')
            .select('order_number, status')
            .in('order_number', numerosPedidos);

        // Cria um mapa para busca rápida: { '123': 'Entregue', '124': 'Aprovado' }
        const mapaExistentes = new Map();
        existentes?.forEach((row: any) => {
            mapaExistentes.set(row.order_number, row.status);
        });

        // Filtra: Só processa o que NÃO existe ou o que MUDOU de status
        const pedidosParaProcessar = listaPedidos.filter((i: any) => {
            const numero = String(i.pedido.numero);
            const statusTiny = i.pedido.situacao;
            const statusBanco = mapaExistentes.get(numero);

            // Se não existe no banco, processa.
            if (!statusBanco) return true;
            // Se existe mas o status mudou (ex: era 'Aprovado' virou 'Enviado'), processa.
            if (statusBanco !== statusTiny) return true;
            
            // Se é igual, ignora.
            return false;
        });

        const ignoradosNessaPagina = listaPedidos.length - pedidosParaProcessar.length;
        totalIgnorado += ignoradosNessaPagina;

        if (pedidosParaProcessar.length === 0) {
            console.log(`>> Página ${pagina} 100% sincronizada. Pulando para a próxima...`);
            pagina++;
            continue; // PULA IMEDIATAMENTE PARA A PRÓXIMA PÁGINA
        }

        console.log(`>> Processando ${pedidosParaProcessar.length} novos/atualizados (Ignorados: ${ignoradosNessaPagina})...`);

        // 3. Busca detalhes APENAS dos necessários
        for (const itemLista of pedidosParaProcessar) {
            // Verifica tempo dentro do loop
            if ((performance.now() - startTime) > 48000) {
                stopExecution = true;
                break;
            }

            const idPedido = itemLista.pedido.id;
            
            try {
                // Delay necessário para pegar detalhes
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
                            sales_rep: p.vendedor || 'Tiny ERP'
                        });
                    });
                }
            } catch (err) {
                console.error(`Erro pedido ${idPedido}:`, err);
            }
        }

        pagina++; // Prepara próxima página
    }

    // 4. Salva o lote acumulado
    if (allRows.length > 0) {
        const { error, count } = await supabase
            .from('sales_history')
            .upsert(allRows, { onConflict: 'external_id', count: 'exact' });
        
        if (error) {
            console.error("Erro Supabase:", error);
            throw error;
        }
        totalSalvo = allRows.length;
    }

    return new Response(
      JSON.stringify({ 
          message: `Ciclo concluído! Salvos: ${totalSalvo}. Já sincronizados (pulo): ${totalIgnorado}.`, 
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
