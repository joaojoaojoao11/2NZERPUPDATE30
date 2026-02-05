import React, { useState, useEffect, useMemo } from 'react';
import { PricingService } from '../services/pricingService';
import { PricingGridItem, PricingScenario, User } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';

interface PricingEngineeringProps {
    user: User;
}

const PricingEngineering: React.FC<PricingEngineeringProps> = ({ user }) => {
    const [grid, setGrid] = useState<PricingGridItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterBrand, setFilterBrand] = useState('');
    const [filterSupplier, setFilterSupplier] = useState('');
    const [filterCategory, setFilterCategory] = useState('');
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
    const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [editingProduct, setEditingProduct] = useState<PricingGridItem | null>(null);
    const [showDifalSettings, setShowDifalSettings] = useState(false);
    const [difalRates, setDifalRates] = useState<Record<string, number>>({});

    // Carregar taxas salvas (Simulado com LocalStorage por enquanto para persistência imediata)
    useEffect(() => {
        const saved = localStorage.getItem('difal_rates');
        if (saved) {
            setDifalRates(JSON.parse(saved));
        }
    }, []);

    const handleSaveDifalRates = () => {
        localStorage.setItem('difal_rates', JSON.stringify(difalRates));
        setToast({ msg: 'Taxas DIFAL salvas com sucesso!', type: 'success' });
        setShowDifalSettings(false);
        // Recalcular toda a grade com as novas taxas (passando as taxas atuais explicitamente)
        recalculateAll(difalRates);
    };

    const recalculateAll = async (currentRates?: Record<string, number>) => {
        setSaving(true);
        const ratesToUse = currentRates || difalRates;

        const updates = grid.map(item => {
            if (!item.pricing) return null;
            const rate = ratesToUse[item.fornecedor || ''] || 0;
            return PricingService.calculatePricing(item.pricing, rate);
        }).filter(Boolean) as PricingScenario[];

        await PricingService.updatePricingBatch(updates, user);
        loadData();
        setSaving(false);
    };

    // Estado para larguras das colunas (Estilo Excel)
    const [colWidths, setColWidths] = useState<Record<string, number>>({
        selection: 50,
        sku: 140,
        nome: 300,
        marca: 140,
        fornecedor: 160,
        categoria: 140,
        id_tiny: 100,
        promocao: 60,
        largura_l: 80,
        metragem_padrao_ml: 80,
        tem_difal: 90,
        custo_rolo_base: 180, // CUSTO METRO (ML)
        custo_extra_frete: 140,
        custo_total_calculado: 200, // CUSTO METRO (BRUTO)

        // ROLO ATACADO
        mkp_min_atacado: 130, // MKP ROLO (A)
        preco_venda_min_atacado: 160, // PREÇO ROLO (A) (NOVO)

        // ROLO VAREJO
        mkp_ideal_atacado: 130, // MKP ROLO (V)
        preco_venda_ideal_atacado: 160, // PREÇO ROLO (V)

        // FRACIONADO ATACADO
        mkp_min_fracionado: 130, // MKP FRAC. (A)
        preco_venda_min_fracionado: 160, // PREÇO FRAC. (A) (NOVO)

        // FRACIONADO VAREJO
        mkp_ideal_fracionado: 130, // MKP FRAC. (V)
        preco_venda_ideal_fracionado: 160, // PREÇO FRAC. (V)

        actions: 70,
    });

    const [resizing, setResizing] = useState<{ col: string; startX: number; startWidth: number } | null>(null);

    const onMouseDown = (col: string, e: React.MouseEvent) => {
        setResizing({ col, startX: e.pageX, startWidth: colWidths[col] });
    };

    useEffect(() => {
        if (!resizing) return;

        const onMouseMove = (e: MouseEvent) => {
            const diff = e.pageX - resizing.startX;
            setColWidths(prev => ({
                ...prev,
                [resizing.col]: Math.max(30, resizing.startWidth + diff)
            }));
        };

        const onMouseUp = () => setResizing(null);

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [resizing]);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        const data = await PricingService.getPricingGrid();
        setGrid(data);
        setLoading(false);
    };

    const filteredGrid = useMemo(() => {
        return grid.filter(item => {
            const matchSearch = item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.nome.toLowerCase().includes(searchTerm.toLowerCase());
            const matchBrand = filterBrand === '' || item.marca === filterBrand;
            const matchSupplier = filterSupplier === '' || item.fornecedor === filterSupplier;
            const matchCategory = filterCategory === '' || item.categoria === filterCategory;
            return matchSearch && matchBrand && matchSupplier && matchCategory;
        });
    }, [grid, searchTerm, filterBrand, filterSupplier, filterCategory]);

    const brands = useMemo(() => {
        const b = new Set<string>();
        grid.forEach(item => { if (item.marca) b.add(item.marca); });
        return Array.from(b).sort();
    }, [grid]);

    const suppliers = useMemo(() => {
        const s = new Set<string>();
        grid.forEach(item => { if (item.fornecedor) s.add(item.fornecedor); });
        return Array.from(s).sort();
    }, [grid]);

    const categories = useMemo(() => {
        const c = new Set<string>();
        grid.forEach(item => { if (item.categoria) c.add(item.categoria); });
        return Array.from(c).sort();
    }, [grid]);

    const handleInputChange = (sku: string, field: keyof PricingScenario, value: any) => {
        setHasUnsavedChanges(true);
        setGrid(prev => prev.map(item => {
            // Se o item alterado está na seleção, ou se é o próprio item (caso não haja seleção ou seleção seja unitária)
            // A lógica é: se tenho itens selecionados e altero um deles, altero TODOS os selecionados.
            // Se o item alterado NÃO está na seleção, altero só ele.
            const shouldUpdate = selectedSkus.has(sku) ? selectedSkus.has(item.sku) : item.sku === sku;

            if (shouldUpdate) {
                // FALLBACK INTELIGENTE
                const currentPricing = item.pricing || {
                    sku: item.sku,
                    custo_rolo_base: Number(item.custoUnitario || 0),
                    metragem_padrao_ml: Number(item.metragemPadrao || 15)
                } as PricingScenario;

                if ((!currentPricing.custo_rolo_base || currentPricing.custo_rolo_base === 0) && item.custoUnitario) {
                    currentPricing.custo_rolo_base = Number(item.custoUnitario);
                }

                if ((!currentPricing.metragem_padrao_ml || currentPricing.metragem_padrao_ml === 0)) {
                    currentPricing.metragem_padrao_ml = Number(item.metragemPadrao || 15);
                }

                const updatedPricing = { ...currentPricing, [field]: value };
                const rate = difalRates[item.fornecedor || ''] || 0;
                const recalculated = PricingService.calculatePricing(updatedPricing, rate);

                return { ...item, pricing: recalculated as PricingScenario };
            }
            return item;
        }));
    };

    const handleToggleSelect = (sku: string) => {
        const next = new Set(selectedSkus);
        if (next.has(sku)) next.delete(sku);
        else next.add(sku);
        setSelectedSkus(next);
    };

    const handleSelectAll = () => {
        if (selectedSkus.size === filteredGrid.length) {
            setSelectedSkus(new Set());
        } else {
            setSelectedSkus(new Set(filteredGrid.map(i => i.sku)));
        }
    };

    const handleSaveIndividual = async () => {
        if (!editingProduct || !editingProduct.pricing) return;
        setSaving(true);
        // Calcula os valores antes de salvar
        const supplier = editingProduct.fornecedor || '';
        const rate = difalRates[supplier] || 0;
        const calculated = PricingService.calculatePricing(editingProduct.pricing, rate);
        const result = await PricingService.updatePricingBatch([calculated], user);

        if (result.success) {
            setToast({ msg: 'Ajuste individual salvo com sucesso!', type: 'success' });
            setEditingProduct(null);
            loadData(); // Recarrega para refletir mudanças
        } else {
            setToast({ msg: result.message, type: 'error' });
        }
        setSaving(false);
    };

    const handleBatchUpdate = (field: keyof PricingScenario, value: any) => {
        if (selectedSkus.size === 0) return;

        setGrid(prev => prev.map(item => {
            if (selectedSkus.has(item.sku)) {
                const currentPricing = item.pricing || { sku: item.sku } as PricingScenario;
                const updatedPricing = { ...currentPricing, [field]: value };
                const rate = difalRates[item.fornecedor || ''] || 0;
                const recalculated = PricingService.calculatePricing(updatedPricing, rate);
                return { ...item, pricing: recalculated as PricingScenario };
            }
            return item;
        }));

        setToast({ msg: `Atualizado ${field} para ${selectedSkus.size} itens.`, type: 'success' });
    };

    const saveChanges = async () => {
        setSaving(true);
        const itemsToSave = grid
            .filter(item => item.pricing)
            .map(item => {
                const rate = difalRates[item.fornecedor || ''] || 0;
                return PricingService.calculatePricing(item.pricing!, rate);
            });

        const result = await PricingService.updatePricingBatch(itemsToSave, user);
        setToast({ msg: result.message, type: result.success ? 'success' : 'error' });
        if (result.success) setHasUnsavedChanges(false);
        setSaving(false);
    };

    if (loading) return <div className="py-20 text-center opacity-50 font-black uppercase italic tracking-widest">Carregando Engenharia...</div>;

    const renderHeader = (id: string, label: string, extraClass: string = "", style: React.CSSProperties = {}) => (
        <th
            style={{ width: colWidths[id], minWidth: colWidths[id], maxWidth: colWidths[id], ...style }}
            className={`relative group px-4 py-4 border-r border-white/10 ${extraClass}`}
        >
            <div className="truncate">{label}</div>
            <div
                onMouseDown={(e) => onMouseDown(id, e)}
                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 z-30 transition-colors"
            />
        </th>
    );

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

            {/* Barra de Ferramentas e Filtros */}
            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 premium-shadow flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[200px] relative">
                    <input
                        type="text"
                        placeholder="PESQUISAR SKU OU NOME..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl outline-none font-bold text-xs uppercase transition-all"
                    />
                    <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="2.5" /></svg>
                </div>

                <select
                    value={filterBrand}
                    onChange={e => setFilterBrand(e.target.value)}
                    className="px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs outline-none cursor-pointer"
                >
                    <option value="">TODAS AS MARCAS</option>
                    {brands.map(b => <option key={b} value={b}>{b}</option>)}
                </select>

                <select
                    value={filterSupplier}
                    onChange={e => setFilterSupplier(e.target.value)}
                    className="px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs outline-none cursor-pointer"
                >
                    <option value="">TODOS OS FORNECEDORES</option>
                    {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                </select>

                <select
                    value={filterCategory}
                    onChange={e => setFilterCategory(e.target.value)}
                    className="px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-bold text-xs outline-none cursor-pointer"
                >
                    <option value="">TODAS AS CATEGORIAS</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <div className="h-8 w-px bg-slate-100 mx-2"></div>

                <button
                    onClick={saveChanges}
                    disabled={saving}
                    className={`ml-auto px-8 py-3 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg transition-all disabled:opacity-50 ${hasUnsavedChanges ? 'bg-red-600 hover:bg-red-700 animate-pulse' : 'bg-green-600 hover:bg-green-700'}`}
                >
                    {saving ? 'SALVANDO...' : hasUnsavedChanges ? 'SALVAR ALTERAÇÕES (PENDENTE)' : 'SALVAR ALTERAÇÕES'}
                </button>
            </div>

            {/* Grade Style Excel */}
            <div className="bg-white rounded-[2rem] border border-slate-100 premium-shadow overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse pricing-table table-fixed">
                        <thead className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest sticky top-0 z-20">
                            <tr>
                                {renderHeader('actions', 'AÇÕES', 'text-center sticky left-0 z-30 bg-slate-900 border-r-0 border-b border-white/10')}
                                <th style={{ width: colWidths.selection, left: colWidths.actions }} className="px-4 py-4 text-center border-r border-white/10 sticky z-30 bg-slate-900 border-r-0 border-b border-white/10">
                                    <input type="checkbox" checked={selectedSkus.size === filteredGrid.length && grid.length > 0} onChange={handleSelectAll} className="w-4 h-4 rounded border-white/20 bg-transparent text-blue-600 focus:ring-0 focus:ring-offset-0" />
                                </th>
                                {renderHeader('id_tiny', 'ID TINY', 'sticky z-30 bg-slate-900 border-r-0 border-b border-white/10', { left: colWidths.actions + colWidths.selection })}
                                {renderHeader('sku', 'SKU', 'sticky z-30 bg-slate-900 border-r-0 border-b border-white/10', { left: colWidths.actions + colWidths.selection + colWidths.id_tiny })}
                                {renderHeader('nome', 'NOME', 'sticky z-30 bg-slate-900 border-r border-b border-white/10', { left: colWidths.actions + colWidths.selection + colWidths.id_tiny + colWidths.sku })}
                                {renderHeader('marca', 'MARCA')}
                                {renderHeader('fornecedor', 'FORNECEDOR')}
                                {renderHeader('categoria', 'CATEGORIA')}
                                {renderHeader('largura_l', 'LARG', 'text-center')}
                                {renderHeader('metragem_padrao_ml', 'MET P.', 'text-center')}
                                <th className="px-4 py-4 text-center border-r border-white/10" style={{ width: colWidths.tem_difal }}>
                                    <div className="flex items-center justify-center gap-1">
                                        <span>DIFAL</span>
                                        <button
                                            onClick={() => setShowDifalSettings(true)}
                                            className="p-1 text-slate-400 hover:text-white transition-colors"
                                            title="Configurar Taxas DIFAL por Fornecedor"
                                        >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                            </svg>
                                        </button>
                                    </div>
                                </th>
                                {renderHeader('custo_rolo_base', 'CUSTO METRO (ML)', 'text-right bg-black text-white')}
                                {renderHeader('custo_total_calculado', 'CUSTO METRO (BRUTO)', 'text-right bg-black text-white')}

                                {/* ROLO ATACADO */}
                                {renderHeader('mkp_min_atacado', 'MKP ROLO (A)', 'text-center bg-slate-100')}
                                {renderHeader('preco_venda_min_atacado', 'PREÇO ROLO (A)', 'text-right bg-slate-200')}

                                {/* ROLO VAREJO */}
                                {renderHeader('mkp_ideal_atacado', 'MKP ROLO (V)', 'text-center bg-emerald-50')}
                                {renderHeader('preco_venda_ideal_atacado', 'PREÇO ROLO (V)', 'text-right bg-emerald-100')}

                                {/* FRACIONADO ATACADO */}
                                {renderHeader('mkp_min_fracionado', 'MKP FRAC. (A)', 'text-center bg-blue-50')}
                                {renderHeader('preco_venda_min_fracionado', 'PREÇO FRAC. (A)', 'text-right bg-blue-100')}

                                {/* FRACIONADO VAREJO */}
                                {renderHeader('mkp_ideal_fracionado', 'MKP FRAC. (V)', 'text-center bg-indigo-50')}
                                {renderHeader('preco_venda_ideal_fracionado', 'PREÇO FRAC. (V)', 'text-right bg-indigo-100')}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[10px] font-bold uppercase">
                            {filteredGrid.map(item => {
                                const hasTinyId = !!(item.id_tiny || item.pricing?.id_tiny);
                                const hasPrice = !!(item.pricing?.custo_rolo_base && item.pricing.custo_rolo_base > 0);
                                const isIncomplete = !hasTinyId || !hasPrice;

                                return (
                                    <tr key={item.sku} className={`hover:bg-slate-50 transition-all ${selectedSkus.has(item.sku) ? 'bg-blue-50/50' :
                                        isIncomplete ? 'bg-red-50' : ''
                                        }`}>
                                        <td className="px-4 py-3 text-center border-r border-white/10 sticky left-0 z-20 !bg-slate-900 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]" style={{ width: colWidths.actions }}>
                                            <button
                                                onClick={() => setEditingProduct(item)}
                                                className="p-2 text-slate-400 hover:text-white transition-colors"
                                                title="Ajuste Individual"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                </svg>
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-center border-r border-white/10 sticky z-20 !bg-slate-900 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]" style={{ width: colWidths.selection, left: colWidths.actions }}>
                                            <input type="checkbox" checked={selectedSkus.has(item.sku)} onChange={() => handleToggleSelect(item.sku)} className="w-4 h-4 rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0" />
                                        </td>
                                        <td className="px-4 py-3 border-r border-white/10 text-slate-300 font-mono truncate sticky z-20 !bg-slate-900 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]" style={{ width: colWidths.id_tiny, left: colWidths.actions + colWidths.selection }}>{item.id_tiny || item.pricing?.id_tiny || '-'}</td>
                                        <td className="px-4 py-3 border-r border-white/10 font-black text-white truncate sticky z-20 !bg-slate-900 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]" style={{ width: colWidths.sku, left: colWidths.actions + colWidths.selection + colWidths.id_tiny }}>{item.sku}</td>
                                        <td className="px-4 py-3 border-r border-white/10 truncate text-slate-300 sticky z-20 !bg-slate-900 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]" style={{ width: colWidths.nome, left: colWidths.actions + colWidths.selection + colWidths.id_tiny + colWidths.sku }} title={item.nome}>{item.nome}</td>
                                        <td className="px-4 py-3 border-r border-slate-100 truncate text-blue-600" style={{ width: colWidths.marca }}>{item.marca || '-'}</td>
                                        <td className="px-4 py-3 border-r border-slate-100 truncate" style={{ width: colWidths.fornecedor }}>{item.fornecedor || '-'}</td>
                                        <td className="px-4 py-3 border-r border-slate-100 truncate text-slate-500" style={{ width: colWidths.categoria }}>{item.categoria || '-'}</td>
                                        <td className="px-4 py-3 text-center border-r border-slate-100 text-slate-500" style={{ width: colWidths.largura_l }}>
                                            {item.larguraL?.toFixed(2) || '1.52'}
                                        </td>
                                        <td className="px-4 py-3 text-center border-r border-slate-100 text-slate-500" style={{ width: colWidths.metragem_padrao_ml }}>
                                            {item.metragemPadrao?.toFixed(0) || '15'}
                                        </td>
                                        <td className="px-4 py-3 text-center border-r border-slate-100" style={{ width: colWidths.tem_difal }}>
                                            <input
                                                type="checkbox"
                                                checked={item.pricing?.tem_difal || false}
                                                onChange={e => handleInputChange(item.sku, 'tem_difal', e.target.checked)}
                                                className="w-4 h-4 rounded"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right bg-blue-50/30 border-r border-slate-100" style={{ width: colWidths.custo_rolo_base }}>
                                            <input
                                                type="number"
                                                step="any"
                                                value={item.pricing?.custo_rolo_base ?? item.custoUnitario ?? 0}
                                                onChange={e => handleInputChange(item.sku, 'custo_rolo_base', parseFloat(e.target.value))}
                                                className="w-full bg-transparent text-right font-black text-blue-600 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right bg-slate-50 font-black text-slate-900 border-r border-slate-100" style={{ width: colWidths.custo_total_calculado }}>
                                            R$ {(item.pricing?.custo_total_calculado || item.pricing?.custo_rolo_base || item.custoUnitario || 0).toFixed(2)}
                                        </td>
                                        {/* MKP ROLO (A) */}
                                        <td className="px-4 py-3 text-center border-r border-slate-100 bg-slate-50" style={{ width: colWidths.mkp_min_atacado }}>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={item.pricing?.mkp_min_atacado ?? 0}
                                                onChange={e => handleInputChange(item.sku, 'mkp_min_atacado', parseFloat(e.target.value))}
                                                className="w-full bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                        </td>
                                        {/* PREÇO ROLO (A) */}
                                        <td className="px-4 py-3 text-right border-r border-slate-100 bg-slate-100 font-bold" style={{ width: colWidths.preco_venda_min_atacado }}>
                                            R$ {item.pricing?.preco_venda_min_atacado?.toFixed(2) || '0.00'}
                                        </td>

                                        {/* MKP ROLO (V) */}
                                        <td className="px-4 py-3 text-center border-r border-slate-100 bg-emerald-50/50" style={{ width: colWidths.mkp_ideal_atacado }}>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={item.pricing?.mkp_ideal_atacado ?? 0}
                                                onChange={e => handleInputChange(item.sku, 'mkp_ideal_atacado', parseFloat(e.target.value))}
                                                className="w-full bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-emerald-700 font-bold"
                                            />
                                        </td>
                                        {/* PREÇO ROLO (V) */}
                                        <td className="px-4 py-3 text-right border-r border-slate-100 bg-emerald-100/50 font-bold text-emerald-800" style={{ width: colWidths.preco_venda_ideal_atacado }}>
                                            R$ {item.pricing?.preco_venda_ideal_atacado?.toFixed(2) || '0.00'}
                                        </td>

                                        {/* MKP FRAC. (A) */}
                                        <td className="px-4 py-3 text-center border-r border-slate-100 bg-blue-50/50" style={{ width: colWidths.mkp_min_fracionado }}>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={item.pricing?.mkp_min_fracionado ?? 0}
                                                onChange={e => handleInputChange(item.sku, 'mkp_min_fracionado', parseFloat(e.target.value))}
                                                className="w-full bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-blue-700 font-bold"
                                            />
                                        </td>
                                        {/* PREÇO FRAC. (A) */}
                                        <td className="px-4 py-3 text-right border-r border-slate-100 bg-blue-100/50 font-bold text-blue-800" style={{ width: colWidths.preco_venda_min_fracionado }}>
                                            R$ {item.pricing?.preco_venda_min_fracionado?.toFixed(2) || '0.00'}
                                        </td>

                                        {/* MKP FRAC. (V) */}
                                        <td className="px-4 py-3 text-center border-r border-slate-100 bg-indigo-50/50" style={{ width: colWidths.mkp_ideal_fracionado }}>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={item.pricing?.mkp_ideal_fracionado ?? 0}
                                                onChange={e => handleInputChange(item.sku, 'mkp_ideal_fracionado', parseFloat(e.target.value))}
                                                className="w-full bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-indigo-700 font-bold"
                                            />
                                        </td>
                                        {/* PREÇO FRAC. (V) */}
                                        <td className="px-4 py-3 text-right border-r border-slate-100 bg-indigo-100/50 font-bold text-indigo-800" style={{ width: colWidths.preco_venda_ideal_fracionado }}>
                                            R$ {item.pricing?.preco_venda_ideal_fracionado?.toFixed(2) || '0.00'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* MODAL: CONFIGURAÇÃO DIFAL */}
            {showDifalSettings && (
                <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[210] flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div className="bg-white max-w-2xl w-full rounded-[2rem] shadow-2xl overflow-hidden flex flex-col border border-slate-100 animate-in zoom-in-95 max-h-[80vh]">
                        <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
                            <div>
                                <h3 className="text-xl font-black text-slate-900 uppercase italic">Configuração de Alíquotas DIFAL</h3>
                                <p className="text-blue-600 font-bold text-[10px] uppercase tracking-widest mt-1">Taxas por Fornecedor (Origem)</p>
                            </div>
                            <button onClick={() => setShowDifalSettings(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                                <ICONS.Add className="w-6 h-6 rotate-45 text-slate-400" />
                            </button>
                        </div>
                        <div className="p-8 overflow-y-auto custom-scrollbar">
                            <div className="space-y-4">
                                {Array.from(new Set(grid.map(i => i.fornecedor).filter(Boolean))).sort().map(supplier => (
                                    <div key={supplier} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                                        <span className="text-xs font-black text-slate-700 uppercase">{supplier}</span>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                step="any"
                                                value={difalRates[supplier as string] || 0}
                                                onChange={e => setDifalRates({ ...difalRates, [supplier as string]: parseFloat(e.target.value) })}
                                                className="w-24 px-3 py-2 bg-white border border-slate-200 rounded-lg text-right text-xs font-bold outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                            <span className="text-xs font-bold text-slate-400">%</span>
                                        </div>
                                    </div>
                                ))}
                                {grid.length === 0 && <p className="text-center text-slate-400 italic text-xs">Nenhum fornecedor encontrado na grade atual.</p>}
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-50 bg-slate-50/50 flex justify-end">
                            <button
                                onClick={handleSaveDifalRates}
                                className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-600 transition-colors shadow-lg"
                            >
                                Salvar Taxas e Recalcular
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: AJUSTE DE PREÇO INDIVIDUAL */}
            {editingProduct && (
                <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div className="bg-white max-w-5xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col border border-slate-100 animate-in zoom-in-95 h-[90vh]">
                        <div className="p-10 border-b border-slate-50 flex justify-between items-center bg-slate-50/30 shrink-0">
                            <div>
                                <h3 className="text-2xl font-black text-slate-900 uppercase italic">Ajuste de Preço Individual</h3>
                                <p className="text-blue-600 font-bold text-[10px] uppercase tracking-widest mt-1">Configurações Avançadas de Engenharia</p>
                            </div>
                            <button onClick={() => setEditingProduct(null)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all">
                                <ICONS.Add className="w-6 h-6 rotate-45" />
                            </button>
                        </div>

                        <div className="p-10 space-y-10 overflow-y-auto custom-scrollbar flex-1">
                            {/* CABEÇALHO DO PRODUTO */}
                            <div className="flex items-start gap-6 bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                                <div className="p-4 bg-slate-900 text-white rounded-2xl font-black text-xs italic">{editingProduct.sku}</div>
                                <div>
                                    <h4 className="text-xl font-black text-slate-900 uppercase italic">{editingProduct.nome}</h4>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">{editingProduct.marca} • {editingProduct.categoria} • ID Tiny: {editingProduct.id_tiny || '-'}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                {/* COLUNA 1: PARÂMETROS BASE */}
                                <div className="space-y-6">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-3 bg-blue-600 rounded-full"></div>
                                        <h5 className="text-[11px] font-black text-slate-900 uppercase italic">Parâmetros de Produto</h5>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Largura do Material (m)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={editingProduct.pricing?.largura_l ?? editingProduct.larguraL ?? 1.52}
                                                onChange={e => setEditingProduct({
                                                    ...editingProduct,
                                                    pricing: { ...(editingProduct.pricing || { sku: editingProduct.sku } as PricingScenario), largura_l: parseFloat(e.target.value) }
                                                })}
                                                className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Metragem Rolo Padrão (ML)</label>
                                            <input
                                                type="number"
                                                value={editingProduct.pricing?.metragem_padrao_ml ?? editingProduct.metragemPadrao ?? 15}
                                                onChange={e => setEditingProduct({
                                                    ...editingProduct,
                                                    pricing: { ...(editingProduct.pricing || { sku: editingProduct.sku } as PricingScenario), metragem_padrao_ml: parseFloat(e.target.value) }
                                                })}
                                                className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic"
                                            />
                                        </div>
                                        <div className="flex items-center gap-3 p-4 bg-blue-50/50 rounded-2xl border border-blue-100/50">
                                            <input
                                                type="checkbox"
                                                id="promocao_modal"
                                                checked={editingProduct.pricing?.promocao || false}
                                                onChange={e => setEditingProduct({
                                                    ...editingProduct,
                                                    pricing: { ...(editingProduct.pricing || { sku: editingProduct.sku } as PricingScenario), promocao: e.target.checked }
                                                })}
                                                className="w-5 h-5 rounded border-blue-300 text-blue-600"
                                            />
                                            <label htmlFor="promocao_modal" className="text-[10px] font-black text-blue-600 uppercase cursor-pointer italic">Marcar como Promoção</label>
                                        </div>
                                    </div>
                                </div>

                                {/* COLUNA 2: CUSTOS */}
                                <div className="space-y-6">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-3 bg-red-600 rounded-full"></div>
                                        <h5 className="text-[11px] font-black text-slate-900 uppercase italic">Estrutura de Custos</h5>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Custo Metro Base (ML)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={editingProduct.pricing?.custo_rolo_base ?? 0}
                                            onChange={e => {
                                                const val = parseFloat(e.target.value);
                                                const updatedPricing = { ...(editingProduct.pricing || { sku: editingProduct.sku } as PricingScenario), custo_rolo_base: val };
                                                const rate = difalRates[editingProduct.fornecedor || ''] || 0;
                                                const recalculated = PricingService.calculatePricing(updatedPricing, rate);
                                                setEditingProduct({ ...editingProduct, pricing: recalculated as PricingScenario });
                                            }}
                                            className="w-full px-5 py-3.5 bg-red-50/30 border-2 border-transparent focus:border-red-600 rounded-2xl text-xs font-black outline-none italic text-red-600"
                                        />
                                    </div>
                                    <div className="flex items-center gap-3 p-4 bg-amber-50/50 rounded-2xl border border-amber-100/50">
                                        <input
                                            type="checkbox"
                                            id="difal_modal"
                                            checked={editingProduct.pricing?.tem_difal || false}
                                            onChange={e => {
                                                const val = e.target.checked;
                                                const updatedPricing = { ...(editingProduct.pricing || { sku: editingProduct.sku } as PricingScenario), tem_difal: val };
                                                const rate = difalRates[editingProduct.fornecedor || ''] || 0;
                                                const recalculated = PricingService.calculatePricing(updatedPricing, rate);
                                                setEditingProduct({ ...editingProduct, pricing: recalculated as PricingScenario });
                                            }}
                                            className="w-5 h-5 rounded border-amber-300 text-amber-600"
                                        />
                                        <label htmlFor="difal_modal" className="text-[10px] font-black text-amber-600 uppercase cursor-pointer italic">Aplicar DIFAL na Origem</label>
                                    </div>
                                </div>

                                {/* COLUNA 3: MARKUPS */}
                                <div className="space-y-6">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-3 bg-emerald-600 rounded-full"></div>
                                        <h5 className="text-[11px] font-black text-slate-900 uppercase italic">Metas de Markup</h5>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">MKP Mínimo Atacado</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={editingProduct.pricing?.mkp_min_atacado ?? 1.5}
                                                onChange={e => {
                                                    const val = parseFloat(e.target.value);
                                                    const updatedPricing = { ...(editingProduct.pricing || { sku: editingProduct.sku } as PricingScenario), mkp_min_atacado: val };
                                                    const rate = difalRates[editingProduct.fornecedor || ''] || 0;
                                                    const recalculated = PricingService.calculatePricing(updatedPricing, rate);
                                                    setEditingProduct({ ...editingProduct, pricing: recalculated as PricingScenario });
                                                }}
                                                className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">MKP Ideal Atacado</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={editingProduct.pricing?.mkp_ideal_atacado ?? 1.8}
                                                onChange={e => {
                                                    const val = parseFloat(e.target.value);
                                                    const updatedPricing = { ...(editingProduct.pricing || { sku: editingProduct.sku } as PricingScenario), mkp_ideal_atacado: val };
                                                    const rate = difalRates[editingProduct.fornecedor || ''] || 0;
                                                    const recalculated = PricingService.calculatePricing(updatedPricing, rate);
                                                    setEditingProduct({ ...editingProduct, pricing: recalculated as PricingScenario });
                                                }}
                                                className="w-full px-5 py-3.5 bg-emerald-50/30 border-2 border-transparent focus:border-emerald-600 rounded-2xl text-xs font-black outline-none italic text-emerald-700"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">MKP Mínimo Frac.</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={editingProduct.pricing?.mkp_min_fracionado ?? 1.8}
                                                onChange={e => {
                                                    const val = parseFloat(e.target.value);
                                                    const updatedPricing = { ...(editingProduct.pricing || { sku: editingProduct.sku } as PricingScenario), mkp_min_fracionado: val };
                                                    const rate = difalRates[editingProduct.fornecedor || ''] || 0;
                                                    const recalculated = PricingService.calculatePricing(updatedPricing, rate);
                                                    setEditingProduct({ ...editingProduct, pricing: recalculated as PricingScenario });
                                                }}
                                                className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">MKP Ideal Frac.</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={editingProduct.pricing?.mkp_ideal_fracionado ?? 2.2}
                                                onChange={e => {
                                                    const val = parseFloat(e.target.value);
                                                    const updatedPricing = { ...(editingProduct.pricing || { sku: editingProduct.sku } as PricingScenario), mkp_ideal_fracionado: val };
                                                    const rate = difalRates[editingProduct.fornecedor || ''] || 0;
                                                    const recalculated = PricingService.calculatePricing(updatedPricing, rate);
                                                    setEditingProduct({ ...editingProduct, pricing: recalculated as PricingScenario });
                                                }}
                                                className="w-full px-5 py-3.5 bg-blue-50/30 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-black outline-none italic text-blue-700"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* PREVISÃO DE RESULTADOS */}
                            <div className="mt-8 pt-8 border-t border-slate-100">
                                <h5 className="text-[11px] font-black text-slate-900 uppercase italic mb-6">Previsão de Preços (Simulação por ML)</h5>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                    <div className="p-6 bg-slate-50 border border-slate-200 rounded-[2rem]">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Custo Metro (Bruto)</p>
                                        <p className="text-2xl font-black italic text-slate-900">R$ {editingProduct.pricing?.custo_total_calculado?.toFixed(2) || '---'}</p>
                                    </div>
                                    <div className="p-6 bg-emerald-600 text-white rounded-[2rem] shadow-xl">
                                        <p className="text-[9px] font-black uppercase tracking-widest opacity-50 mb-1">Venda Atacado (ML)</p>
                                        <p className="text-2xl font-black italic">R$ {editingProduct.pricing?.preco_venda_ideal_atacado?.toFixed(2) || '---'}</p>
                                    </div>
                                    <div className="p-6 bg-blue-600 text-white rounded-[2rem] shadow-xl">
                                        <p className="text-[9px] font-black uppercase tracking-widest opacity-50 mb-1">Venda Fracionado (ML)</p>
                                        <p className="text-2xl font-black italic">R$ {editingProduct.pricing?.preco_venda_ideal_fracionado?.toFixed(2) || '---'}</p>
                                    </div>
                                    <div className="p-6 bg-slate-900 text-white rounded-[2rem] shadow-xl">
                                        <p className="text-[9px] font-black uppercase tracking-widest opacity-50 mb-1">Custo Real ML (c/ Frete)</p>
                                        <p className="text-2xl font-black italic">R$ {editingProduct.pricing?.custo_metro_bobina?.toFixed(2) || '---'}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-10 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-4 shrink-0">
                            <button onClick={() => setEditingProduct(null)} className="px-8 py-4 text-slate-400 font-black text-[10px] uppercase tracking-widest italic hover:text-slate-900 transition-colors">Cancelar</button>
                            <button
                                onClick={handleSaveIndividual}
                                disabled={saving}
                                className="px-12 py-4 bg-slate-900 text-white rounded-[1.5rem] font-black text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-blue-600 transition-all italic active:scale-95 disabled:opacity-50"
                            >
                                {saving ? 'SALVANDO...' : 'Salvar Ajustes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
        .pricing-table th, .pricing-table td {
          white-space: nowrap;
        }
        .custom-scrollbar::-webkit-scrollbar {
          height: 10px;
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f5f9;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
        </div>
    );
};

export default PricingEngineering;
