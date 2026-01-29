
import { CRMOpportunity } from '../types';

const TINY_API_URL = '/api/tiny'; // Usa o proxy configurado no Vite
const TOKEN = import.meta.env.VITE_TINY_TOKEN;

// Tipos básicos de resposta do Tiny (Simplificado)
interface TinyResponse<T> {
    retorno: {
        status: string; // "OK" ou "Erro"
        codigo_erro?: number;
        erros?: { erro: string }[];
        [key: string]: any;
    }
}

interface TinyClient {
    id: string;
    nome: string;
    fantasia?: string;
    cpf_cnpj?: string;
    email?: string;
    fone?: string;
}

interface TinyOrder {
    id: string;
    numero: string;
    data_pedido: string;
    valor_total: number;
    situacao: string; // ex: "faturado", "cancelado"
}

export const TinyService = {
    /**
     * Busca um cliente no Tiny pelo nome ou CPF/CNPJ
     */
    async searchClient(query: string): Promise<TinyClient | null> {
        if (!TOKEN) {
            console.warn("VITE_TINY_API_TOKEN não configurado.");
            return null;
        }

        try {
            const params = new URLSearchParams({
                token: TOKEN,
                pesquisa: query,
                formato: 'json'
            });

            // Endpoint: clientes.pesquisa
            const response = await fetch(`${TINY_API_URL}/clientes.pesquisa.php?${params.toString()}`);
            const data: TinyResponse<{ clientes: { cliente: TinyClient }[] }> = await response.json();

            if (data.retorno.status === 'OK' && data.retorno.clientes) {
                // Retorna o primeiro match exato ou aproximado
                return data.retorno.clientes[0].cliente;
            }
            return null;
        } catch (error) {
            console.error("Erro ao buscar cliente no Tiny:", error);
            return null;
        }
    },

    /**
     * Busca o histórico de pedidos de um cliente para calcular LTV e produtos
     */
    async getClientHistory(clientId: string, clientName: string) {
        if (!TOKEN) return null;

        try {
            // Buscar pedidos do cliente (usando nome ou ID se suportado, a busca de pedidos geralmente aceita nome_cliente)
            const params = new URLSearchParams({
                token: TOKEN,
                cliente: clientName, // Tiny busca por string aproximada no campo cliente
                formato: 'json'
            });

            const response = await fetch(`${TINY_API_URL}/pedidos.pesquisa.php?${params.toString()}`);
            const data: TinyResponse<{ pedidos: { pedido: TinyOrder }[] }> = await response.json();

            if (data.retorno.status !== 'OK' || !data.retorno.pedidos) {
                return { ltv: 0, lastPurchase: null, products: [] };
            }

            // Filtrar apenas pedidos válidos (faturados, aprovados, entregues - ignorar cancelados)
            const validOrders = data.retorno.pedidos
                .map(p => p.pedido)
                .filter(p => !['cancelado', 'analise'].includes(p.situacao.toLowerCase()));

            // Calcular LTV
            const ltv = validOrders.reduce((acc, order) => acc + Number(order.valor_total), 0);

            // Pegar última compra
            const sortedOrders = validOrders.sort((a, b) =>
                new Date(b.data_pedido).getTime() - new Date(a.data_pedido).getTime()
            );
            const lastPurchaseDate = sortedOrders.length > 0 ? sortedOrders[0].data_pedido : null;

            // TODO: Se quisermos detalhe dos produtos, teríamos que chamar item a item (pedido.obter).
            // Por enquanto, vamos retornar estatísticas agregadas para não estourar limite de chamadas.

            return {
                ltv,
                lastPurchaseDate,
                orderCount: validOrders.length
            };

        } catch (error) {
            console.error("Erro ao buscar histórico Tiny:", error);
            return null;
        }
    },

    /**
     * Função auxiliar para enriquecer uma Oportunidade CRM com dados do Tiny
     */
    async enrichOpportunity(opp: CRMOpportunity): Promise<Partial<CRMOpportunity>> {
        const client = await this.searchClient(opp.clientName);
        if (!client) return {};

        const history = await this.getClientHistory(client.id, client.nome);
        if (!history) return {};

        return {
            ltv: history.ltv,
            lastPurchaseDate: history.lastPurchaseDate || undefined,
            // Adiciona tag TINY se encontrou
            tags: opp.tags ? [...new Set([...opp.tags, 'TINY_INTEGRATED'])] : ['TINY_INTEGRATED']
        };
    },

    /**
     * Busca os clientes mais recentes cadastrados no Tiny
     * @param days Número de dias para olhar para trás (aproximado) ou limite de registros
     */
    async getRecentClients(): Promise<any[]> { // Retorna array de Clients parciais
        console.log("[TinyService] Iniciando busca de clientes...");
        if (!TOKEN) {
            console.error("[TinyService] ERRO: Token não encontrado. Verifique VITE_TINY_TOKEN no .env.local");
            return [];
        }

        try {
            // Tentando busca vazia para trazer qualquer coisa. 
            // Se falhar, tente uma busca por letra comum 'a' ou remover o param.
            const params = new URLSearchParams({
                token: TOKEN,
                formato: 'json'
            });
            // Opcional: Se a API exigir pesquisa,            // Endpoint CORRETO: contatos.pesquisa.php (Validado via script de teste)
            const url = `${TINY_API_URL}/contatos.pesquisa.php?${params.toString()}`;
            console.log(`[TinyService] Fetching: ${url}`);

            const response = await fetch(url);
            const textRaw = await response.text(); // Pega texto puro para debug
            console.log(`[TinyService] Response Raw:`, textRaw.substring(0, 500)); // Log parcial

            let data;
            try {
                data = JSON.parse(textRaw);
            } catch (e) {
                console.error("[TinyService] Erro ao fazer parse JSON:", e);
                return [];
            }

            if (data.retorno.status === 'OK' && data.retorno.contatos) {
                console.log(`[TinyService] Sucesso! ${data.retorno.contatos.length} clientes encontrados.`);
                return data.retorno.contatos.map((w: any) => {
                    const c = w.contato;
                    // Mapping address data if available
                    // Tiny usually returns: endereco, numero, complemento, bairro, cep, cidada, uf in detail or sometimes in list depending on version.
                    // V2 Contatos search usually returns basic info.
                    return {
                        nome: c.nome,
                        fantasia: c.fantasia,
                        cpf_cnpj: c.cpf_cnpj,
                        email: c.email,
                        telefone: c.fone,
                        cidade: c.cidade,
                        estado: c.uf,
                        id_tiny: c.id
                    };
                });
            } else {
                console.warn("[TinyService] API retornou status diferente de OK ou sem clientes:", data);

                // --- FALLBACK: Tentar busca por nome comum "Silva" ou "A" se a busca vazia falhar ---
                if (data.retorno.status === 'Erro') {
                    console.log("[TinyService] Tentando estratégia de fallback (busca por 'A')...");
                    const params2 = new URLSearchParams({ token: TOKEN, pesquisa: 'a', formato: 'json' });
                    const res2 = await fetch(`${TINY_API_URL}/contatos.pesquisa.php?${params2.toString()}`);
                    const data2 = await res2.json();
                    if (data2.retorno.status === 'OK' && data2.retorno.contatos) {
                        return data2.retorno.contatos.map((w: any) => ({
                            nome: w.contato.nome,
                            fantasia: w.contato.fantasia,
                            cpf_cnpj: w.contato.cpf_cnpj,
                            email: w.contato.email,
                            telefone: w.contato.fone,
                            cidade: w.contato.cidade,
                            estado: w.contato.uf,
                            id_tiny: w.contato.id
                        }));
                    }
                }
            }
            return [];
        } catch (error) {
            console.error("Erro ao buscar clientes recentes no Tiny:", error);
            return [];
        }
    },

    /**
     * Busca clientes no Tiny por termo específico para importação manual
     */
    async searchFullClients(query: string): Promise<any[]> {
        if (!TOKEN || !query) return [];
        try {
            const params = new URLSearchParams({
                token: TOKEN,
                pesquisa: query,
                formato: 'json'
            });
            const url = `${TINY_API_URL}/contatos.pesquisa.php?${params.toString()}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.retorno.status === 'OK' && data.retorno.contatos) {
                return data.retorno.contatos.map((w: any) => {
                    const c = w.contato;
                    return {
                        nome: c.nome,
                        fantasia: c.fantasia,
                        cpf_cnpj: c.cpf_cnpj,
                        email: c.email,
                        telefone: c.fone,
                        cidade: c.cidade,
                        estado: c.uf,
                        id_tiny: c.id
                    };
                });
            }
            return [];
        } catch (error) {
            console.error("Erro ao buscar clientes FULL no Tiny:", error);
            return [];
        }
    },

    /**
     * Busca histórico de vendas detalhado para exibição no CRM
     */
    async getClientSales(cpfCnpj: string, clientName: string): Promise<any[]> {
        if (!TOKEN) return [];
        try {
            // Tenta buscar por CPF/CNPJ primeiro se válido, senão Nome
            const query = (cpfCnpj && cpfCnpj.length > 5) ? cpfCnpj.replace(/\D/g, '') : clientName;

            const params = new URLSearchParams({
                token: TOKEN,
                cliente: query,
                formato: 'json'
            });

            // Note: Tiny API 'pedidos.pesquisa' searches by client name or CPF/CNPJ in the 'cliente' field often matches better with name.
            // If CPF fails, we might need a specific filter or strictly use name.

            const response = await fetch(`${TINY_API_URL}/pedidos.pesquisa.php?${params.toString()}`);
            const data = await response.json();

            if (data.retorno.status === 'OK' && data.retorno.pedidos) {
                return data.retorno.pedidos.map((p: any) => {
                    // Fallback para diferentes nomes de campo possíveis
                    let val = p.pedido.valor_total || p.pedido.valor || p.pedido.total_venda || 0;

                    // console.log(`[Tiny Debug] ID: ${p.pedido.id} Raw:`, val); // Descomente para debug

                    let numVal = 0;
                    if (typeof val === 'number') {
                        numVal = val;
                    } else if (val) {
                        let v = String(val).trim();
                        // Remove R$, espaços e chars estranhos, mantendo apenas digitos, ponto, virgula e menos
                        v = v.replace(/[^\d.,-]/g, '');

                        if (v.indexOf(',') > -1 && v.indexOf('.') > -1) {
                            if (v.indexOf(',') > v.indexOf('.')) {
                                // Formato BR: 1.000,00 -> virgula é decimal
                                v = v.replace(/\./g, '').replace(',', '.');
                            } else {
                                // Formato US: 1,000.00 -> ponto é decimal
                                v = v.replace(/,/g, '');
                            }
                        } else if (v.indexOf(',') > -1) {
                            // Apenas virgula: 100,00 -> vira 100.00
                            v = v.replace(',', '.');
                        }
                        // else: Apenas ponto ou sem separador -> parseFloat nativo resolve

                        numVal = parseFloat(v);
                    }

                    return {
                        id: p.pedido.id,
                        numero: p.pedido.numero,
                        data: p.pedido.data_pedido || '',
                        valor: isNaN(numVal) ? 0 : numVal,
                        situacao: p.pedido.situacao
                    };
                });
            }
            return [];
        } catch (error) {
            console.error("Erro ao buscar vendas do cliente no Tiny:", error);
            return [];
        }
    }
};
