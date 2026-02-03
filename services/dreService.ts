
import { supabaseClient } from './core';
import { AccountsPayable, AccountsReceivable, DREMapping, DREReportItem } from '../types';

export class DREService {

    // --- 1. MAPPING ENGINE ---

    /**
     * Checks for categories in the period that haven't been mapped yet.
     */
    static async checkUnmappedCategories(startDate: string, endDate: string): Promise<string[]> {
        // 1. Fetch distinct categories from AP and AR for the period
        const { data: apData } = await supabaseClient
            .from('accounts_payable')
            .select('categoria')
            .gte('competencia', startDate.substring(0, 7))
            .lte('competencia', endDate.substring(0, 7));

        const { data: arData } = await supabaseClient
            .from('accounts_receivable')
            .select('Categoria') // Note case sensitivity in DB
            .gte('Competência', startDate.substring(0, 7))
            .lte('Competência', endDate.substring(0, 7))
            .neq('Situação', 'Cancelada');

        const uniqueCategories = new Set<string>();
        apData?.forEach((r: any) => { if (r.categoria) uniqueCategories.add(r.categoria) });
        arData?.forEach((r: any) => { if (r.Categoria) uniqueCategories.add(r.Categoria) });

        // 2. Fetch existing mappings
        const { data: existingMappings } = await supabaseClient
            .from('dre_category_mappings')
            .select('original_category_name');

        const mappedSet = new Set(existingMappings?.map(m => m.original_category_name) || []);

        // 3. Diff
        const unmapped: string[] = [];
        uniqueCategories.forEach(cat => {
            if (!mappedSet.has(cat)) unmapped.push(cat);
        });

        return unmapped;
    }

    /**
     * Uses heuristics (Keywords) to suggest a DRE Group for a new category.
     */
    static autoSuggestMapping(categoryName: string): Partial<DREMapping> {
        const lower = categoryName.toLowerCase();

        // --- RECEITAS ---
        if (lower.includes('venda') || lower.includes('pedido') || lower.includes('faturamento'))
            return { dre_group: 'RECEITA_BRUTA', dre_subgroup: 'Venda de Mercadorias' };
        if (lower.includes('frete') && !lower.includes('compra'))
            return { dre_group: 'RECEITA_BRUTA', dre_subgroup: 'Receita de Fretes' };

        // --- DEDUÇÕES ---
        if (lower.includes('devolu') || lower.includes('cancel') || lower.includes('estorno'))
            return { dre_group: 'DEDUCOES', dre_subgroup: 'Devoluções e Cancelamentos' };
        if (lower.includes('imposto') || lower.includes('simples') || lower.includes('das') || lower.includes('icms'))
            return { dre_group: 'DEDUCOES', dre_subgroup: 'Impostos sobre Vendas' };

        // --- CMV ---
        if (lower.includes('import') || lower.includes('invoice') || lower.includes('despachante') || lower.includes('siscomex') || lower.includes('cambio'))
            return { dre_group: 'CMV', dre_subgroup: 'Custos de Importação' };
        if (lower.includes('compra') || lower.includes('fornecedor'))
            return { dre_group: 'CMV', dre_subgroup: 'Compras Nacionais' };

        // --- DESPESAS OPERACIONAIS ---
        // Vendas
        if (lower.includes('comiss') || lower.includes('marketing') || lower.includes('ads') || lower.includes('google') || lower.includes('facebook'))
            return { dre_group: 'DESPESAS_OPERACIONAIS', dre_subgroup: 'Despesas com Vendas' };
        // Financeiras
        if (lower.includes('tarif') || lower.includes('juro') || lower.includes('banc') || lower.includes('iof'))
            return { dre_group: 'DESPESAS_OPERACIONAIS', dre_subgroup: 'Despesas Financeiras' };

        // Default to Administrativas (Catch-all for fixed costs)
        return { dre_group: 'DESPESAS_OPERACIONAIS', dre_subgroup: 'Despesas Administrativas' };
    }

    /**
     * Saves a new user-confirmed mapping.
     */
    static async mapCategory(originalName: string, group: string, subgroup: string): Promise<void> {
        const { error } = await supabaseClient.from('dre_category_mappings').insert({
            original_category_name: originalName,
            dre_group: group,
            dre_subgroup: subgroup,
            is_verified: true
        });
        if (error) throw error;
    }


    // --- 2. REPORT GENERATION ---

