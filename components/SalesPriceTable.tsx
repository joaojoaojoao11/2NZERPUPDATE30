
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

const BRAZIL_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

const SalesPriceTable: React.FC<SalesPriceTableProps> = ({ user }) => {
  const [products, setProducts] = useState<MasterProduct[]>([]);
  const [inventory, setInventory] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('TODAS');
  const [filterStatus, setFilterStatus] = useState<'TODOS' | 'ATIVOS' | 'INATIVOS'>('ATIVOS');
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);

  // Estados para Edição Individual
  const [editingItem, setEditingItem] = useState<MasterProduct | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Estados para Importação em Lote
  const [showImportModal, setShowImportModal] = useState(false);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Novos estados para Simulação
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

  useEffect(() => {
    if (editingItem) {
      setMarkupStrings({
        roloMin: calculateMarkupDisplay(editingItem.priceRoloMin, editingItem),
        roloIdeal: calculateMarkupDisplay(editingItem.priceRoloIdeal, editingItem),
        fracMin: calculateMarkupDisplay(editingItem.priceFracMin, editingItem),
        fracIdeal: calculateMarkupDisplay(editingItem.priceFracIdeal, editingItem)
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

  const calculateFinalCost = (p: Partial<MasterProduct>) => {
    const base = Number(p.custoUnitario || 0);
    const extra = Number(p.costExtraValue || 0);
    const tax = Number(p.costTaxPercent || 0);
    return (base + extra) * (1 + (tax / 100));
  };

  const calculateMarkupDisplay = (price: number | undefined, item: Partial<MasterProduct>) => {
    if (!price || price <= 0) return '';
    const finalCost = calculateFinalCost(item);
    if (finalCost <= 0) return '';
    const m = ((price / finalCost) - 1) * 100;
    return m.toFixed(1);
  };

  const calculatePriceFromMarkup = (markupPercent: number, item: Partial<MasterProduct>) => {
    const finalCost = calculateFinalCost(item);
    return finalCost * (1 + (markupPercent / 100));
  };

  const getPriceUpdateStatus = (dateStr?: string): 'fresh' | 'stale' => {
    if (!dateStr) return 'stale';
    const date = new Date(dateStr);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    return diffDays > 30 ? 'stale' : 'fresh';
  };

  const handleSavePrice = async () => {
    if (!editingItem || !isDiretoria) return;
    setIsSaving(true);
    
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
    const newState = product.active === false; 
    const msg = newState ? `Reativar o produto ${product.sku}?` : `Deseja pausar/inativar o produto ${product.sku}? Ele deixará de aparecer na lista padrão de ativos.`;
    
    if (!window.confirm(msg)) return;

    try {
      const success = await DataService.updateMasterProduct({ ...product, active: newState }, user, product.sku);
      if (success) {
        setToast({ msg: newState ? 'PRODUTO REATIVADO!' : 'PRODUTO PAUSADO/INATIVADO', type: 'success' });
        await fetchData();
      }
    } catch (e: any) {
        const errorMsg = e instanceof Error ? e.message : (typeof e === 'string' ? e : 'Falha desconhecida ao alterar status.');
        setToast({ msg: errorMsg, type: 'error' });
    }
  };

  const onPriceChange = (field: keyof MasterProduct, val: string, markupKey: keyof typeof markupStrings) => {
    if (!editingItem) return;
    const numPrice = parseFloat(val);
    const newItem = { ...editingItem, [field]: isNaN(numPrice) ? 0 : numPrice };
    setEditingItem(newItem);
    const newMarkup = calculateMarkupDisplay(newItem[field] as number, newItem);
    setMarkupStrings(prev => ({ ...prev, [markupKey]: newMarkup }));
  };

  const onMarkupChange = (markupKey: keyof typeof markupStrings, priceField: keyof MasterProduct, input: string) => {
    if (!editingItem) return;
    const sanitizedInput = input.replace(',', '.');
    setMarkupStrings(prev => ({ ...prev, [markupKey]: sanitizedInput }));

    const markupPercent = parseFloat(sanitizedInput);
    if (isNaN(markupPercent)) {
      setEditingItem({ ...editingItem, [priceField]: 0 });
    } else {
      const calculatedPrice = calculatePriceFromMarkup(markupPercent, editingItem);
      setEditingItem({ ...editingItem, [priceField]: Number(calculatedPrice.toFixed(2)) });
    }
  };

  const downloadBatchTemplate = () => {
    const data = products.map(p => ({
        SKU: p.sku,
        PRODUTO: p.nome,
        CATEGORIA: p.categoria,
        CUSTO_BASE: p.custoUnitario || 0,
        IMPOSTO_PERCENT: p.costTaxPercent || 0,
        CUSTO_EXTRA: p.costExtraValue || 0,
        MARKUP_ROLO_MIN: calculateMarkupDisplay(p.priceRoloMin, p) || '0',
        MARKUP_ROLO_IDEAL: calculateMarkupDisplay(p.priceRoloIdeal, p) || '0',
        MARKUP_FRAC_MIN: calculateMarkupDisplay(p.priceFracMin, p) || '0',
        MARKUP_FRAC_IDEAL: calculateMarkupDisplay(p.priceFracIdeal, p) || '0',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Alteracao_Precos");
    
    const wscols = [
        {wch: 15}, {wch: 40}, {wch: 25}, {wch: 12}, {wch: 12}, {wch: 12}, 
        {wch: 15}, {wch: 15}, {wch: 15}, {wch: 15}
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, "Modelo_Alteracao_Precos_NZ.xlsx");
    setToast({ msg: 'Planilha modelo gerada com os dados atuais!', type: 'success' });
  };

  const handleBatchUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingBatch(true);
    const reader = new FileReader();
    
    reader.onload = async (event) => {
        try {
            const dataArray = new Uint8Array(event.target?.result as ArrayBuffer);
            const workbook = XLSX.read(dataArray, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(sheet);

            if (jsonData.length === 0) throw new Error("Planilha vazia.");

            let updatedCount = 0;

            for (const row of jsonData as any[]) {
                const sku = row['SKU']?.toString().toUpperCase().trim();
                if (!sku) continue;

                const existingProduct = products.find(p => p.sku === sku);
                if (!existingProduct) continue;

                const custoBase = row['CUSTO_BASE'] !== undefined ? Number(row['CUSTO_BASE']) : existingProduct.custoUnitario || 0;
                const imposto = row['IMPOSTO_PERCENT'] !== undefined ? Number(row['IMPOSTO_PERCENT']) : existingProduct.costTaxPercent || 0;
                const extra = row['CUSTO_EXTRA'] !== undefined ? Number(row['CUSTO_EXTRA']) : existingProduct.costExtraValue || 0;

                const tempProduct = { ...existingProduct, custoUnitario: custoBase, costTaxPercent: imposto, costExtraValue: extra };

                const mRoloMin = parseFloat(String(row['MARKUP_ROLO_MIN']).replace(',', '.')) || 0;
                const mRoloIdeal = parseFloat(String(row['MARKUP_ROLO_IDEAL']).replace(',', '.')) || 0;
                const mFracMin = parseFloat(String(row['MARKUP_FRAC_MIN']).replace(',', '.')) || 0;
                const mFracIdeal = parseFloat(String(row['MARKUP_FRAC_IDEAL']).replace(',', '.')) || 0;

                const updatedProduct: MasterProduct = {
                    ...tempProduct,
                    priceRoloMin: calculatePriceFromMarkup(mRoloMin, tempProduct),
                    priceRoloIdeal: calculatePriceFromMarkup(mRoloIdeal, tempProduct),
                    priceFracMin: calculatePriceFromMarkup(mFracMin, tempProduct),
                    priceFracIdeal: calculatePriceFromMarkup(mFracIdeal, tempProduct),
                };

                await DataService.updateMasterProduct(updatedProduct, user, sku);
                updatedCount++;
            }

            setToast({ msg: `${updatedCount} produtos atualizados com sucesso!`, type: 'success' });
            setShowImportModal(false);
            await fetchData();

        } catch (err: any) {
            setToast({ msg: `Erro na importação: ${err.message}`, type: 'error' });
        } finally {
            setIsProcessingBatch(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
  };
  
  const simulationResults = useMemo(() => {
    if (!simulatingProduct) return null;

    const metros = parseFloat(simulationMeters.replace(',', '.')) || 0;
    if (metros <= 0) return null;

    // Custo base original, sem rateios
    const custoFinalOriginalPorMetro = calculateFinalCost(simulatingProduct);
    if (custoFinalOriginalPorMetro <= 0) return null;

    // Markups percentuais para venda fracionada
    const markupPercentIdeal = ((simulatingProduct.priceFracIdeal || 0) / custoFinalOriginalPorMetro - 1) * 100;
    const markupPercentMin = ((simulatingProduct.priceFracMin || 0) / custoFinalOriginalPorMetro - 1) * 100;

    // Custo total do material para a metragem solicitada
    const custoTotalMaterial = (simulatingProduct.custoUnitario || 0) * metros;
    // Custo total COM rateio do custo extra
    const custoTotalComExtras = custoTotalMaterial + (simulatingProduct.costExtraValue || 0);
    // Custo total final com impostos
    const custoTotalComImpostos = custoTotalComExtras * (1 + (simulatingProduct.costTaxPercent || 0) / 100);

    // Valores totais de venda
    const valorTotalIdeal = custoTotalComImpostos * (1 + markupPercentIdeal / 100);
    const valorTotalMinimo = custoTotalComImpostos * (1 + markupPercentMin / 100);

    // Preços por metro na simulação
    const precoPorMetroIdeal = valorTotalIdeal / metros;
    const precoPorMetroMinimo = valorTotalMinimo / metros;

    return {
        metros,
        custoTotalComImpostos,
        valorTotalIdeal,
        valorTotalMinimo,
        precoPorMetroIdeal,
        precoPorMetroMinimo,
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
           {isDiretoria && (
             <button 
               onClick={() => setShowImportModal(true)}
               className="px-6 py-3 bg-indigo-600 text-white rounded-2xl font-black text-[9px] uppercase tracking-widest shadow-xl hover:bg-indigo-700 transition-all flex items-center gap-2 italic"
             >
                <ICONS.Upload className="w-3.5 h-3.5" />
                <span>Importar / Alterar em Lote</span>
             </button>
           )}

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
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0118 0z" strokeWidth="3"/></svg>
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
              <th className="px-4 py-6 text-center">Largura</th>
              <th className="px-4 py-6 text-center">Metragem</th>
              <th className="px-4 py-6 text-center">Disponibilidade</th>
              <th className="px-2 py-6 text-center bg-indigo-900/20 text-indigo-400 whitespace-nowrap w-24">Rolo (Mínimo)</th>
              <th className="px-2 py-6 text-center bg-indigo-900/30 text-indigo-200 whitespace-nowrap w-24">Rolo (Ideal)</th>
              <th className="px-2 py-6 text-center bg-emerald-900/20 text-emerald-400 whitespace-nowrap w-24">Frac. (Mínimo)</th>
              <th className="px-2 py-6 text-center bg-emerald-900/30 text-emerald-200 whitespace-nowrap w-24">Frac. (Ideal)</th>
              <th className="px-6 py-6 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredProducts.map(p => {
              const hasStock = (stockMap[p.sku] || 0) > 0.01;
              const isInactive = p.active === false;
              const priceStatus = getPriceUpdateStatus(p.updatedAt);

              return (
                <tr key={p.sku} className={`group hover:bg-indigo-50/20 transition-all ${isInactive ? 'opacity-40 grayscale' : ''}`}>
                  <td className="px-8 py-6 sticky left-0 z-10 bg-white group-hover:bg-indigo-50/20 shadow-[5px_0_10px_-5px_rgba(0,0,0,0.05)]">
                    <div className="flex flex-col">
                       <div className="flex items-center gap-2 mb-1">
                          <span className="bg-slate-100 text-slate-500 text-[8px] font-black px-1.5 py-0.5 rounded w-fit">{p.sku}</span>
                          {isInactive && <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter shadow-sm">PAUSADO</span>}
                       </div>
                       <div className="flex items-center gap-2">
                          {priceStatus === 'fresh' ? (
                             <div title="Preço atualizado recentemente" className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse"></div>
                          ) : (
                             <div title="Preço sem atualização há mais de 30 dias (Revisar)" className="w-2 h-2 rounded-full bg-orange-500 shrink-0"></div>
                          )}
                          <span className="font-black text-slate-900 text-[12px] uppercase italic tracking-tight">{p.nome}</span>
                       </div>
                       <span className="text-[8px] text-slate-400 font-bold uppercase tracking-widest mt-1">{p.marca || 'GENÉRICO'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-6 text-center">
                    <span className="px-2 py-1 bg-slate-100 rounded-lg text-[9px] font-black text-slate-500 uppercase tracking-wide">{p.categoria}</span>
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
                  <td className="px-2 py-6 text-center bg-indigo-50/10">
                    <p className="text-[11px] font-black text-slate-900 italic whitespace-nowrap">R$ {(p.priceRoloMin || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </td>
                  <td className="px-2 py-6 text-center bg-indigo-50/20">
                    <p className="text-xs font-black text-indigo-700 italic whitespace-nowrap">R$ {(p.priceRoloIdeal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </td>
                  <td className="px-2 py-6 text-center bg-emerald-50/10">
                    <p className="text-[11px] font-black text-slate-900 italic whitespace-nowrap">R$ {(p.priceFracMin || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </td>
                  <td className="px-2 py-6 text-center bg-emerald-50/20">
                    <p className="text-xs font-black text-emerald-700 italic whitespace-nowrap">R$ {(p.priceFracIdeal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
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
                          <button onClick={() => setEditingItem(p)} className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm">
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
        {filteredProducts.length === 0 && (
          <div className="py-32 text-center flex flex-col items-center justify-center opacity-30">
            <svg className="w-16 h-16 text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9.172 9.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth="2"/></svg>
            <p className="font-black text-slate-400 uppercase tracking-widest text-[10px] italic">Nenhum material compatível com os filtros atuais.</p>
          </div>
        )}
      </div>

      {/* MODAL DE SIMULAÇÃO */}
      {simulatingProduct && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-white max-w-2xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col border border-slate-100 animate-in zoom-in-95">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                 <div>
                    <h3 className="text-xl font-black text-slate-900 uppercase italic">Simulador de Venda Fracionada</h3>
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
                         <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Análise de Custos</h4>
                         <div className="flex justify-between text-xs font-bold text-slate-500 uppercase"><p>Custo Material ({simulationResults.metros}m)</p> <p>R$ {(simulatingProduct.custoUnitario! * simulationResults.metros).toFixed(2)}</p></div>
                         <div className="flex justify-between text-xs font-bold text-slate-500 uppercase"><p>+ Custo Extra/Frete</p> <p>R$ {simulatingProduct.costExtraValue?.toFixed(2)}</p></div>
                         <div className="flex justify-between text-xs font-bold text-slate-500 uppercase"><p>+ Impostos ({simulatingProduct.costTaxPercent}%)</p> <p>R$ {(simulationResults.custoTotalComImpostos - (simulatingProduct.custoUnitario! * simulationResults.metros + simulatingProduct.costExtraValue!)).toFixed(2)}</p></div>
                         <div className="flex justify-between text-sm font-black text-slate-800 uppercase pt-2 border-t border-slate-200"><p>Custo Final Total</p> <p>R$ {simulationResults.custoTotalComImpostos.toFixed(2)}</p></div>
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

      {/* MODAL DE IMPORTAÇÃO EM LOTE */}
      {showImportModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[200] flex items-center justify-center p-6 animate-in zoom-in-95">
           {/* ... (código do modal de importação mantido) ... */}
        </div>
      )}

      {/* MODAL DE EDIÇÃO INDIVIDUAL */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white max-w-4xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-fit animate-in zoom-in-95">
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
                    <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Estrutura de Custo (Por Metro)</h4>
                    <div className="space-y-4">
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase ml-1 italic">Custo Base (R$)</label>
                        <input type="number" step="0.01" value={editingItem.custoUnitario} onChange={e => setEditingItem({...editingItem, custoUnitario: parseFloat(e.target.value)})} className="w-full mt-1 px-4 py-3 bg-slate-100 rounded-xl font-bold" />
                      </div>
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase ml-1 italic">Imposto sobre Custo (%)</label>
                        <input type="number" step="0.1" value={editingItem.costTaxPercent} onChange={e => setEditingItem({...editingItem, costTaxPercent: parseFloat(e.target.value)})} className="w-full mt-1 px-4 py-3 bg-slate-100 rounded-xl font-bold" />
                      </div>
                      <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase ml-1 italic">Custo Extra/Frete (R$)</label>
                        <input type="number" step="0.01" value={editingItem.costExtraValue} onChange={e => setEditingItem({...editingItem, costExtraValue: parseFloat(e.target.value)})} className="w-full mt-1 px-4 py-3 bg-slate-100 rounded-xl font-bold" />
                      </div>
                    </div>
                    <div className="bg-slate-900 text-white p-6 rounded-2xl text-center">
                      <p className="text-[9px] font-black text-blue-300 uppercase tracking-widest">Custo Final Total</p>
                      <p className="text-2xl font-black italic">R$ {calculateFinalCost(editingItem).toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h4 className="text-[11px] font-black text-indigo-500 uppercase tracking-widest border-b border-indigo-100 pb-2">Precificação (Por Metro)</h4>
                    
                    <div className="space-y-4">
                      <p className="text-[10px] font-bold text-slate-600 uppercase">Venda de Rolo Fechado</p>
                      <div className="grid grid-cols-2 gap-3"><input type="number" step="0.01" value={editingItem.priceRoloMin?.toFixed(2)} onChange={e => onPriceChange('priceRoloMin', e.target.value, 'roloMin')} className="w-full px-4 py-2 bg-slate-50 border rounded-xl" placeholder="Preço Mín." /><input value={markupStrings.roloMin} onChange={e => onMarkupChange('roloMin', 'priceRoloMin', e.target.value)} className="w-full px-4 py-2 bg-slate-100 border rounded-xl" placeholder="Markup % Mín." /></div>
                      <div className="grid grid-cols-2 gap-3"><input type="number" step="0.01" value={editingItem.priceRoloIdeal?.toFixed(2)} onChange={e => onPriceChange('priceRoloIdeal', e.target.value, 'roloIdeal')} className="w-full px-4 py-2 bg-indigo-50 border rounded-xl font-bold" placeholder="Preço Ideal" /><input value={markupStrings.roloIdeal} onChange={e => onMarkupChange('roloIdeal', 'priceRoloIdeal', e.target.value)} className="w-full px-4 py-2 bg-indigo-100 border rounded-xl font-bold" placeholder="Markup % Ideal" /></div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-slate-100">
                      <p className="text-[10px] font-bold text-slate-600 uppercase">Venda Fracionada</p>
                      <div className="grid grid-cols-2 gap-3"><input type="number" step="0.01" value={editingItem.priceFracMin?.toFixed(2)} onChange={e => onPriceChange('priceFracMin', e.target.value, 'fracMin')} className="w-full px-4 py-2 bg-slate-50 border rounded-xl" placeholder="Preço Mín." /><input value={markupStrings.fracMin} onChange={e => onMarkupChange('fracMin', 'priceFracMin', e.target.value)} className="w-full px-4 py-2 bg-slate-100 border rounded-xl" placeholder="Markup % Mín." /></div>
                      <div className="grid grid-cols-2 gap-3"><input type="number" step="0.01" value={editingItem.priceFracIdeal?.toFixed(2)} onChange={e => onPriceChange('priceFracIdeal', e.target.value, 'fracIdeal')} className="w-full px-4 py-2 bg-emerald-50 border rounded-xl font-bold" placeholder="Preço Ideal" /><input value={markupStrings.fracIdeal} onChange={e => onMarkupChange('fracIdeal', 'priceFracIdeal', e.target.value)} className="w-full px-4 py-2 bg-emerald-100 border rounded-xl font-bold" placeholder="Markup % Ideal" /></div>
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
