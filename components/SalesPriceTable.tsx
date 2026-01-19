
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DataService } from '../services/dataService';
import { MasterProduct, StockItem, User, AuditLog } from '../types';
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
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('TODAS');
  const [filterStatus, setFilterStatus] = useState<'TODOS' | 'ATIVOS' | 'INATIVOS'>('ATIVOS');
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' | 'warning' } | null>(null);

  const [activeTab, setActiveTab] = useState<'TABLE' | 'LOG'>('TABLE');

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
      const [pData, iData, lData] = await Promise.all([
        DataService.getMasterCatalog(),
        DataService.getInventory(),
        DataService.getLogs()
      ]);
      setProducts(pData);
      setInventory(iData);
      // Filtra logs comerciais/preços
      setLogs(lData.filter(l => l.acao === 'REAJUSTE_COMERCIAL' || l.acao === 'EDICAO_MASTER_COMERCIAL'));
    } catch (e) {
      console.error("Erro ao carregar dados comerciais:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const calculateBaseUnitCost = (p: Partial<MasterProduct>, isRolo: boolean = true) => {
    return Number(isRolo ? (p.custoUnitarioRolo ?? p.custoUnitario ?? 0) : (p.custoUnitarioFrac ?? p.custoUnitario ?? 0));
  };

  const calculateMarkupDisplay = (price: number | undefined, item: Partial<MasterProduct>, isRolo: boolean) => {
    if (!price || price <= 0) return '0.0';
    const baseCost = calculateBaseUnitCost(item, isRolo);
    if (baseCost <= 0) return '0.0';
    const m = ((price / baseCost) - 1) * 100;
    return Math.abs(m).toFixed(1);
  };

  const calculatePriceFromMarkup = (markupPercent: number, item: Partial<MasterProduct>, isRolo: boolean) => {
    const baseCost = calculateBaseUnitCost(item, isRolo);
    return baseCost * (1 + (Math.abs(markupPercent) / 100));
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

  const filteredLogs = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return logs.filter(l => 
        (l.sku || '').toLowerCase().includes(term) || 
        (l.nome || '').toLowerCase().includes(term) ||
        (l.usuario || '').toLowerCase().includes(term) ||
        (l.detalhes || '').toLowerCase().includes(term)
    );
  }, [logs, searchTerm]);

  const handleSavePrice = async () => {
    if (!editingItem || !isDiretoria) return;
    setIsSaving(true);
    
    try {
      const result = await DataService.updateMasterProduct(editingItem, user, editingItem.sku);
      if (result.success) {
        if (result.warning) {
          setToast({ msg: result.warning, type: 'warning' });
        } else {
          setToast({ msg: 'PARÂMETROS COMERCIAIS ATUALIZADOS!', type: 'success' });
        }
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
      const res = await DataService.updateMasterProduct({ ...product, active: newState }, user, product.sku);
      if (res.success) {
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

  const onCostChange = (field: 'custoUnitarioFrac' | 'custoUnitarioRolo', value: string) => {
    if (!editingItem) return;
    const numValue = parseFloat(value) || 0;
    let newItem = { ...editingItem, [field]: numValue };
    
    if (field === 'custoUnitarioRolo') {
        newItem.custoUnitario = numValue;
        const mMin = parseFloat(markupStrings.roloMin) || 0;
        const mIdeal = parseFloat(markupStrings.roloIdeal) || 0;
        newItem.priceRoloMin = Number(calculatePriceFromMarkup(mMin, newItem, true).toFixed(2));
        newItem.priceRoloIdeal = Number(calculatePriceFromMarkup(mIdeal, newItem, true).toFixed(2));
    } else {
        const mMin = parseFloat(markupStrings.fracMin) || 0;
        const mIdeal = parseFloat(markupStrings.fracIdeal) || 0;
        newItem.priceFracMin = Number(calculatePriceFromMarkup(mMin, newItem, false).toFixed(2));
        newItem.priceFracIdeal = Number(calculatePriceFromMarkup(mIdeal, newItem, false).toFixed(2));
    }
    setEditingItem(newItem);
  };

  const simulationResults = useMemo(() => {
    if (!simulatingProduct) return null;

    const metros = parseFloat(simulationMeters.replace(',', '.')) || 0;
    if (metros <= 0) return null;

    const metragemRolo = simulatingProduct.metragemPadrao || 15;
    const isVolumeDeRolo = metros >= metragemRolo;

    const custoUnitarioProduto = isVolumeDeRolo 
      ? (simulatingProduct.custoUnitarioRolo ?? simulatingProduct.custoUnitario ?? 0)
      : (simulatingProduct.custoUnitarioFrac ?? simulatingProduct.custoUnitario ?? 0);

    const custoExtraTotal = Number(simulatingProduct.costExtraValue || 0); 
    const impostoPercent = Number(simulatingProduct.costTaxPercent || 0);

    const custoOperacionalUnitario = (custoUnitarioProduto + custoExtraTotal) * (1 + (impostoPercent / 100));
    const custoOperacionalTotal = custoOperacionalUnitario * metros;

    const precoTabelaIdeal = isVolumeDeRolo ? (simulatingProduct.priceRoloIdeal || 0) : (simulatingProduct.priceFracIdeal || 0);
    const precoTabelaMin = isVolumeDeRolo ? (simulatingProduct.priceRoloMin || 0) : (simulatingProduct.priceFracMin || 0);

    const precoVendaFinalIdeal = (precoTabelaIdeal + custoExtraTotal) * (1 + (impostoPercent / 100));
    const precoVendaFinalMin = (precoTabelaMin + custoExtraTotal) * (1 + (impostoPercent / 100));

    return {
        metros,
        isVolumeDeRolo,
        custoUnitarioProduto,
        custoExtraUnitario: custoExtraTotal,
        impostoPercent,
        custoOperacionalTotal,
        valorTotalIdeal: precoVendaFinalIdeal * metros,
        valorTotalMinimo: precoVendaFinalMin * metros,
        precoMetroIdeal: precoVendaFinalIdeal,
        precoMetroMinimo: precoVendaFinalMin
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
          <div className="flex gap-4 mt-4">
             <button 
                onClick={() => setActiveTab('TABLE')}
                className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'TABLE' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
             >
                Precificação Atual
             </button>
             <button 
                onClick={() => setActiveTab('LOG')}
                className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'LOG' ? 'bg-indigo-900 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
             >
                Log de Alterações
             </button>
          </div>
        </div>
        
        {activeTab === 'TABLE' && (
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
        )}
      </div>

      <div className="bg-white p-2 rounded-[2.5rem] border border-slate-200 shadow-sm flex items-center shrink-0">
         <div className="pl-6 text-slate-300">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="3"/></svg>
         </div>
         <input 
           type="text" 
           placeholder={activeTab === 'TABLE' ? "BUSCAR MATERIAL NA TABELA (SKU OU NOME)..." : "BUSCAR LOGS (SKU, NOME OU OPERADOR)..."}
           className="w-full px-6 py-4 bg-transparent outline-none font-black text-sm uppercase placeholder:text-slate-200"
           value={searchTerm}
           onChange={e => setSearchTerm(e.target.value)}
         />
      </div>

      {activeTab === 'TABLE' ? (
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

                const isRecentlyUpdated = p.updatedAt && (new Date().getTime() - new Date(p.updatedAt).getTime()) < (30 * 24 * 60 * 60 * 1000);

                return (
                  <tr key={p.sku} className={`group hover:bg-indigo-50/20 transition-all ${isInactive ? 'opacity-40 grayscale' : ''}`}>
                    <td className="px-8 py-6 sticky left-0 z-10 bg-white group-hover:bg-indigo-50/20 shadow-[5px_0_10px_-5px_rgba(0,0,0,0.05)]">
                      <div className="flex flex-col">
                         <div className="flex items-center gap-2 mb-1">
                            <span className="bg-slate-100 text-slate-500 text-[8px] font-black px-1.5 py-0.5 rounded w-fit uppercase">{p.sku}</span>
                            <div className="relative flex h-2 w-2" title={isRecentlyUpdated ? `Ajuste recente: ${new Date(p.updatedAt!).toLocaleDateString('pt-BR')}` : `Último ajuste: ${p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('pt-BR') : 'Sem registro'}`}>
                              {isRecentlyUpdated ? (
                                <>
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </>
                              ) : (
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                              )}
                            </div>
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
                        <div className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 border-amber-100 rounded-lg font-black text-[8px] uppercase italic">DROP</div>
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
                        {!hasStock && (
                          <button 
                            onClick={() => { setSimulatingProduct(p); setSimulationMeters('1'); }}
                            className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-green-600 hover:border-green-200 transition-all shadow-sm"
                            title="Simular Venda"
                          >
                            <ICONS.Calculator className="w-4 h-4" />
                          </button>
                        )}
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
      ) : (
        <div className="table-container flex-1 overflow-y-auto bg-white border border-slate-100 rounded-[2.5rem] shadow-sm relative custom-scrollbar">
           <table className="w-full border-collapse">
              <thead className="sticky top-0 z-30">
                <tr className="bg-slate-900 text-slate-400 text-[9px] font-black uppercase tracking-widest">
                  <th className="px-8 py-6 text-left">Data / Hora</th>
                  <th className="px-4 py-6 text-left">SKU / Produto</th>
                  <th className="px-4 py-6 text-left">Operador</th>
                  <th className="px-4 py-6 text-left">Detalhes da Alteração</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-8 py-6">
                       <div className="flex flex-col">
                          <span className="text-[11px] font-black text-slate-900 leading-none">{new Date(log.timestamp).toLocaleDateString('pt-BR')}</span>
                          <span className="text-[9px] font-bold text-slate-400 mt-1 uppercase">{new Date(log.timestamp).toLocaleTimeString('pt-BR')}</span>
                       </div>
                    </td>
                    <td className="px-4 py-6">
                       <div className="flex flex-col">
                          <span className="bg-slate-100 text-slate-500 text-[8px] font-black px-1.5 py-0.5 rounded w-fit uppercase">{log.sku}</span>
                          <span className="font-black text-slate-800 text-[11px] uppercase italic truncate max-w-[200px] mt-1">{log.nome}</span>
                       </div>
                    </td>
                    <td className="px-4 py-6">
                       <span className="text-[10px] font-black text-blue-600 uppercase tracking-tighter">@{log.usuario.split('@')[0]}</span>
                    </td>
                    <td className="px-4 py-6">
                       <p className="text-[10px] font-medium text-slate-500 leading-relaxed uppercase italic">"{log.detalhes}"</p>
                    </td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && (
                  <tr><td colSpan={4} className="py-20 text-center text-slate-300 font-black uppercase text-[10px] italic">Nenhum reajuste comercial registrado</td></tr>
                )}
              </tbody>
           </table>
        </div>
      )}

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
                      className="w-full px-6 py-4 bg-slate-100 border-2 border-transparent focus:border-blue-600 rounded-2xl font-black text-3xl text-center text-slate-800 outline-none transition-all shadow-inner no-spinner"
                      placeholder="0,00"
                      autoFocus
                    />
                 </div>
                 
                 {simulationResults && (
                   <div className="space-y-6 pt-6 border-t border-slate-100 animate-in fade-in">
                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-3">
                         <div className="flex justify-between items-center mb-2">
                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Estrutura de Custos Externos</h4>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${simulationResults.isVolumeDeRolo ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                                {simulationResults.isVolumeDeRolo ? 'Base: Rolo Fechado' : 'Base: Fracionado'}
                            </span>
                         </div>
                         <div className="flex justify-between text-[11px] font-bold text-slate-500 uppercase">
                            <p>Custo Produto ({simulationResults.isVolumeDeRolo ? 'Rolo' : 'Frac'})</p> 
                            <p>R$ {simulationResults.custoUnitarioProduto.toFixed(2)} /m</p>
                         </div>
                         <div className="flex justify-between text-[11px] font-bold text-blue-600 uppercase border-t border-slate-200/50 pt-2">
                            <p>(+) Custo Extra / Frete</p> 
                            <p>R$ {simulationResults.custoExtraUnitario.toFixed(2)} /m</p>
                         </div>
                         <div className="flex justify-between text-[11px] font-bold text-amber-600 uppercase">
                            <p>(+) Impostos Incidência</p> 
                            <p>{simulationResults.impostoPercent}%</p>
                         </div>
                         <div className="flex justify-between text-xs font-black text-slate-800 uppercase border-t border-slate-300 pt-2">
                            <p>Custo Real Total do Pedido</p> 
                            <p>R$ {simulationResults.custoOperacionalTotal.toFixed(2)}</p>
                         </div>
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                         <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100 text-center">
                            <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-1">Preço Venda Ideal</p>
                            <p className="text-2xl font-black text-emerald-800 italic">R$ {simulationResults.valorTotalIdeal.toFixed(2)}</p>
                            <p className="text-[10px] font-bold text-emerald-600 mt-1">(R$ {simulationResults.precoMetroIdeal.toFixed(2)} / metro)</p>
                         </div>
                         <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100 text-center">
                            <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest mb-1">Preço Venda Mínimo</p>
                            <p className="text-2xl font-black text-amber-800 italic">R$ {simulationResults.valorTotalMinimo.toFixed(2)}</p>
                            <p className="text-[10px] font-bold text-emerald-600 mt-1">(R$ {simulationResults.precoMetroMinimo.toFixed(2)} / metro)</p>
                         </div>
                      </div>
                   </div>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* MODAL DE EDIÇÃO - GESTÃO DE SKU */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white max-w-5xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-fit animate-in zoom-in-95 border border-slate-300">
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
                          <input 
                            type="number" 
                            step="0.01" 
                            value={editingItem.custoUnitarioFrac || 0} 
                            onChange={e => onCostChange('custoUnitarioFrac', e.target.value)} 
                            className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border border-slate-200 focus:border-indigo-500 outline-none no-spinner" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase ml-1 italic">Custo Rolo (m)</label>
                          <input 
                            type="number" 
                            step="0.01" 
                            value={editingItem.custoUnitarioRolo || 0} 
                            onChange={e => onCostChange('custoUnitarioRolo', e.target.value)} 
                            className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border border-slate-200 focus:border-indigo-500 outline-none no-spinner" 
                          />
                        </div>
                      </div>
                      
                      <div className="bg-slate-100/50 p-4 rounded-2xl border border-slate-200/50 space-y-4">
                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1 italic">Parâmetros Externos (Exclusivos Simulador)</p>
                        <div className="grid grid-cols-2 gap-4">
                           <div>
                              <label className="text-[9px] font-black text-blue-600 uppercase ml-1 italic">Custo Extra/Frete (m)</label>
                              <input 
                                type="number" 
                                step="0.01" 
                                value={editingItem.costExtraValue || 0} 
                                onChange={e => setEditingItem({...editingItem, costExtraValue: parseFloat(e.target.value) || 0})} 
                                className="w-full px-4 py-3 bg-white rounded-xl font-bold border border-slate-200 focus:border-blue-500 outline-none no-spinner" 
                              />
                           </div>
                           <div>
                              <label className="text-[9px] font-black text-blue-600 uppercase ml-1 italic">Imposto s/ Custo (%)</label>
                              <input 
                                type="number" 
                                step="0.1" 
                                value={editingItem.costTaxPercent || 0} 
                                onChange={e => setEditingItem({...editingItem, costTaxPercent: parseFloat(e.target.value) || 0})} 
                                className="w-full px-4 py-3 bg-white rounded-xl font-bold border border-slate-200 focus:border-blue-500 outline-none no-spinner" 
                              />
                           </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h4 className="text-[11px] font-black text-indigo-500 uppercase tracking-widest border-b border-indigo-100 pb-2 italic">Precificação (Markup Tabela)</h4>
                    
                    <div className="space-y-6">
                      <div className="space-y-3">
                         <p className="text-[10px] font-black text-slate-400 uppercase italic tracking-widest">Venda de Rolo Fechado</p>
                         <div className="grid grid-cols-12 gap-3">
                            <div className="col-span-8 space-y-1">
                               <label className="text-[8px] font-bold text-slate-400 uppercase ml-1">Preço Mín (Tabela)</label>
                               <input readOnly value={editingItem.priceRoloMin?.toFixed(2)} className="w-full px-4 py-2 bg-slate-200 border rounded-xl font-medium text-slate-500 cursor-not-allowed" />
                            </div>
                            <div className="col-span-4 space-y-1">
                               <label className="text-[8px] font-bold text-slate-400 uppercase ml-1">Markup (%)</label>
                               <input value={markupStrings.roloMin} onChange={e => onMarkupChange('roloMin', 'priceRoloMin', e.target.value, true)} className="w-full px-4 py-2 bg-white border border-slate-300 rounded-xl text-center font-bold no-spinner" placeholder="%" />
                            </div>
                         </div>
                         <div className="grid grid-cols-12 gap-3">
                            <div className="col-span-8 space-y-1">
                               <label className="text-[8px] font-bold text-indigo-500 uppercase ml-1">Preço Ideal (Tabela)</label>
                               <input readOnly value={editingItem.priceRoloIdeal?.toFixed(2)} className="w-full px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl font-black text-indigo-900/50 cursor-not-allowed" />
                            </div>
                            <div className="col-span-4 space-y-1">
                               <label className="text-[8px] font-bold text-indigo-500 uppercase ml-1">Markup (%)</label>
                               <input value={markupStrings.roloIdeal} onChange={e => onMarkupChange('roloIdeal', 'priceRoloIdeal', e.target.value, true)} className="w-full px-4 py-2 bg-white border border-indigo-300 rounded-xl text-center font-black text-indigo-900 no-spinner" placeholder="%" />
                            </div>
                         </div>
                      </div>

                      <div className="space-y-3 pt-6 border-t border-slate-100">
                         <p className="text-[10px] font-black text-slate-400 uppercase italic tracking-widest">Venda Fracionada</p>
                         <div className="grid grid-cols-12 gap-3">
                            <div className="col-span-8 space-y-1">
                               <label className="text-[8px] font-bold text-slate-400 uppercase ml-1">Preço Mín (Tabela)</label>
                               <input readOnly value={editingItem.priceFracMin?.toFixed(2)} className="w-full px-4 py-2 bg-slate-200 border rounded-xl font-medium text-slate-500 cursor-not-allowed" />
                            </div>
                            <div className="col-span-4 space-y-1">
                               <label className="text-[8px] font-bold text-slate-400 uppercase ml-1">Markup (%)</label>
                               <input value={markupStrings.fracMin} onChange={e => onMarkupChange('fracMin', 'priceFracMin', e.target.value, false)} className="w-full px-4 py-2 bg-white border border-slate-300 rounded-xl text-center font-bold no-spinner" placeholder="%" />
                            </div>
                         </div>
                         <div className="grid grid-cols-12 gap-3">
                            <div className="col-span-8 space-y-1">
                               <label className="text-[8px] font-bold text-emerald-600 uppercase ml-1">Preço Ideal (Tabela)</label>
                               <input readOnly value={editingItem.priceFracIdeal?.toFixed(2)} className="w-full px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl font-black text-emerald-900/50 cursor-not-allowed" />
                            </div>
                            <div className="col-span-4 space-y-1">
                               <label className="text-[8px] font-bold text-emerald-600 uppercase ml-1">Markup (%)</label>
                               <input value={markupStrings.fracIdeal} onChange={e => onMarkupChange('fracIdeal', 'priceFracIdeal', e.target.value, false)} className="w-full px-4 py-2 bg-white border border-emerald-300 rounded-xl text-center font-black text-emerald-900 no-spinner" placeholder="%" />
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
                      {isSaving ? 'Salvando...' : 'Salvar Tabela'}
                  </button>
              </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesPriceTable;
