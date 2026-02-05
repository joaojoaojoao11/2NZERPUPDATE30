import { supabaseClient } from './core';
import { PricingScenario, PricingGridItem, User } from '../types';

export class PricingService {
    /**
     * Calcula a engenharia de preços para um item.
     * Lógica baseada na estrutura da planilha oficial.
     */
    static calculatePricing(data: Partial<PricingScenario>, difalRate: number = 0): Partial<PricingScenario> {
        const d = { ...data };

        // 1. Parâmetros Base
        const custoMetroBase = Number(d.custo_rolo_base || 0); // Custo Metro
        const metragem = Number(d.metragem_padrao_ml || 0); // Metragem Padrão

        // 2. Custo Metro Bruto (custo_total_calculado)
        let custoMetroBruto = custoMetroBase;
        if (d.tem_difal && difalRate > 0) {
            custoMetroBruto = custoMetroBase * (1 + (difalRate / 100));
        }
        d.custo_total_calculado = custoMetroBruto;

        // 3. Custo do Rolo (Base para cálculos de rolo)
        const custoRoloTotal = custoMetroBruto * metragem;

        // --- CÁLCULOS DE ROLO ---

        // 4. Preço Rolo (A) - Atacado
        // MKP ROLO (A) -> usa o campo mkp_min_atacado
        if (d.mkp_min_atacado) {
            d.preco_venda_min_atacado = custoRoloTotal * Number(d.mkp_min_atacado);
        }

        // 5. Preço Rolo (V) - Varejo
        // MKP ROLO (V) -> usa o campo mkp_ideal_atacado
        if (d.mkp_ideal_atacado) {
            d.preco_venda_ideal_atacado = custoRoloTotal * Number(d.mkp_ideal_atacado);
        } // Se não tiver markup, não calcula preço

        // --- CÁLCULOS FRACIONADO (POR METRO) ---

        // 6. Preço Frac. (A) - Atacado
        // MKP FRAC. (A) -> usa o campo mkp_min_fracionado
        // Preço composto por: Custo Metro Bruto + Margem (Assumindo multiplicação de markup)
        if (d.mkp_min_fracionado) {
            d.preco_venda_min_fracionado = custoMetroBruto * Number(d.mkp_min_fracionado);
        }

        // 7. Preço Frac. (V) - Varejo
        // MKP FRAC. (V) -> usa o campo mkp_ideal_fracionado
        if (d.mkp_ideal_fracionado) {
            d.preco_venda_ideal_fracionado = custoMetroBruto * Number(d.mkp_ideal_fracionado);
            d.venda_ideal_metro = d.preco_venda_ideal_fracionado;
        }

        // Limpeza de campos legados que não devem ser salvos mas podem ser úteis no front
        d.custo_metro_bobina = custoMetroBruto;
        d.custo_metro_fracionado = custoMetroBruto;

        return d;
    }

    /**
     * Busca a grade completa unindo Catálogo Mestre e Engenharia de Preços
     */
    static async getPricingGrid(): Promise<PricingGridItem[]> {
        if (!supabaseClient) return [];

        try {
            // Busca todos os produtos do catálogo
            const { data: products, error: pError } = await supabaseClient
                .from('master_catalog')
                .select('*')
                .eq('active', true);

            if (pError) throw pError;

            // Busca dados de engenharia
            const { data: pricing, error: prError } = await supabaseClient
                .from('pricing_engineering')
                .select('*');

            if (prError) throw prError;

            // Unir os dados mapeando para o tipo MasterProduct
            return (products || []).map(p => ({
                sku: p.sku,
                id_tiny: p.id_tiny,
                nome: p.nome,
                categoria: p.categoria,
                marca: p.marca,
                fornecedor: p.fornecedor,
                larguraL: Number(p.largura_l),
                metragemPadrao: Number(p.metragem_padrao),
                estoqueMinimo: Number(p.estoque_minimo),
                custoUnitario: Number(p.custo_unitario),
                active: p.active,
                updatedAt: p.updated_at,
                // Adiciona o objeto de precificação se existir
                pricing: pricing?.find(pr => pr.sku === p.sku)
            }));
        } catch (error) {
            console.error('Erro ao buscar grid de precificação:', error);
            return [];
        }
    }

    /**
     * Salva alterações em lote (Upsert)
     */
    static async updatePricingBatch(items: Partial<PricingScenario>[], user: User): Promise<{ success: boolean; message: string }> {
        if (!supabaseClient) return { success: false, message: 'Supabase não inicializado' };

        try {
            // LISTA BRANCA (Allowlist) de colunas que REALMENTE existem na tabela pricing_engineering
            const allowedColumns = [
                'sku',
                'id_tiny',
                'promocao',
                'largura_l',
                'metragem_padrao_ml',
                'custo_rolo_base',
                'custo_total_calculado',
                'tem_difal',
                'custo_extra_frete',
                'mkp_min_atacado',
                'mkp_ideal_atacado',
                'preco_venda_min_atacado',
                'preco_venda_ideal_atacado',
                'mkp_min_fracionado',
                'mkp_ideal_fracionado',
                'preco_venda_min_fracionado',
                'preco_venda_ideal_fracionado'
            ];

            const cleanItems = items.map(item => {
                const cleanItem: any = {};

                // Copia apenas campos permitidos e sanitiza valores
                allowedColumns.forEach(key => {
                    const value = (item as any)[key];
                    // Se for número e for NaN, converte para null
                    if (typeof value === 'number' && isNaN(value)) {
                        cleanItem[key] = null;
                    } else if (value !== undefined) {
                        cleanItem[key] = value;
                    }
                });

                // Garante que o SKU esteja presente
                if (item.sku) cleanItem.sku = item.sku;

                return cleanItem;
            });

            const { error } = await supabaseClient
                .from('pricing_engineering')
                .upsert(cleanItems, { onConflict: 'sku' });

            if (error) {
                console.error('Supabase Upsert Error (Detailed):', error.message, error.details, error.hint);
                throw error;
            }

            return { success: true, message: 'Dados de engenharia atualizados com sucesso!' };
        } catch (error: any) {
            console.error('Erro CRÍTICO no updatePricingBatch:', error);
            return { success: false, message: `Erro ao salvar: ${error.message || 'Erro desconhecido'}` };
        }
    }
}