    static async generateDREReport(startDate: string, endDate: string): Promise<{ report: DREReportItem[], unmapped: string[] }> {
        // 1. Get ALL data
        const { data: apData } = await supabaseClient.from('accounts_payable').select('*').gte('competencia', startDate.substring(0, 7)).lte('competencia', endDate.substring(0, 7));
        const { data: arData } = await supabaseClient.from('accounts_receivable').select('*').gte('Competência', startDate.substring(0, 7)).lte('Competência', endDate.substring(0, 7)).neq('Situação', 'Cancelada');

        // 2. Get Mappings
        const { data: mappings } = await supabaseClient.from('dre_category_mappings').select('*');
        const mapDict = new Map<string, DREMapping>();
        mappings?.forEach(m => mapDict.set(m.original_category_name, m));

        // 3. Initialize Buckets per Month
        // We need to identify all unique months in the range for the matrix
        const getMonthKey = (dateStr: string) => dateStr ? dateStr.substring(0, 7) : 'UNKNOWN';

        // Structure: Month -> Group -> Value
        const monthlyGroups: Record<string, Record<string, number>> = {};
        // Structure: Month -> Group -> Subgroup -> Value
        const monthlySubGroups: Record<string, Record<string, Record<string, number>>> = {};

        const initMonth = (m: string) => {
            if (!monthlyGroups[m]) {
                monthlyGroups[m] = {
                    'RECEITA_BRUTA': 0, 'DEDUCOES': 0, 'CMV': 0, 'DESPESAS_OPERACIONAIS': 0
                };
                monthlySubGroups[m] = {
                    'RECEITA_BRUTA': {}, 'DEDUCOES': {}, 'CMV': {}, 'DESPESAS_OPERACIONAIS': {}
                };
            }
        };

        const processItem = (category: string, value: number, date: string, type: 'IN' | 'OUT') => {
            const mapping = mapDict.get(category);
            if (!mapping) return;

            const mKey = getMonthKey(date);
            initMonth(mKey);

            const absVal = Math.abs(value);

            if (mapping.dre_group) {
                monthlyGroups[mKey][mapping.dre_group] += absVal;

                // Ensure consistent subgroup total
                const subName = mapping.dre_subgroup || 'Outros';

                if (!monthlySubGroups[mKey][mapping.dre_group][subName]) {
                    monthlySubGroups[mKey][mapping.dre_group][subName] = 0;
                }
                monthlySubGroups[mKey][mapping.dre_group][subName] += absVal;
            }
        };

        // Process Data
        const processedIds = new Set<string>();
        arData?.forEach((item: any) => {
            if (processedIds.has(item.ID)) return;
            processedIds.add(item.ID);
            if (item.Categoria) processItem(item.Categoria, Number(item['Valor documento'] || 0), item['Competência'], 'IN');
        });
        apData?.forEach((item: any) => {
            if (item.categoria) processItem(item.categoria, Number(item.valor_documento || 0), item.competencia, 'OUT');
        });

        // 4. Consolidate to Rows
        // We'll create the structure and calculate both Total (sum) and Monthly Values

        const months = Object.keys(monthlyGroups).sort();

        // Helper to get value for a specific group/subgroup across all months or specific month
        const getGroupValue = (group: string, month?: string) => {
            if (month) return monthlyGroups[month]?.[group] || 0;
            return months.reduce((acc, m) => acc + (monthlyGroups[m]?.[group] || 0), 0);
        };

        const getSubGroupValue = (group: string, subgroup: string, month?: string) => {
            if (month) return monthlySubGroups[month]?.[group]?.[subgroup] || 0;
            return months.reduce((acc, m) => acc + (monthlySubGroups[m]?.[group]?.[subgroup] || 0), 0);
        };

        const buildValuesObj = (calcFn: (m: string) => number) => {
            const obj: Record<string, number> = {};
            months.forEach(m => obj[m] = calcFn(m));
            return obj;
        };

        // --- CALCULATION LOGIC (Per Month & Total) ---
        // We define functions to calculate derived lines (Results)

        const calcReceitaLiquida = (m: string) => (monthlyGroups[m]?.['RECEITA_BRUTA'] || 0) - (monthlyGroups[m]?.['DEDUCOES'] || 0);
        const calcLucroBruto = (m: string) => calcReceitaLiquida(m) - (monthlyGroups[m]?.['CMV'] || 0);
        const calcResultado = (m: string) => calcLucroBruto(m) - (monthlyGroups[m]?.['DESPESAS_OPERACIONAIS'] || 0);

        // EXTRA CALCULATIONS FOR EBITDA & ROI
        const getFinancialExpenses = (m: string) => monthlySubGroups[m]?.['DESPESAS_OPERACIONAIS']?.['Despesas Financeiras'] || 0;

        // EBITDA = Resultado + Despesas Financeiras (Assuming Deprec is 0 or part of others not isolated)
        // Note: Ideally EBITDA ignores Taxes on Income too, but we are using Net Result + Financials here as proxy
        const calcEBITDA = (m: string) => calcResultado(m) + getFinancialExpenses(m);

        // ROI (Approximated as Return on Revenue / Net Margin for this context)
        // ROI = (Net Result / Net Revenue) * 100
        const calcROI = (m: string) => {
            const rev = calcReceitaLiquida(m);
            const res = calcResultado(m);
            return rev !== 0 ? (res / rev) * 100 : 0;
        };

        // --- BUILDING THE ROWS ---

        const createRow = (id: string, label: string, groupKey?: string, calcFn?: (m: string) => number, isPercent = false): DREReportItem => {
            const monthlyVals = buildValuesObj(m => {
                if (groupKey) return monthlyGroups[m]?.[groupKey] || 0;
                if (calcFn) return calcFn(m);
                return 0;
            });

            // For percentage rows (ROI), total logic might differ (e.g. weighted average), 
            // but for simplicity in DRE table, we often show the calculation on the Totals:
            let total = 0;
            if (isPercent) {
                // Determine Total based on Totals of components
                // ROI Total = (Total Result / Total Revenue) * 100
                const totalRev = Object.values(buildValuesObj(calcReceitaLiquida)).reduce((a, b) => a + b, 0);
                const totalRes = Object.values(buildValuesObj(calcResultado)).reduce((a, b) => a + b, 0);
                total = totalRev !== 0 ? (totalRes / totalRev) * 100 : 0;
            } else {
                total = Object.values(monthlyVals).reduce((a, b) => a + b, 0);
            }

            // SubItems logic (Only for Groups)
            let subItems: DREReportItem[] | undefined;
            if (groupKey) {
                const allSubgroups = new Set<string>();
                months.forEach(m => {
                    Object.keys(monthlySubGroups[m]?.[groupKey] || {}).forEach(s => allSubgroups.add(s));
                });

                subItems = Array.from(allSubgroups).map(subLabel => {
                    const subMonthly = buildValuesObj(m => monthlySubGroups[m]?.[groupKey]?.[subLabel] || 0);
                    const subTotal = Object.values(subMonthly).reduce((a, b) => a + b, 0);
                    return {
                        id: subLabel,
                        label: subLabel,
                        value: subTotal,
                        monthlyValues: subMonthly,
                        type: 'SUBGROUP' as const
                    };
                }).sort((a, b) => b.value - a.value);
            }

            return {
                id,
                label,
                value: total,
                monthlyValues: monthlyVals,
                type: 'GROUP',
                subItems
            };
        };

        const report = [
            createRow('RECEITA_BRUTA', 'Receita Operacional Bruta', 'RECEITA_BRUTA'),
            createRow('DEDUCOES', '(-) Deduções da Receita', 'DEDUCOES'),
            createRow('RECEITA_LIQUIDA', '(=) Receita Líquida', undefined, calcReceitaLiquida),
            createRow('CMV', '(-) Custo Mercadoria Vendida', 'CMV'),
            createRow('LUCRO_BRUTO', '(=) Lucro Bruto', undefined, calcLucroBruto),
            createRow('DESPESAS', '(-) Despesas Operacionais', 'DESPESAS_OPERACIONAIS'),
            createRow('EBITDA', '(=) EBITDA', undefined, calcEBITDA),
            createRow('RESULTADO', '(=) Resultado Líquido', undefined, calcResultado),
            createRow('ROI', 'ROI (Margem Líquida %)', undefined, calcROI, true)
        ];


        // Find Unmapped Items
        const unmapped: string[] = [];
        const checkUnmapped = (cat: string) => {
            if (cat && !mapDict.has(cat)) unmapped.push(cat);
        };
        arData?.forEach((i: any) => checkUnmapped(i.Categoria));
        apData?.forEach((i: any) => checkUnmapped(i.categoria));
        const uniqueUnmapped = Array.from(new Set(unmapped));

        return { report, unmapped: uniqueUnmapped };
    }
}
