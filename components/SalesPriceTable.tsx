
import React, { useState, useEffect, useMemo } from 'react';
import { DataService } from '../services/dataService';
import { MasterProduct, StockItem, User } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';

const SalesPriceTable: React.FC<{ user: User }> = ({ user }) => {
  const [products, setProducts] = useState<MasterProduct[]>([]);
  const [inventory, setInventory] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('TODAS');
  const [filterStatus, setFilterStatus] = useState<'TODOS' | 'ATIVOS' | 'INATIVOS'>('ATIVOS');
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);

  // Estados para Edição
  const [editingItem, setEditingItem] = useState<MasterProduct | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isDiretoria = user.role === 'DIRETORIA';

  // Estado local para as strings de markup para evitar "pulos" na digitação
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

  // Quando abrir o modal, inicializa as strings de markup baseadas nos preços atuais
  useEffect(() => {
    if (editingItem) {
      setMarkupStrings({
        roloMin: calculateMarkupDisplay(editingItem.priceRoloMin),
        roloIdeal: calculateMarkupDisplay(editingItem.priceRoloIdeal),
        fracMin: calculateMarkupDisplay(editingItem.priceFracMin),
        fracIdeal: calculateMarkupDisplay(editingItem.priceFracIdeal)
      });
    }
  }, [editingItem?.sku]); // Apenas quando mudar o produto selecionado

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
    
    // Sanitização rigorosa antes do commit
    const sanitizedItem = {
        ...editingItem,
        priceRoloMin: Number(editingItem.priceRoloMin) || 0,
        priceRoloIdeal: Number(editingItem.priceRoloIdeal) || 0,
        priceFracMin: Number(editingItem.priceFracMin) || 0,
        priceFracIdeal: Number(editingItem.priceFracIdeal) || 0,
        custoUnitario: Number(editingItem.custoUnitario) || 0,
        costTaxPercent: Number(editingItem.costTaxPercent) || 0,
        costExtraValue: Number(editingItem.costExtraValue) || 0,
        active: editingItem.active !== false
    };

    try {
      const success = await DataService.updateMasterProduct(sanitizedItem, user, editingItem.sku);
      if (success) {
        setToast({ msg: 'PREÇOS SINCRONIZADOS COM SUCESSO!', type: 'success' });
        setEditingItem(null);
        await fetchData();
      }
    } catch (e: any) {
      if (e.message === "SCHEMA_INCOMPLETE") {
        setToast({ msg: 'SALVO PARCIALMENTE! Rode o script SQL no Supabase para salvar os novos preços.', type: 'error' });
      } else {
        setToast({ msg: e.message || 'Falha técnica ao gravar no banco.', type: 'error' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (product: MasterProduct) => {
    if (!isDiretoria) return;
    const newState = product.active === false; // Se false vira true, se undefined/true vira false
    const msg = newState ? `Reativar o produto ${product.sku}?` : `Deseja pausar/inativar o produto ${product.sku}? Ele deixará de aparecer na lista padrão de ativos.`;
    
    if (!window.confirm(msg)) return;

    try {
      const success = await DataService.updateMasterProduct({ ...product, active: newState }, user, product.sku);
      if (success) {
        setToast({ msg: newState ? 'PRODUTO REATIVADO!' : 'PRODUTO PAUSADO/INATIVADO', type: 'success' });
        await fetchData();
      }
    } catch (e: any) {
        setToast({ msg: 'Falha ao alterar status. Verifique o schema SQL.', type: 'error' });
    }
  };

  // Helper para cálculo de custo final composto
  const calculateFinalCost = (p: MasterProduct) => {
    const base = Number(p.custoUnitario || 0);
    const extra = Number(p.costExtraValue || 0);
    const tax = Number(p.costTaxPercent || 0);
    return (base + extra) * (1 + (tax / 100));
  };

  // Função para calcular markup a partir do preço (usada apenas na inicialização ou quando o preço muda)
  const calculateMarkupDisplay = (price: number | undefined) => {
    if (!editingItem || !price || price <= 0) return '';
    const finalCost = calculateFinalCost(editingItem);
    if (finalCost <= 0) return '';
    const m = ((price / finalCost) - 1) * 100;
    return m.toFixed(1);
  };

  // Handler para quando o usuário digita no campo de Preço
  const onPriceChange = (field: keyof MasterProduct, val: string, markupKey: keyof typeof markupStrings) => {
    if (!editingItem) return;
    const numPrice = parseFloat(val);
    const newItem = { ...editingItem, [field]: isNaN(numPrice) ? 0 : numPrice };
    setEditingItem(newItem);
    
    // Recalcula a string de markup para acompanhar o preço
    const newMarkup = calculateMarkupDisplay(newItem[field] as number);
    setMarkupStrings(prev => ({ ...prev, [markupKey]: newMarkup }));
  };

  // Handler para quando o usuário digita no campo de Markup
  const onMarkupChange = (markupKey: keyof typeof markupStrings, priceField: keyof MasterProduct, input: string) => {
    if (!editingItem) return;
    
    // Permite digitar livremente (virgula virando ponto)
    const sanitizedInput = input.replace(',', '.');
    setMarkupStrings(prev => ({ ...prev, [markupKey]: sanitizedInput }));

    const markupPercent = parseFloat(sanitizedInput);
    const finalCost = calculateFinalCost(editingItem);

    if (isNaN(markupPercent)) {
      setEditingItem({ ...editingItem, [priceField]: 0 });
    } else {
      const calculatedPrice = finalCost * (1 + (markupPercent / 100));
      setEditingItem({ ...editingItem, [priceField]: Number(calculatedPrice.toFixed(2)) });
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 opacity-30">
      <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-4 flex flex-col h-full max-h-[calc(100vh-140px)]">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      {/* HEADER */}
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

      {/* BUSCA */}
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

      {/* TABELA DE PREÇOS */}
      <div className="table-container flex-1 overflow-y-auto bg-white border border-slate-100 rounded-[2.5rem] shadow-sm relative custom-scrollbar">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-30">
            <tr className="bg-slate-900 text-slate-400 text-[9px] font-black uppercase tracking-widest">
              <th className="px-8 py-6 text-left sticky left-0 z-40 bg-slate-900">Produto / SKU</th>
              <th className="px-4 py-6 text-center">Largura</th>
              <th className="px-4 py-6 text-center">Metragem</th>
              <th className="px-4 py-6 text-center">Status</th>
              <th className="px-6 py-6 text-center bg-indigo-900/20 text-indigo-400">Rolo (Mínimo)</th>
              <th className="px-6 py-6 text-center bg-indigo-900/30 text-indigo-200">Rolo (Ideal)</th>
              <th className="px-6 py-6 text-center bg-emerald-900/20 text-emerald-400">Frac. (Mínimo)</th>
              <th className="px-6 py-6 text-center bg-emerald-900/30 text-emerald-200">Frac. (Ideal)</th>
              <th className="px-6 py-6 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredProducts.map(p => {
              const hasStock = (stockMap[p.sku] || 0) > 0.01;
              const isInactive = p.active === false;

              return (
                <tr key={p.sku} className={`group hover:bg-indigo-50/20 transition-all ${isInactive ? 'opacity-40 grayscale' : ''}`}>
                  <td className="px-8 py-6 sticky left-0 z-10 bg-white group-hover:bg-indigo-50/20 shadow-[5px_0_10px_-5px_rgba(0,0,0,0.05)]">
                    <div className="flex flex-col">
                       <div className="flex items-center gap-2 mb-1">
                          <span className="bg-slate-100 text-slate-500 text-[8px] font-black px-1.5 py-0.5 rounded w-fit">{p.sku}</span>
                          {isInactive && <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter shadow-sm">PAUSADO</span>}
                       </div>
                       <span className="font-black text-slate-900 text-[12px] uppercase italic tracking-tight">{p.nome}</span>
                       <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">{p.categoria}</span>
                    </div>
                  </td>
                  <td className="px-4 py-6 text-center"><span className="text-[11px] font-bold text-slate-500">{p.larguraL?.toFixed(2) || '1.52'}m</span></td>
                  <td className="px-4 py-6 text-center"><span className="text-[11px] font-bold text-slate-500">{p.metragemPadrao || '15'}m</span></td>
                  <td className="px-4 py-6 text-center">
                    {hasStock ? (
                      <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg font-black text-[8px] uppercase italic shadow-sm">ESTOQUE</div>
                    ) : (
                      <div className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-lg font-black text-[8px] uppercase italic">DROP</div>
                    )}
                  </td>
                  <td className="px-6 py-6 text-center bg-indigo-50/10"><p className="text-xs font-black text-slate-900 italic">R$ {(p.priceRoloMin || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p></td>
                  <td className="px-6 py-6 text-center bg-indigo-50/20"><p className="text-sm font-black text-indigo-700 italic">R$ {(p.priceRoloIdeal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p></td>
                  <td className="px-6 py-6 text-center bg-emerald-50/10"><p className="text-xs font-black text-slate-900 italic">R$ {(p.priceFracMin || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p></td>
                  <td className="px-6 py-6 text-center bg-emerald-50/20"><p className="text-sm font-black text-emerald-700 italic">R$ {(p.priceFracIdeal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p></td>
                  <td className="px-6 py-6 text-right">
                    {isDiretoria ? (
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => handleToggleActive(p)} 
                          className={`p-2 border rounded-xl transition-all shadow-sm ${isInactive ? 'text-emerald-500 border-emerald-100 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-400 border-slate-200 bg-white hover:text-red-500 hover:border-red-200'}`}
                          title={isInactive ? "Ativar Produto" : "Inativar/Pausar Produto"}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                        <button onClick={() => setEditingItem(p)} className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeWidth="2.5"/></svg>
                        </button>
                      </div>
                    ) : (
                      <span className="text-[10px] font-black text-slate-300 uppercase italic tracking-widest">Leitura</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredProducts.length === 0 && (
          <div className="py-32 text-center flex flex-col items-center justify-center opacity-30">
            <svg className="w-16 h-16 text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9.172 9.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth="2"/></svg>
            <p className="font-black text-slate-400 uppercase tracking-widest text-[10px] italic">Nenhum material compatível com os filtros atuais.</p>
          </div>
        )}
      </div>

      {/* MODAL DE EDIÇÃO COMERCIAL */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-white max-w-5xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col border border-slate-100 animate-in zoom-in-95">
              <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                 <div>
                    <h3 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter">Gestão Comercial de SKU</h3>
                    <p className="text-indigo-600 font-bold text-[10px] uppercase tracking-widest mt-1">Precificação Inteligente sem Amarras</p>
                 </div>
                 <button onClick={() => setEditingItem(null)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all shadow-sm">
                    <ICONS.Add className="w-6 h-6 rotate-45" />
                 </button>
              </div>

              <div className="p-10 space-y-8 overflow-y-auto max-h-[75vh] custom-scrollbar">
                {/* Resumo Espelhado */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-slate-50 p-8 rounded-[2rem] border border-slate-100">
                   <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Identificação / SKU</label>
                        <p className="px-5 py-3 bg-white rounded-2xl font-black text-blue-600 text-sm italic border border-slate-200">{editingItem.sku}</p>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Descrição do Material</label>
                        <input 
                          value={editingItem.nome}
                          onChange={e => setEditingItem({...editingItem, nome: e.target.value.toUpperCase()})}
                          className="w-full px-5 py-3.5 bg-white border-2 border-transparent focus:border-indigo-600 rounded-2xl text-xs font-black outline-none uppercase"
                        />
                      </div>
                   </div>
                   
                   <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Largura (m)</label>
                        <input type="number" step="0.01" value={editingItem.larguraL || ''} onChange={e => setEditingItem({...editingItem, larguraL: parseFloat(e.target.value)})} className="w-full px-5 py-3.5 bg-white border-2 border-transparent focus:border-indigo-600 rounded-2xl text-xs font-black outline-none" placeholder="0.00" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Metragem Padrão (m)</label>
                        <input type="number" value={editingItem.metragemPadrao || ''} onChange={e => setEditingItem({...editingItem, metragemPadrao: parseFloat(e.target.value)})} className="w-full px-5 py-3.5 bg-white border-2 border-transparent focus:border-indigo-600 rounded-2xl text-xs font-black outline-none" placeholder="0" />
                      </div>

                      <div className="space-y-1 col-span-2 pt-2 border-t border-slate-200">
                         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-1">
                               <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Custo Base (R$)</label>
                               <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300">R$</span>
                                  <input type="number" step="0.01" value={editingItem.custoUnitario || ''} onChange={e => setEditingItem({...editingItem, custoUnitario: parseFloat(e.target.value)})} className="w-full pl-8 pr-4 py-3 bg-white border-2 border-transparent focus:border-indigo-400 rounded-xl text-xs font-black text-slate-700 outline-none italic" placeholder="0.00" />
                               </div>
                            </div>
                            <div className="space-y-1">
                               <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Imposto (%)</label>
                               <div className="relative">
                                  <input type="number" step="0.01" value={editingItem.costTaxPercent || ''} onChange={e => setEditingItem({...editingItem, costTaxPercent: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-white border-2 border-transparent focus:border-indigo-400 rounded-xl text-xs font-black text-slate-700 outline-none italic" placeholder="0%" />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300">%</span>
                               </div>
                            </div>
                            <div className="space-y-1">
                               <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Custos Extras (R$)</label>
                               <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300">R$</span>
                                  <input type="number" step="0.01" value={editingItem.costExtraValue || ''} onChange={e => setEditingItem({...editingItem, costExtraValue: parseFloat(e.target.value)})} className="w-full pl-8 pr-4 py-3 bg-white border-2 border-transparent focus:border-indigo-400 rounded-xl text-xs font-black text-slate-700 outline-none italic" placeholder="0,00" />
                               </div>
                            </div>
                         </div>
                         <div className="mt-4 px-5 py-3 bg-indigo-900 text-white rounded-2xl flex justify-between items-center shadow-lg">
                            <span className="text-[9px] font-black uppercase tracking-widest">Custo Final Composto:</span>
                            <span className="text-base font-black italic tracking-tighter">R$ {calculateFinalCost(editingItem).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                         </div>
                      </div>
                   </div>
                </div>

                {/* Bloco de Precificação Dinâmica */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                   {/* ROLO FECHADO */}
                   <div className="space-y-6 bg-indigo-50/20 p-6 rounded-[2rem] border border-indigo-50">
                      <div className="flex items-center gap-3">
                         <div className="w-1.5 h-6 bg-indigo-600 rounded-full"></div>
                         <h4 className="text-sm font-black text-slate-900 uppercase italic">Venda em Rolo Fechado</h4>
                      </div>
                      <div className="space-y-6">
                         <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                               <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Mínimo (R$)</label>
                               <input type="number" step="0.01" value={editingItem.priceRoloMin || ''} onChange={e => onPriceChange('priceRoloMin', e.target.value, 'roloMin')} className="w-full px-5 py-4 bg-white border-2 border-transparent focus:border-indigo-600 rounded-2xl text-lg font-black text-slate-900 outline-none italic shadow-sm" placeholder="0.00" />
                            </div>
                            <div className="space-y-1.5">
                               <label className="text-[9px] font-black text-indigo-600 uppercase tracking-widest ml-1">Markup (%)</label>
                               <input type="text" inputMode="decimal" value={markupStrings.roloMin} onChange={e => onMarkupChange('roloMin', 'priceRoloMin', e.target.value)} className="w-full px-5 py-4 bg-indigo-600 text-white border-2 border-transparent focus:border-indigo-400 rounded-2xl text-lg font-black outline-none italic shadow-sm" placeholder="0%" />
                            </div>
                         </div>
                         <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                               <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Ideal (R$)</label>
                               <input type="number" step="0.01" value={editingItem.priceRoloIdeal || ''} onChange={e => onPriceChange('priceRoloIdeal', e.target.value, 'roloIdeal')} className="w-full px-5 py-4 bg-white border-2 border-transparent focus:border-indigo-600 rounded-2xl text-xl font-black text-indigo-700 outline-none italic shadow-sm" placeholder="0.00" />
                            </div>
                            <div className="space-y-1.5">
                               <label className="text-[9px] font-black text-indigo-600 uppercase tracking-widest ml-1">Markup (%)</label>
                               <input type="text" inputMode="decimal" value={markupStrings.roloIdeal} onChange={e => onMarkupChange('roloIdeal', 'priceRoloIdeal', e.target.value)} className="w-full px-5 py-4 bg-indigo-800 text-white border-2 border-transparent focus:border-indigo-400 rounded-2xl text-xl font-black outline-none italic shadow-sm" placeholder="0%" />
                            </div>
                         </div>
                      </div>
                   </div>

                   {/* FRACIONADO */}
                   <div className="space-y-6 bg-emerald-50/20 p-6 rounded-[2rem] border border-emerald-50">
                      <div className="flex items-center gap-3">
                         <div className="w-1.5 h-6 bg-emerald-600 rounded-full"></div>
                         <h4 className="text-sm font-black text-slate-900 uppercase italic">Metro Fracionado</h4>
                      </div>
                      <div className="space-y-6">
                         <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                               <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Mínimo (R$)</label>
                               <input type="number" step="0.01" value={editingItem.priceFracMin || ''} onChange={e => onPriceChange('priceFracMin', e.target.value, 'fracMin')} className="w-full px-5 py-4 bg-white border-2 border-transparent focus:border-emerald-600 rounded-2xl text-lg font-black text-slate-900 outline-none italic shadow-sm" placeholder="0.00" />
                            </div>
                            <div className="space-y-1.5">
                               <label className="text-[9px] font-black text-emerald-600 uppercase tracking-widest ml-1">Markup (%)</label>
                               <input type="text" inputMode="decimal" value={markupStrings.fracMin} onChange={e => onMarkupChange('fracMin', 'priceFracMin', e.target.value)} className="w-full px-5 py-4 bg-emerald-600 text-white border-2 border-transparent focus:border-emerald-400 rounded-2xl text-lg font-black outline-none italic shadow-sm" placeholder="0%" />
                            </div>
                         </div>
                         <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                               <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Ideal (R$)</label>
                               <input type="number" step="0.01" value={editingItem.priceFracIdeal || ''} onChange={e => onPriceChange('priceFracIdeal', e.target.value, 'fracIdeal')} className="w-full px-5 py-4 bg-white border-2 border-transparent focus:border-emerald-600 rounded-2xl text-xl font-black text-emerald-700 outline-none italic shadow-sm" placeholder="0.00" />
                            </div>
                            <div className="space-y-1.5">
                               <label className="text-[9px] font-black text-emerald-600 uppercase tracking-widest ml-1">Markup (%)</label>
                               <input type="text" inputMode="decimal" value={markupStrings.fracIdeal} onChange={e => onMarkupChange('fracIdeal', 'priceFracIdeal', e.target.value)} className="w-full px-5 py-4 bg-emerald-800 text-white border-2 border-transparent focus:border-emerald-400 rounded-2xl text-xl font-black outline-none italic shadow-sm" placeholder="0%" />
                            </div>
                         </div>
                      </div>
                   </div>
                </div>
              </div>

              <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-end gap-4 shrink-0">
                 <button onClick={() => setEditingItem(null)} className="px-8 py-4 text-slate-400 font-black text-[10px] uppercase tracking-widest italic hover:text-slate-900 transition-colors">Descartar</button>
                 <button onClick={handleSavePrice} disabled={isSaving} className="px-12 py-4 bg-indigo-600 text-white rounded-[1.5rem] font-black text-[11px] uppercase tracking-[0.2em] shadow-xl hover:bg-indigo-700 transition-all italic active:scale-95 disabled:opacity-50">
                   {isSaving ? 'Sincronizando...' : 'Efetivar Preços e Sincronizar'}
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default SalesPriceTable;
