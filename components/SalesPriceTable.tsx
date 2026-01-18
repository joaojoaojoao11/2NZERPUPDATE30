
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DataService } from '../services/dataService';
import { MasterProduct, StockItem, User } from '../types';
import { ICONS, CATEGORIES } from '../constants';
import Toast from './Toast';
import ProductForm from './ProductForm';
import * as XLSX from 'xlsx';

interface SalesPriceTableProps {
  user: User;
}

const SalesPriceTable: React.FC<SalesPriceTableProps> = ({ user }) => {
  const [products, setProducts] = useState<MasterProduct[]>([]);
  const [inventory, setInventory] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('TODAS');
  const [filterStatus, setFilterStatus] = useState<'TODOS' | 'ATIVOS' | 'INATIVOS'>('ATIVOS');
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);

  const [editingItem, setEditingItem] = useState<MasterProduct | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [simulatingProduct, setSimulatingProduct] = useState<MasterProduct | null>(null);
  const [simulationMeters, setSimulationMeters] = useState<string>('1');

  const isDiretoria = user.role === 'DIRETORIA';

  const [markupStrings, setMarkupStrings] = useState({
    roloMin: '',
    roloIdeal: '',
    fracMin: '',
    fracIdeal: ''
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pData, iData] = await Promise.all([
        DataService.getMasterCatalog(),
        DataService.getInventory()
      ]);
      setProducts(pData);
      setInventory(iData);
    } catch (e) {
      console.error("Erro ao carregar dados comerciais:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const calculateFinalCost = (p: Partial<MasterProduct>, isRolo: boolean = true) => {
    const base = Number(isRolo ? (p.custoUnitarioRolo ?? p.custoUnitario ?? 0) : (p.custoUnitarioFrac ?? p.custoUnitario ?? 0));
    const extra = Number(p.costExtraValue || 0);
    const tax = Number(p.costTaxPercent || 0);
    return (base + extra) * (1 + (tax / 100));
  };

  const calculateMarkupDisplay = (price: number | undefined, item: Partial<MasterProduct>, isRolo: boolean) => {
    if (!price || price <= 0) return '';
    const finalCost = calculateFinalCost(item, isRolo);
    if (finalCost <= 0) return '';
    const m = ((price / finalCost) - 1) * 100;
    return m.toFixed(1);
  };

  const calculatePriceFromMarkup = (markupPercent: number, item: Partial<MasterProduct>, isRolo: boolean) => {
    const finalCost = calculateFinalCost(item, isRolo);
    return finalCost * (1 + (markupPercent / 100));
  };

  useEffect(() => {
    if (editingItem) {
      setMarkupStrings({
        roloMin: calculateMarkupDisplay(editingItem.priceRoloMin, editingItem, true),
        roloIdeal: calculateMarkupDisplay(editingItem.priceRoloIdeal, editingItem, true),
        fracMin: calculateMarkupDisplay(editingItem.priceFracMin, editingItem, false),
        fracIdeal: calculateMarkupDisplay(editingItem.priceFracIdeal, editingItem, false)
      });
    }
  }, [editingItem?.sku]);

  const stockMap = useMemo(() => {
    const map: Record<string, number> = {};
    inventory.forEach(item => {
      if (item.quantMl > 0.01) {
        map[item.sku] = (map[item.sku] || 0) + item.quantMl;
      }
    });
    return map;
  }, [inventory]);

  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.categoria));
    return ['TODAS', ...Array.from(cats)].sort();
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = 
        p.sku.toLowerCase().includes(searchTerm.toLowerCase()) || 
        p.nome.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = filterCategory === 'TODAS' || p.categoria === filterCategory;
      
      let matchesStatus = true;
      if (filterStatus === 'ATIVOS') matchesStatus = p.active !== false;
      else if (filterStatus === 'INATIVOS') matchesStatus = p.active === false;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [products, searchTerm, filterCategory, filterStatus]);

  const handleSavePrice = async () => {
    if (!editingItem || !isDiretoria) return;
    setIsSaving(true);
    
    try {
      const success = await DataService.updateMasterProduct(editingItem, user, editingItem.sku);
      if (success) {
        setToast({ msg: 'PREÇOS SINCRONIZADOS COM SUCESSO!', type: 'success' });
        setEditingItem(null);
        await fetchData();
      }
    } catch (e: any) {
      setToast({ msg: e.message || 'Falha técnica ao gravar no banco.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (product: MasterProduct) => {
    if (!isDiretoria) return;
    const newState = product.active === false; 
    const msg = newState ? `Reativar o produto ${product.sku}?` : `Inativar/Pausar o produto ${product.sku}? Ele não aparecerá nas buscas padrão de vendas.`;
    
    if (!window.confirm(msg)) return;

    try {
      const success = await DataService.updateMasterProduct({ ...product, active: newState }, user, product.sku);
      if (success) {
        setToast({ msg: newState ? 'PRODUTO REATIVADO!' : 'PRODUTO PAUSADO', type: 'success' });
        await fetchData();
      }
    } catch (e: any) {
        setToast({ msg: 'Falha ao alterar status no banco.', type: 'error' });
    }
  };

  const onMarkupChange = (markupKey: keyof typeof markupStrings, priceField: keyof MasterProduct, input: string, isRolo: boolean) => {
    if (!editingItem) return;
    const sanitizedInput = input.replace(',', '.');
    setMarkupStrings(prev => ({ ...prev, [markupKey]: sanitizedInput }));

    const markupPercent = parseFloat(sanitizedInput);
    if (isNaN(markupPercent)) {
      setEditingItem({ ...editingItem, [priceField]: 0 });
    } else {
      const calculatedPrice = calculatePriceFromMarkup(markupPercent, editingItem, isRolo);
      setEditingItem({ ...editingItem, [priceField]: Number(calculatedPrice.toFixed(2)) });
    }
  };

  const simulationResults = useMemo(() => {
    if (!simulatingProduct) return null;

    const metros = parseFloat(simulationMeters.replace(',', '.')) || 0;
    if (metros <= 0) return null;

    const metragemRolo = simulatingProduct.metragemPadrao || 15;
    const isVolumeDeRolo = metros >= metragemRolo;

    const custoBaseUsado = isVolumeDeRolo 
      ? (simulatingProduct.custoUnitarioRolo ?? simulatingProduct.custoUnitario ?? 0)
      : (simulatingProduct.custoUnitarioFrac ?? simulatingProduct.custoUnitario ?? 0);

    const custoFinalUsado = (custoBaseUsado + (simulatingProduct.costExtraValue || 0)) * (1 + (simulatingProduct.costTaxPercent || 0) / 100);

    const markupPercentIdeal = isVolumeDeRolo 
        ? ((simulatingProduct.priceRoloIdeal || 0) / calculateFinalCost(simulatingProduct, true) - 1) * 100
        : ((simulatingProduct.priceFracIdeal || 0) / calculateFinalCost(simulatingProduct, false) - 1) * 100;

    const markupPercentMin = isVolumeDeRolo 
        ? ((simulatingProduct.priceRoloMin || 0) / calculateFinalCost(simulatingProduct, true) - 1) * 100
        : ((simulatingProduct.priceFracMin || 0) / calculateFinalCost(simulatingProduct, false) - 1) * 100;

    const custoTotalFinal = custoFinalUsado * metros;
    const valorTotalIdeal = custoTotalFinal * (1 + markupPercentIdeal / 100);
    const valorTotalMinimo = custoTotalFinal * (1 + markupPercentMin / 100);

    return {
        metros,
        isVolumeDeRolo,
        custoBaseUsado,
        custoTotalFinal,
        valorTotalIdeal,
        valorTotalMinimo,
        precoPorMetroIdeal: valorTotalIdeal / metros,
        precoPorMetroMinimo: valorTotalMinimo / metros,
        markupPercentIdeal,
        markupPercentMin
    };
  }, [simulatingProduct, simulationMeters]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 opacity-30">
      <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-4 flex flex-col h-full max-h-[calc(100vh-140px)]">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 shrink-0">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none text-indigo-600">Tabela de Preços</h2>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.25em] mt-3 italic">Gestão de Oferta e Precificação Estratégica</p>
        </div>
        
        <div className="flex gap-4">
           <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-3 border-r border-slate-100 italic">Status</span>
              <select 
                value={filterStatus} 
                onChange={e => setFilterStatus(e.target.value as any)}
                className="bg-transparent border-none outline-none text-xs font-black text-slate-700 uppercase px-3 py-1 cursor-pointer"
              >
                <option value="ATIVOS">Apenas Ativos</option>
                <option value="INATIVOS">Apenas Pausados</option>
                <option value="TODOS">Todos os Itens</option>
              </select>
           </div>
           <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-3 border-r border-slate-100 italic">Categoria</span>
              <select 
                value={filterCategory} 
                onChange={e => setFilterCategory(e.target.value)}
                className="bg-transparent border-none outline-none text-xs font-black text-slate-700 uppercase px-3 py-1 cursor-pointer"
              >
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
           </div>
        </div>
      </div>

      <div className="bg-white p-2 rounded-[2.5rem] border border-slate-200 shadow-sm flex items-center shrink-0">
         <div className="pl-6 text-slate-300">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="3"/></svg>
         </div>
         <input 
           type="text" 
           placeholder="BUSCAR MATERIAL NA TABELA (SKU OU NOME)..." 
           className="w-full px-6 py-4 bg-transparent outline-none font-black text-sm uppercase placeholder:text-slate-200"
           value={searchTerm}
           onChange={e => setSearchTerm(e.target.value)}
         />
      </div>

      <div className="table-container flex-1 overflow-y-auto bg-white border border-slate-100 rounded-[2.5rem] shadow-sm relative custom-scrollbar">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-30">
            <tr className="bg-slate-900 text-slate-400 text-[9px] font-black uppercase tracking-widest">
              <th className="px-8 py-6 text-left sticky left-0 z-40 bg-slate-900">Produto / SKU</th>
              <th className="px-4 py-6 text-center">Categoria</th>
              <th className="px-4 py-6 text-center">Metragem</th>
              <th className="px-4 py-6 text-center">Disponibilidade</th>
              <th className="px-2 py-6 text-center bg-indigo-900/20 text-indigo-400 whitespace-nowrap w-24">Rolo Fechado (Ideal)</th>
              <th className="px-2 py-6 text-center bg-emerald-900/30 text-emerald-200 whitespace-nowrap w-24">Frac. (Ideal/m)</th>
              <th className="px-6 py-6 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredProducts.map(p => {
              const hasStock = (stockMap[p.sku] || 0) > 0.01;
              const isInactive = p.active === false;
              const metragem = p.metragemPadrao || 15;
              const valorRoloIdeal = (p.priceRoloIdeal || 0) * metragem;

              return (
                <tr key={p.sku} className={`group hover:bg-indigo-50/20 transition-all ${isInactive ? 'opacity-40 grayscale' : ''}`}>
                  <td className="px-8 py-6 sticky left-0 z-10 bg-white group-hover:bg-indigo-50/20 shadow-[5px_0_10px_-5px_rgba(0,0,0,0.05)]">
                    <div className="flex flex-col">
                       <div className="flex items-center gap-2 mb-1">
                          <span className="bg-slate-100 text-slate-500 text-[8px] font-black px-1.5 py-0.5 rounded w-fit">{p.sku}</span>
                          {isInactive && <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter">PAUSADO</span>}
                       </div>
                       <span className="font-black text-slate-900 text-[12px] uppercase italic tracking-tight">{p.nome}</span>
                    </div>
                  </td>
                  <td className="px-4 py-6 text-center">
                    <span className="px-2 py-1 bg-slate-100 rounded-lg text-[9px] font-black text-slate-500 uppercase tracking-wide">{p.categoria}</span>
                  </td>
                  <td className="px-4 py-6 text-center"><span className="text-[11px] font-bold text-slate-500">{metragem}m</span></td>
                  <td className="px-4 py-6 text-center">
                    {hasStock ? (
                      <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg font-black text-[8px] uppercase italic shadow-sm">ESTOQUE</div>
                    ) : (
                      <div className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-lg font-black text-[8px] uppercase italic">DROP</div>
                    )}
                  </td>
                  <td className="px-2 py-6 text-center bg-indigo-50/20">
                    <p className="text-xs font-black text-indigo-700 italic">R$ {valorRoloIdeal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </td>
                  <td className="px-2 py-6 text-center bg-emerald-50/20">
                    <p className="text-xs font-black text-emerald-700 italic">R$ {(p.priceFracIdeal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </td>
                  <td className="px-6 py-6 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => { setSimulatingProduct(p); setSimulationMeters('1'); }}
                        className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-green-600 hover:border-green-200 transition-all shadow-sm"
                        title="Simular Venda"
                      >
                        <ICONS.Calculator className="w-4 h-4" />
                      </button>
                      {isDiretoria && (
                        <>
                          <button 
                            onClick={() => handleToggleActive(p)} 
                            className={`p-2 border rounded-xl transition-all shadow-sm ${isInactive ? 'text-emerald-500 border-emerald-100 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-400 border-slate-200 bg-white hover:text-red-500 hover:border-red-200'}`}
                            title={isInactive ? "Ativar Produto" : "Inativar/Pausar Produto"}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                          <button onClick={() => setEditingItem(p)} className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm" title="Gerir SKU">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeWidth="2.5"/></svg>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* MODAL DE SIMULAÇÃO */}
      {simulatingProduct && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-white max-w-2xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col border border-slate-100 animate-in zoom-in-95">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                 <div>
                    <h3 className="text-xl font-black text-slate-900 uppercase italic">Simulador Comercial</h3>
                    <p className="text-blue-600 font-bold text-[10px] uppercase tracking-widest mt-1">{simulatingProduct.sku}</p>
                 </div>
                 <button onClick={() => setSimulatingProduct(null)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all shadow-sm">
                    <ICONS.Add className="w-5 h-5 rotate-45" />
                 </button>
              </div>

              <div className="p-8 space-y-6">
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Metragem Solicitada (m)</label>
                    <input 
                      type="text"
                      value={simulationMeters}
                      onChange={e => setSimulationMeters(e.target.value)}
                      className="w-full px-6 py-4 bg-slate-100 border-2 border-transparent focus:border-blue-600 rounded-2xl font-black text-3xl text-center text-slate-800 outline-none transition-all shadow-inner"
                      placeholder="0,00"
                      autoFocus
                    />
                 </div>
                 
                 {simulationResults && (
                   <div className="space-y-6 pt-6 border-t border-slate-100 animate-in fade-in">
                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
                         <div className="flex justify-between items-center">
                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Análise de Viabilidade</h4>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${simulationResults.isVolumeDeRolo ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                                {simulationResults.isVolumeDeRolo ? 'Preço Base: Rolo Fechado' : 'Preço Base: Fracionado'}
                            </span>
                         </div>
                         <div className="flex justify-between text-xs font-bold text-slate-500 uppercase"><p>Custo Base ({simulationResults.isVolumeDeRolo ? 'Rolo' : 'Frac'})</p> <p>R$ {simulationResults.custoBaseUsado.toFixed(2)} /m</p></div>
                         <div className="flex justify-between text-xs font-bold text-slate-500 uppercase"><p>Custo Final Total Operacional</p> <p>R$ {simulationResults.custoTotalFinal.toFixed(2)}</p></div>
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                         <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100 text-center">
                            <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-1">Preço Venda Ideal</p>
                            <p className="text-2xl font-black text-emerald-800 italic">R$ {simulationResults.valorTotalIdeal.toFixed(2)}</p>
                            <p className="text-[10px] font-bold text-emerald-600 mt-1">(R$ {simulationResults.precoPorMetroIdeal.toFixed(2)} / metro)</p>
                         </div>
                         <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100 text-center">
                            <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest mb-1">Preço Venda Mínimo</p>
                            <p className="text-2xl font-black text-amber-800 italic">R$ {simulationResults.valorTotalMinimo.toFixed(2)}</p>
                            <p className="text-[10px] font-bold text-amber-600 mt-1">(R$ {simulationResults.precoPorMetroMinimo.toFixed(2)} / metro)</p>
                         </div>
                      </div>
                   </div>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* MODAL DE EDIÇÃO COM CUSTOS DUPLOS */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white max-w-5xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-fit animate-in zoom-in-95">
              <div className="p-10 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
                  <div>
                      <h3 className="text-2xl font-black text-slate-900 uppercase italic">Gestão Comercial de SKU</h3>
                      <p className="text-indigo-600 font-bold text-[10px] uppercase tracking-widest mt-1">{editingItem.sku}</p>
                  </div>
                  <button onClick={() => setEditingItem(null)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all">
                      <ICONS.Add className="w-6 h-6 rotate-45" />
                  </button>
              </div>

              <div className="p-10 space-y-10 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div className="space-y-6">
                    <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2 italic">Estrutura de Custo Base (R$)</h4>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase ml-1 italic">Custo Fracionado (m)</label>
                          <input type="number" step="0.01" value={editingItem.custoUnitarioFrac} onChange={e => setEditingItem({...editingItem, custoUnitarioFrac: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border border-slate-200" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase ml-1 italic">Custo Rolo (m)</label>
                          <input type="number" step="0.01" value={editingItem.custoUnitarioRolo} onChange={e => setEditingItem({...editingItem, custoUnitarioRolo: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border border-slate-200" />
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase ml-1 italic">Custo Extra/Frete (R$)</label>
                        <input type="number" step="0.01" value={editingItem.costExtraValue} onChange={e => setEditingItem({...editingItem, costExtraValue: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border border-slate-200" />
                      </div>
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase ml-1 italic">Imposto s/ Custo (%)</label>
                        <input type="number" step="0.1" value={editingItem.costTaxPercent} onChange={e => setEditingItem({...editingItem, costTaxPercent: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border border-slate-200" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h4 className="text-[11px] font-black text-indigo-500 uppercase tracking-widest border-b border-indigo-100 pb-2 italic">Precificação (Locked)</h4>
                    
                    <div className="space-y-6">
                      <div className="space-y-3">
                         <p className="text-[10px] font-black text-slate-400 uppercase italic tracking-widest">Venda de Rolo Fechado</p>
                         <div className="grid grid-cols-12 gap-3">
                            <div className="col-span-8 space-y-1">
                               <label className="text-[8px] font-bold text-slate-400 uppercase ml-1">Preço Mín ( Locked )</label>
                               <input readOnly value={editingItem.priceRoloMin?.toFixed(2)} className="w-full px-4 py-2 bg-slate-200 border rounded-xl font-medium text-slate-500 cursor-not-allowed" />
                            </div>
                            <div className="col-span-4 space-y-1">
                               <label className="text-[8px] font-bold text-slate-400 uppercase ml-1">Markup (%)</label>
                               <input value={markupStrings.roloMin} onChange={e => onMarkupChange('roloMin', 'priceRoloMin', e.target.value, true)} className="w-full px-4 py-2 bg-white border border-slate-300 rounded-xl text-center font-bold" placeholder="%" />
                            </div>
                         </div>
                         <div className="grid grid-cols-12 gap-3">
                            <div className="col-span-8 space-y-1">
                               <label className="text-[8px] font-bold text-indigo-500 uppercase ml-1">Preço Ideal ( Locked )</label>
                               <input readOnly value={editingItem.priceRoloIdeal?.toFixed(2)} className="w-full px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl font-black text-indigo-900/50 cursor-not-allowed" />
                            </div>
                            <div className="col-span-4 space-y-1">
                               <label className="text-[8px] font-bold text-indigo-500 uppercase ml-1">Markup (%)</label>
                               <input value={markupStrings.roloIdeal} onChange={e => onMarkupChange('roloIdeal', 'priceRoloIdeal', e.target.value, true)} className="w-full px-4 py-2 bg-white border border-indigo-300 rounded-xl text-center font-black text-indigo-900" placeholder="%" />
                            </div>
                         </div>
                      </div>

                      <div className="space-y-3 pt-6 border-t border-slate-100">
                         <p className="text-[10px] font-black text-slate-400 uppercase italic tracking-widest">Venda Fracionada</p>
                         <div className="grid grid-cols-12 gap-3">
                            <div className="col-span-8 space-y-1">
                               <label className="text-[8px] font-bold text-slate-400 uppercase ml-1">Preço Mín ( Locked )</label>
                               <input readOnly value={editingItem.priceFracMin?.toFixed(2)} className="w-full px-4 py-2 bg-slate-200 border rounded-xl font-medium text-slate-500 cursor-not-allowed" />
                            </div>
                            <div className="col-span-4 space-y-1">
                               <label className="text-[8px] font-bold text-slate-400 uppercase ml-1">Markup (%)</label>
                               <input value={markupStrings.fracMin} onChange={e => onMarkupChange('fracMin', 'priceFracMin', e.target.value, false)} className="w-full px-4 py-2 bg-white border border-slate-300 rounded-xl text-center font-bold" placeholder="%" />
                            </div>
                         </div>
                         <div className="grid grid-cols-12 gap-3">
                            <div className="col-span-8 space-y-1">
                               <label className="text-[8px] font-bold text-emerald-600 uppercase ml-1">Preço Ideal ( Locked )</label>
                               <input readOnly value={editingItem.priceFracIdeal?.toFixed(2)} className="w-full px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl font-black text-emerald-900/50 cursor-not-allowed" />
                            </div>
                            <div className="col-span-4 space-y-1">
                               <label className="text-[8px] font-bold text-emerald-600 uppercase ml-1">Markup (%)</label>
                               <input value={markupStrings.fracIdeal} onChange={e => onMarkupChange('fracIdeal', 'priceFracIdeal', e.target.value, false)} className="w-full px-4 py-2 bg-white border border-emerald-300 rounded-xl text-center font-black text-emerald-900" placeholder="%" />
                            </div>
                         </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-10 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-4">
                  <button onClick={() => setEditingItem(null)} className="px-8 py-4 text-slate-400 font-black text-[10px] uppercase tracking-widest italic hover:text-slate-900 transition-colors">Cancelar</button>
                  <button 
                      onClick={handleSavePrice}
                      disabled={isSaving}
                      className="px-12 py-4 bg-slate-900 text-white rounded-[1.5rem] font-black text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-indigo-600 transition-all italic active:scale-95 disabled:opacity-50"
                  >
                      {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                  </button>
              </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesPriceTable;
