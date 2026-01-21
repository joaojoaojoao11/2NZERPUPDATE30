
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DataService } from '../services/dataService';
import { MasterProduct, StockItem, User, AuditLog } from '../types';
import { ICONS, CATEGORIES } from '../constants';
import Toast from './Toast';
import ProductForm from './ProductForm';
import * as XLSX from 'xlsx';

interface SalesPriceTableProps { user: User; }

type SortKey = 'sku_nome' | 'categoria' | 'metragem' | 'estoque' | 'preco_rolo' | 'preco_frac';

interface BulkPriceStaging {
  sku: string;
  nome: string;
  oldData: Partial<MasterProduct>;
  newData: Partial<MasterProduct>;
  hasChange: boolean;
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
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>({ key: 'sku_nome', direction: 'asc' });

  // Estados para Importação em Lote
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkStaging, setBulkStaging] = useState<BulkPriceStaging[] | null>(null);
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // --- FUNÇÕES DE CÁLCULO DE MARKUP ---
  const getMarkup = (price: number | undefined, cost: number | undefined): number => {
    if (!price || !cost || cost <= 0) return 0;
    return Number((((price / cost) - 1) * 100).toFixed(2));
  };

  const getPriceFromMarkup = (markup: number, cost: number): number => {
    return Number((cost * (1 + (markup / 100))).toFixed(2));
  };

  const stockMap = useMemo(() => {
    const map: Record<string, number> = {};
    inventory.forEach(item => {
      if (item.quantMl > 0.01) { map[item.sku] = (map[item.sku] || 0) + item.quantMl; }
    });
    return map;
  }, [inventory]);

  // --- LÓGICA DE IMPORTAÇÃO EM LOTE EXPANDIDA ---
  const downloadPricingTemplate = () => {
    const template = products.map(p => {
      const cFrac = p.custoUnitarioFrac ?? p.custoUnitario ?? 0;
      const cRolo = p.custoUnitarioRolo ?? p.custoUnitario ?? 0;

      return {
        SKU: p.sku,
        NOME: p.nome,
        'DISPONIBILIDADE (Ref)': (stockMap[p.sku] || 0).toFixed(2), // Adicionado conforme solicitação (Apenas Referência)
        'CUSTO_FRAC_M (R$)': cFrac,
        'CUSTO_ROLO_M (R$)': cRolo,
        'CUSTO_EXTRA_FRETE_M (R$)': p.costExtraValue || 0,
        'IMPOSTO_SOBRE_CUSTO (%)': p.costTaxPercent || 0,
        'MARKUP_ROLO_MIN (%)': getMarkup(p.priceRoloMin, cRolo),
        'MARKUP_ROLO_IDEAL (%)': getMarkup(p.priceRoloIdeal, cRolo),
        'MARKUP_FRAC_MIN (%)': getMarkup(p.priceFracMin, cFrac),
        'MARKUP_FRAC_IDEAL (%)': getMarkup(p.priceFracIdeal, cFrac)
      };
    });

    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gestao_Comercial");
    ws['!cols'] = [
      { wch: 12 }, { wch: 35 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, 
      { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }
    ];
    XLSX.writeFile(wb, `NZ_Gabarito_Comercial_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setToast({ msg: 'Gabarito comercial gerado!', type: 'success' });
  };

  const handleBulkFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingBulk(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const dataArray = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(dataArray, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(sheet);

        // Helper para normalizar markup decimal (0.3 -> 30%)
        const normalizeMarkup = (val: any) => {
            let num = parseFloat(val) || 0;
            // Se o valor estiver entre 0 e 1, assume que é percentual decimal (ex: 0.3 = 30%)
            if (num > 0 && num <= 1.0) {
                num = num * 100;
            }
            return num;
        };

        const staging: BulkPriceStaging[] = jsonData.map((row: any) => {
          const sku = String(row.SKU || '').trim().toUpperCase();
          const product = products.find(p => p.sku === sku);
          if (!product) return null;

          // Valores vindos da planilha
          const nCFrac = parseFloat(row['CUSTO_FRAC_M (R$)']) || 0;
          const nCRolo = parseFloat(row['CUSTO_ROLO_M (R$)']) || 0;
          const nExtra = parseFloat(row['CUSTO_EXTRA_FRETE_M (R$)']) || 0;
          const nImposto = parseFloat(row['IMPOSTO_SOBRE_CUSTO (%)']) || 0;
          
          // Normaliza Markups (converte 0.3 para 30)
          const nMRoloMin = normalizeMarkup(row['MARKUP_ROLO_MIN (%)']);
          const nMRoloIdeal = normalizeMarkup(row['MARKUP_ROLO_IDEAL (%)']);
          const nMFracMin = normalizeMarkup(row['MARKUP_FRAC_MIN (%)']);
          const nMFracIdeal = normalizeMarkup(row['MARKUP_FRAC_IDEAL (%)']);

          // Calcula novos preços baseados nos novos custos e markups
          const nPRoloMin = getPriceFromMarkup(nMRoloMin, nCRolo);
          const nPRoloIdeal = getPriceFromMarkup(nMRoloIdeal, nCRolo);
          const nPFracMin = getPriceFromMarkup(nMFracMin, nCFrac);
          const nPFracIdeal = getPriceFromMarkup(nMFracIdeal, nCFrac);

          const hasChange = 
            Math.abs(nCFrac - (product.custoUnitarioFrac ?? product.custoUnitario ?? 0)) > 0.001 ||
            Math.abs(nCRolo - (product.custoUnitarioRolo ?? product.custoUnitario ?? 0)) > 0.001 ||
            Math.abs(nExtra - (product.costExtraValue || 0)) > 0.001 ||
            Math.abs(nImposto - (product.costTaxPercent || 0)) > 0.001 ||
            Math.abs(nPRoloMin - (product.priceRoloMin || 0)) > 0.01 ||
            Math.abs(nPRoloIdeal - (product.priceRoloIdeal || 0)) > 0.01 ||
            Math.abs(nPFracMin - (product.priceFracMin || 0)) > 0.01 ||
            Math.abs(nPFracIdeal - (product.priceFracIdeal || 0)) > 0.01;

          return {
            sku,
            nome: product.nome,
            oldData: { ...product },
            newData: {
              custoUnitarioFrac: nCFrac,
              custoUnitarioRolo: nCRolo,
              costExtraValue: nExtra,
              costTaxPercent: nImposto,
              priceRoloMin: nPRoloMin,
              priceRoloIdeal: nPRoloIdeal,
              priceFracMin: nPFracMin,
              priceFracIdeal: nPFracIdeal
            },
            hasChange
          };
        }).filter(Boolean) as BulkPriceStaging[];

        setBulkStaging(staging);
      } catch (err) {
        setToast({ msg: 'Erro ao processar planilha.', type: 'error' });
      } finally {
        setIsProcessingBulk(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const confirmBulkUpdate = async () => {
    if (!bulkStaging) return;
    const changedItems = bulkStaging.filter(s => s.hasChange);
    if (changedItems.length === 0) {
      setToast({ msg: 'Nenhuma alteração detectada.', type: 'warning' });
      setBulkStaging(null);
      return;
    }

    setIsProcessingBulk(true);
    try {
      let successCount = 0;
      for (const item of changedItems) {
        const product = products.find(p => p.sku === item.sku);
        if (product) {
          const updated = {
            ...product,
            ...item.newData
          };
          const res = await DataService.updateMasterProduct(updated, user, product.sku);
          if (res.success) successCount++;
        }
      }
      setToast({ msg: `${successCount} registros comerciais atualizados!`, type: 'success' });
      setBulkStaging(null);
      setShowBulkModal(false);
      fetchData();
    } catch (e) {
      setToast({ msg: 'Erro na atualização em lote.', type: 'error' });
    } finally {
      setIsProcessingBulk(false);
    }
  };

  const handleSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredProducts = useMemo(() => {
    let result = products.filter(p => {
      const matchesSearch = 
        p.sku.toLowerCase().includes(searchTerm.toLowerCase()) || 
        p.nome.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = filterCategory === 'TODAS' || p.categoria === filterCategory;
      
      let matchesStatus = true;
      if (filterStatus === 'ATIVOS') matchesStatus = p.active !== false;
      else if (filterStatus === 'INATIVOS') matchesStatus = p.active === false;

      return matchesSearch && matchesCategory && matchesStatus;
    });

    if (sortConfig) {
      result.sort((a, b) => {
        let valA: any;
        let valB: any;

        switch (sortConfig.key) {
          case 'sku_nome': valA = a.sku + a.nome; valB = b.sku + b.nome; break;
          case 'categoria': valA = a.categoria; valB = b.categoria; break;
          case 'metragem': valA = a.metragemPadrao || 0; valB = b.metragemPadrao || 0; break;
          case 'estoque': valA = (stockMap[a.sku] || 0) > 0 ? 1 : 0; valB = (stockMap[b.sku] || 0) > 0 ? 1 : 0; break;
          case 'preco_rolo': valA = (a.priceRoloIdeal || 0) * (a.metragemPadrao || 15); valB = (b.priceRoloIdeal || 0) * (b.metragemPadrao || 15); break;
          case 'preco_frac': valA = a.priceFracIdeal || 0; valB = b.priceFracIdeal || 0; break;
          default: return 0;
        }

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [products, searchTerm, filterCategory, filterStatus, sortConfig, stockMap]);

  const simulationResults = useMemo(() => {
    if (!simulatingProduct) return null;
    const meters = parseFloat(simulationMeters.replace(',', '.')) || 0;
    if (meters <= 0) return null;

    const isVolumeDeRolo = meters >= (simulatingProduct.metragemPadrao || 15);
    
    const custoUnitarioProduto = isVolumeDeRolo 
        ? (simulatingProduct.custoUnitarioRolo ?? simulatingProduct.custoUnitario ?? 0)
        : (simulatingProduct.custoUnitarioFrac ?? simulatingProduct.custoUnitario ?? 0);
    
    // Mantém o cálculo de custo operacional para exibição, como estava
    const custoExtraUnitario_ForCostDisplay = simulatingProduct.costExtraValue || 0;
    const impostoPercent = simulatingProduct.costTaxPercent || 0;
    const custoOperacionalTotal = ((custoUnitarioProduto + custoExtraUnitario_ForCostDisplay) * meters) * (1 + (impostoPercent / 100));

    // Pega os preços base (com markup, sem custo extra)
    const precoMetroIdeal_base = isVolumeDeRolo ? (simulatingProduct.priceRoloIdeal || 0) : (simulatingProduct.priceFracIdeal || 0);
    const precoMetroMinimo_base = isVolumeDeRolo ? (simulatingProduct.priceRoloMin || 0) : (simulatingProduct.priceFracMin || 0);

    // Pega o custo extra/frete. Este valor será diluído na simulação.
    const custoExtraPorMetro = simulatingProduct.costExtraValue || 0;
    
    // Nova Lógica: O custo extra é dividido pela metragem simulada para encontrar o "acréscimo por metro"
    const custoExtraDiluidoPorMetro = meters > 0 ? (custoExtraPorMetro / meters) : custoExtraPorMetro;
    
    // O novo preço por metro é o preço base + o custo extra diluído
    const precoMetroIdeal_final = precoMetroIdeal_base + custoExtraDiluidoPorMetro;
    const precoMetroMinimo_final = precoMetroMinimo_base + custoExtraDiluidoPorMetro;

    // O valor total é o novo preço por metro multiplicado pela metragem
    const valorTotalIdeal_final = precoMetroIdeal_final * meters;
    const valorTotalMinimo_final = precoMetroMinimo_final * meters;

    return {
        isVolumeDeRolo,
        // Mantém para exibição da estrutura de custos
        custoUnitarioProduto,
        custoExtraUnitario: custoExtraUnitario_ForCostDisplay,
        impostoPercent,
        custoOperacionalTotal,
        // Novos valores finais para preço de venda
        valorTotalIdeal: valorTotalIdeal_final,
        valorTotalMinimo: valorTotalMinimo_final,
        precoMetroIdeal: precoMetroIdeal_final,
        precoMetroMinimo: precoMetroMinimo_final
    };
  }, [simulatingProduct, simulationMeters]);

  const onCostChange = (field: 'custoUnitarioFrac' | 'custoUnitarioRolo', value: string) => {
    if (!editingItem) return;
    const numVal = parseFloat(value) || 0;
    const updated = { ...editingItem, [field]: numVal };
    
    if (field === 'custoUnitarioRolo') {
      updated.priceRoloMin = getPriceFromMarkup(parseFloat(markupStrings.roloMin) || 0, numVal);
      updated.priceRoloIdeal = getPriceFromMarkup(parseFloat(markupStrings.roloIdeal) || 0, numVal);
    } else {
      updated.priceFracMin = getPriceFromMarkup(parseFloat(markupStrings.fracMin) || 0, numVal);
      updated.priceFracIdeal = getPriceFromMarkup(parseFloat(markupStrings.fracIdeal) || 0, numVal);
    }
    
    setEditingItem(updated);
  };

  const onMarkupChange = (markupKey: keyof typeof markupStrings, priceKey: keyof MasterProduct, val: string, isRolo: boolean) => {
    if (!editingItem) return;
    setMarkupStrings(prev => ({ ...prev, [markupKey]: val }));
    
    // Normalização automática de input manual: se digitar 0.3, considera 30%
    let markupNum = parseFloat(val.replace(',', '.')) || 0;
    if (markupNum > 0 && markupNum <= 1) {
        markupNum = markupNum * 100;
    }

    const cost = isRolo 
        ? (editingItem.custoUnitarioRolo ?? editingItem.custoUnitario ?? 0)
        : (editingItem.custoUnitarioFrac ?? editingItem.custoUnitario ?? 0);
    
    const newPrice = getPriceFromMarkup(markupNum, cost);
    setEditingItem({ ...editingItem, [priceKey]: newPrice });
  };

  const filteredLogs = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return logs.filter(l => 
        (l.sku || '').toLowerCase().includes(term) || 
        (l.nome || '').toLowerCase().includes(term) ||
        (l.usuario || '').toLowerCase().includes(term) ||
        (l.detalhes || '').toLowerCase().includes(term)
    );
  }, [logs, searchTerm]);

  const SortIndicator = ({ activeKey }: { activeKey: SortKey }) => {
    const isActive = sortConfig?.key === activeKey;
    return (
      <span className={`ml-2 text-[10px] transition-all ${isActive ? 'text-indigo-400 opacity-100' : 'text-slate-600 opacity-30 group-hover:opacity-60'}`}>
        {isActive && sortConfig?.direction === 'desc' ? '▼' : '▲'}
      </span>
    );
  };

  const handleSavePrice = async () => {
    if (!editingItem || !isDiretoria) return;
    setIsSaving(true);
    try {
      const result = await DataService.updateMasterProduct(editingItem, user, editingItem.sku);
      if (result.success) {
        if (result.warning) setToast({ msg: result.warning, type: 'warning' });
        else setToast({ msg: 'PARÂMETROS ATUALIZADOS!', type: 'success' });
        setEditingItem(null);
        await fetchData();
      }
    } catch (e: any) {
      setToast({ msg: e.message || 'Falha ao gravar.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (product: MasterProduct) => {
    if (!isDiretoria) return;
    const newState = product.active === false; 
    if (!window.confirm(newState ? `Reativar o produto ${product.sku}?` : `Inativar o produto ${product.sku}?`)) return;
    try {
      const res = await DataService.updateMasterProduct({ ...product, active: newState }, user, product.sku);
      if (res.success) {
        setToast({ msg: newState ? 'PRODUTO REATIVADO!' : 'PRODUTO PAUSADO', type: 'success' });
        await fetchData();
      }
    } catch (e: any) { setToast({ msg: 'Falha ao alterar status.', type: 'error' }); }
  };

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
             <button onClick={() => setActiveTab('TABLE')} className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'TABLE' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}>Precificação Atual</button>
             <button onClick={() => setActiveTab('LOG')} className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'LOG' ? 'bg-indigo-900 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}>Log de Alterações</button>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {isDiretoria && activeTab === 'TABLE' && (
            <button 
              onClick={() => setShowBulkModal(true)}
              className="px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black text-[9px] uppercase tracking-widest shadow-sm hover:bg-indigo-50 hover:text-indigo-600 transition-all flex items-center space-x-2 italic"
            >
              <ICONS.Upload className="w-3.5 h-3.5" />
              <span>Ajuste Global em Lote</span>
            </button>
          )}

          {activeTab === 'TABLE' && (
            <>
              <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-3 border-r border-slate-100 italic">Status</span>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="bg-transparent border-none outline-none text-xs font-black text-slate-700 uppercase px-3 py-1 cursor-pointer">
                    <option value="ATIVOS">Apenas Ativos</option>
                    <option value="INATIVOS">Apenas Pausados</option>
                    <option value="TODOS">Todos os Itens</option>
                  </select>
              </div>
              <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-3 border-r border-slate-100 italic">Categoria</span>
                  <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="bg-transparent border-none outline-none text-xs font-black text-slate-700 uppercase px-3 py-1 cursor-pointer">
                    {['TODAS', ...Array.from(new Set(products.map(p => p.categoria)))].sort().map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-white p-2 rounded-[2.5rem] border border-slate-200 shadow-sm flex items-center shrink-0">
         <div className="pl-6 text-slate-300"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="3"/></svg></div>
         <input type="text" placeholder={activeTab === 'TABLE' ? "BUSCAR MATERIAL NA TABELA (SKU OU NOME)..." : "BUSCAR LOGS (SKU, NOME OU OPERADOR)..."} className="w-full px-6 py-4 bg-transparent outline-none font-black text-sm uppercase placeholder:text-slate-200" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
      </div>

      {activeTab === 'TABLE' ? (
        <div className="table-container flex-1 overflow-y-auto bg-white border border-slate-100 rounded-[2.5rem] shadow-sm relative custom-scrollbar">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-30">
              <tr className="bg-slate-900 text-slate-400 text-[9px] font-black uppercase tracking-widest">
                <th className="px-8 py-6 text-left sticky left-0 z-40 bg-slate-900 cursor-pointer group select-none" onClick={() => handleSort('sku_nome')}><div className="flex items-center">Produto / SKU <SortIndicator activeKey="sku_nome" /></div></th>
                <th className="px-4 py-6 text-center cursor-pointer group select-none" onClick={() => handleSort('categoria')}><div className="flex items-center justify-center">Categoria <SortIndicator activeKey="categoria" /></div></th>
                <th className="px-4 py-6 text-center cursor-pointer group select-none" onClick={() => handleSort('metragem')}><div className="flex items-center justify-center">Metragem <SortIndicator activeKey="metragem" /></div></th>
                <th className="px-4 py-6 text-center cursor-pointer group select-none" onClick={() => handleSort('estoque')}><div className="flex items-center justify-center">Disponibilidade <SortIndicator activeKey="estoque" /></div></th>
                <th className="px-2 py-6 text-center bg-indigo-950/40 text-indigo-300 whitespace-nowrap w-24">Rolo (Mín)</th>
                <th className="px-2 py-6 text-center bg-indigo-900/20 text-indigo-400 whitespace-nowrap w-24 cursor-pointer group select-none" onClick={() => handleSort('preco_rolo')}><div className="flex items-center justify-center">Rolo (Ideal) <SortIndicator activeKey="preco_rolo" /></div></th>
                <th className="px-2 py-6 text-center bg-emerald-950/40 text-emerald-300 whitespace-nowrap w-24">Frac. (Mín/m)</th>
                <th className="px-2 py-6 text-center bg-emerald-900/30 text-emerald-200 whitespace-nowrap w-24 cursor-pointer group select-none" onClick={() => handleSort('preco_frac')}><div className="flex items-center justify-center">Frac. (Ideal/m) <SortIndicator activeKey="preco_frac" /></div></th>
                <th className="px-6 py-6 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredProducts.map(p => {
                // Lógica da Bolinha de Status (30 dias)
                const lastUpdateDate = p.updatedAt ? new Date(p.updatedAt) : null;
                const now = new Date();
                const diffTime = lastUpdateDate ? (now.getTime() - lastUpdateDate.getTime()) : Infinity;
                const isUpdatedRecently = diffTime < (30 * 24 * 60 * 60 * 1000);
                
                // Validação de disponibilidade para o botão Simular (Apenas DROP)
                const availableStock = stockMap[p.sku] || 0;
                const isDrop = availableStock <= 0.01;

                return (
                  <tr key={p.sku} className={`group hover:bg-indigo-50/20 transition-all ${p.active === false ? 'opacity-40 grayscale' : ''}`}>
                    <td className="px-8 py-6 sticky left-0 z-10 bg-white group-hover:bg-indigo-50/20 shadow-[5px_0_10px_-5px_rgba(0,0,0,0.05)]">
                      <div className="flex flex-col">
                         <div className="flex items-center gap-2 mb-1">
                            <span className="bg-slate-100 text-slate-500 text-[8px] font-black px-1.5 py-0.5 rounded w-fit uppercase">{p.sku}</span>
                            {p.active === false && <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter">PAUSADO</span>}
                         </div>
                         <div className="flex items-center gap-2">
                            {/* Bolinha de Status de Atualização */}
                            <div 
                              className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-sm transition-all ${isUpdatedRecently ? 'bg-emerald-500 animate-pulse ring-2 ring-emerald-100' : 'bg-amber-500'}`}
                              title={lastUpdateDate ? `Última alteração: ${lastUpdateDate.toLocaleDateString('pt-BR')}` : 'Sem registro de alteração'}
                            ></div>
                            <span className="font-black text-slate-900 text-[12px] uppercase italic tracking-tight truncate max-w-[250px]">{p.nome}</span>
                         </div>
                      </div>
                    </td>
                    <td className="px-4 py-6 text-center"><span className="px-2 py-1 bg-slate-100 rounded-lg text-[9px] font-black text-slate-500 uppercase tracking-wide">{p.categoria}</span></td>
                    <td className="px-4 py-6 text-center"><span className="text-[11px] font-bold text-slate-500">{p.metragemPadrao || 15}m</span></td>
                    <td className="px-4 py-6 text-center">
                      {(stockMap[p.sku] || 0) > 0.01 ? (
                        <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg font-black text-[8px] uppercase italic shadow-sm">ESTOQUE</div>
                      ) : (
                        <div className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 border-amber-100 rounded-lg font-black text-[8px] uppercase italic">DROP</div>
                      )}
                    </td>
                    <td className="px-2 py-6 text-center bg-indigo-50/10 text-[11px] font-bold text-slate-400 italic">R$ {((p.priceRoloMin || 0) * (p.metragemPadrao || 15)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="px-2 py-6 text-center bg-indigo-50/20 text-xs font-black text-indigo-700 italic border-x border-slate-100/50">R$ {((p.priceRoloIdeal || 0) * (p.metragemPadrao || 15)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="px-2 py-6 text-center bg-emerald-50/10 text-[11px] font-bold text-slate-400 italic">R$ {(p.priceFracMin || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="px-2 py-6 text-center bg-emerald-50/20 text-xs font-black text-emerald-700 italic border-x border-slate-100/50">R$ {(p.priceFracIdeal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="px-6 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {isDrop && (
                            <button onClick={() => { setSimulatingProduct(p); setSimulationMeters('1'); }} className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-green-600 hover:border-green-200 transition-all shadow-sm" title="Simular"><ICONS.Calculator className="w-4 h-4" /></button>
                        )}
                        {isDiretoria && (
                          <>
                            <button onClick={() => handleToggleActive(p)} className={`p-2 border rounded-xl transition-all shadow-sm ${p.active === false ? 'text-emerald-500 border-emerald-100 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-400 border-slate-200 bg-white hover:text-red-500 hover:border-red-200'}`} title={p.active === false ? "Ativar" : "Inativar"}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
                            <button onClick={() => { setEditingItem(p); setMarkupStrings({ roloMin: getMarkup(p.priceRoloMin, p.custoUnitarioRolo ?? p.custoUnitario).toString(), roloIdeal: getMarkup(p.priceRoloIdeal, p.custoUnitarioRolo ?? p.custoUnitario).toString(), fracMin: getMarkup(p.priceFracMin, p.custoUnitarioFrac ?? p.custoUnitario).toString(), fracIdeal: getMarkup(p.priceFracIdeal, p.custoUnitarioFrac ?? p.custoUnitario).toString() }); }} className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm" title="Gerir SKU"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" strokeWidth="2.5"/></svg></button>
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
              <thead><tr className="bg-slate-900 text-slate-400 text-[9px] font-black uppercase tracking-widest"><th className="px-8 py-6 text-left">Data / Hora</th><th className="px-4 py-6 text-left">SKU / Produto</th><th className="px-4 py-6 text-left">Operador</th><th className="px-4 py-6 text-left">Detalhes da Alteração</th></tr></thead>
              <tbody className="divide-y divide-slate-50">
                {filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-8 py-6"><div className="flex flex-col"><span className="text-[11px] font-black text-slate-900 leading-none">{new Date(log.timestamp).toLocaleDateString('pt-BR')}</span><span className="text-[9px] font-bold text-slate-400 mt-1 uppercase">{new Date(log.timestamp).toLocaleTimeString('pt-BR')}</span></div></td>
                    <td className="px-4 py-6"><div className="flex flex-col"><span className="bg-slate-100 text-slate-500 text-[8px] font-black px-1.5 py-0.5 rounded w-fit uppercase">{log.sku}</span><span className="font-black text-slate-800 text-[11px] uppercase italic truncate max-w-[200px] mt-1">{log.nome}</span></div></td>
                    <td className="px-4 py-6"><span className="text-[10px] font-black text-blue-600 uppercase tracking-tighter">@{log.usuario.split('@')[0]}</span></td>
                    <td className="px-4 py-6"><p className="text-[10px] font-medium text-slate-500 leading-relaxed uppercase italic">"{log.detalhes}"</p></td>
                  </tr>
                ))}
              </tbody>
           </table>
        </div>
      )}

      {/* MODAL DE IMPORTAÇÃO EM LOTE GLOBAL */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white max-w-7xl w-full rounded-[3rem] shadow-2xl overflow-hidden flex flex-col h-[85vh] animate-in zoom-in-95 border border-slate-100">
            <div className="p-10 border-b border-slate-50 flex justify-between items-center bg-slate-50/50 shrink-0">
               <div>
                  <h3 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter">Ajuste Estrutural em Lote</h3>
                  <p className="text-blue-600 font-bold text-[10px] uppercase tracking-widest mt-1 italic">Gestão completa de Custos, Frete, Impostos e Markups</p>
               </div>
               <button onClick={() => { setShowBulkModal(false); setBulkStaging(null); }} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all"><ICONS.Add className="w-6 h-6 rotate-45" /></button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/30">
               {!bulkStaging ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-10 space-y-8">
                     <div className="w-24 h-24 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center shadow-inner"><ICONS.Upload className="w-12 h-12" /></div>
                     <div className="text-center max-w-xl space-y-6">
                        <p className="text-slate-500 font-medium text-sm">Baixe o gabarito oficial. Todos os campos disponíveis no Gestor de SKU (Custos, Frete, Impostos e Markups) podem ser alterados simultaneamente.</p>
                        <div className="flex gap-4 justify-center">
                           <button onClick={downloadPricingTemplate} className="px-8 py-4 bg-white border-2 border-slate-200 text-slate-700 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center space-x-3 italic"><span>Baixar Gabarito Estrutural</span></button>
                           <button onClick={() => fileInputRef.current?.click()} disabled={isProcessingBulk} className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-indigo-600 transition-all flex items-center space-x-3 italic"><span>Selecionar Planilha Preenchida</span></button>
                        </div>
                        <input type="file" ref={fileInputRef} onChange={handleBulkFileUpload} accept=".xlsx,.xls" className="hidden" />
                     </div>
                  </div>
               ) : (
                  <div className="flex flex-col h-full">
                     <div className="flex-1 overflow-auto p-10 custom-scrollbar">
                        <table className="w-full text-left" style={{ minWidth: '1600px' }}>
                           <thead className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest sticky top-0 z-10 shadow-sm">
                              <tr>
                                 <th className="px-6 py-4">Status</th>
                                 <th className="px-6 py-4">Material / SKU</th>
                                 <th className="px-6 py-4 text-center">Custos (Frac / Rolo)</th>
                                 <th className="px-6 py-4 text-center">Extras (Frete / Imposto)</th>
                                 <th className="px-6 py-4 text-center">Markups Rolo (Min / Ideal)</th>
                                 <th className="px-6 py-4 text-center">Markups Frac (Min / Ideal)</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100 bg-white">
                              {bulkStaging.map((row, idx) => (
                                 <tr key={idx} className={`hover:bg-slate-50 transition-all ${row.hasChange ? 'bg-indigo-50/30' : 'opacity-40'}`}>
                                    <td className="px-6 py-4"><span className={`px-2 py-1 rounded text-[8px] font-black uppercase border ${row.hasChange ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-slate-100 text-slate-400'}`}>{row.hasChange ? 'ALTERADO' : 'IGUAL'}</span></td>
                                    <td className="px-6 py-4"><p className="font-black text-slate-900 text-[11px]">{row.sku}</p><p className="text-[9px] text-slate-400 uppercase truncate max-w-[180px]">{row.nome}</p></td>
                                    {/* Comparação de Custos */}
                                    <td className="px-6 py-4 text-center">
                                       <div className="flex flex-col items-center gap-1">
                                          <div className="flex gap-2">
                                             <span className={`text-[10px] font-black ${row.newData.custoUnitarioFrac !== row.oldData.custoUnitarioFrac ? 'text-indigo-600 underline' : 'text-slate-500'}`}>F: R$ {row.newData.custoUnitarioFrac?.toFixed(2)}</span>
                                             <span className={`text-[10px] font-black ${row.newData.custoUnitarioRolo !== row.oldData.custoUnitarioRolo ? 'text-indigo-600 underline' : 'text-slate-500'}`}>R: R$ {row.newData.custoUnitarioRolo?.toFixed(2)}</span>
                                          </div>
                                       </div>
                                    </td>
                                    {/* Comparação Extras */}
                                    <td className="px-6 py-4 text-center">
                                       <div className="flex flex-col items-center gap-1">
                                          <div className="flex gap-2">
                                             <span className={`text-[10px] font-black ${row.newData.costExtraValue !== row.oldData.costExtraValue ? 'text-blue-600' : 'text-slate-500'}`}>FR: R$ {row.newData.costExtraValue?.toFixed(2)}</span>
                                             <span className={`text-[10px] font-black ${row.newData.costTaxPercent !== row.oldData.costTaxPercent ? 'text-amber-600' : 'text-slate-500'}`}>IM: {row.newData.costTaxPercent?.toFixed(1)}%</span>
                                          </div>
                                       </div>
                                    </td>
                                    {/* Markups Rolo */}
                                    <td className="px-6 py-4 text-center">
                                       <div className="flex gap-3 justify-center">
                                          <div className="flex flex-col"><span className="text-[8px] text-slate-300">Min</span><span className={`text-[10px] font-black ${row.newData.priceRoloMin !== row.oldData.priceRoloMin ? 'text-indigo-600' : 'text-slate-500'}`}>{getMarkup(row.newData.priceRoloMin, row.newData.custoUnitarioRolo as number)}%</span></div>
                                          <div className="flex flex-col"><span className="text-[8px] text-slate-300">Ideal</span><span className={`text-[10px] font-black ${row.newData.priceRoloIdeal !== row.oldData.priceRoloIdeal ? 'text-indigo-600' : 'text-slate-500'}`}>{getMarkup(row.newData.priceRoloIdeal, row.newData.custoUnitarioRolo as number)}%</span></div>
                                       </div>
                                    </td>
                                    {/* Markups Frac */}
                                    <td className="px-6 py-4 text-center">
                                       <div className="flex gap-3 justify-center">
                                          <div className="flex flex-col"><span className="text-[8px] text-slate-300">Min</span><span className={`text-[10px] font-black ${row.newData.priceFracMin !== row.oldData.priceFracMin ? 'text-emerald-600' : 'text-slate-500'}`}>{getMarkup(row.newData.priceFracMin, row.newData.custoUnitarioFrac as number)}%</span></div>
                                          <div className="flex flex-col"><span className="text-[8px] text-slate-300">Ideal</span><span className={`text-[10px] font-black ${row.newData.priceFracIdeal !== row.oldData.priceFracIdeal ? 'text-emerald-600' : 'text-slate-500'}`}>{getMarkup(row.newData.priceFracIdeal, row.newData.custoUnitarioFrac as number)}%</span></div>
                                       </div>
                                    </td>
                                 </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                     <div className="p-10 border-t border-slate-50 bg-slate-50/50 flex justify-between items-center shrink-0">
                        <div className="space-y-1"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Resumo de Alterações</p><p className="text-2xl font-black text-slate-900 uppercase italic">{bulkStaging.filter(s => s.hasChange).length} SKUs reajustados</p></div>
                        <div className="flex gap-4">
                           <button onClick={() => setBulkStaging(null)} className="px-8 py-4 bg-white border border-slate-200 text-slate-400 font-black rounded-2xl text-[10px] uppercase tracking-widest hover:text-red-500 transition-all italic">Descartar</button>
                           <button onClick={confirmBulkUpdate} disabled={isProcessingBulk || bulkStaging.filter(s => s.hasChange).length === 0} className="px-12 py-4 bg-indigo-600 text-white rounded-[1.5rem] font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-indigo-500 transition-all active:scale-95 disabled:opacity-30 italic">{isProcessingBulk ? 'Sincronizando...' : 'Confirmar e Aplicar Todos'}</button>
                        </div>
                     </div>
                  </div>
               )}
            </div>
          </div>
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
                    <p className="text-slate-400 font-bold text-[9px] uppercase tracking-wide mt-0.5 truncate max-w-[350px]">{simulatingProduct.nome}</p>
                 </div>
                 <button onClick={() => setSimulatingProduct(null)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all shadow-sm"><ICONS.Add className="w-5 h-5 rotate-45" /></button>
              </div>
              <div className="p-8 space-y-6">
                 <div className="space-y-2"><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Metragem Solicitada (m)</label><input type="text" value={simulationMeters} onChange={e => setSimulationMeters(e.target.value)} className="w-full px-6 py-4 bg-slate-100 border-2 border-transparent focus:border-blue-600 rounded-2xl font-black text-3xl text-center text-slate-800 outline-none transition-all shadow-inner no-spinner" placeholder="0,00" autoFocus /></div>
                 {simulationResults && (
                   <div className="space-y-6 pt-6 border-t border-slate-100 animate-in fade-in">
                      {isDiretoria && (
                        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-3">
                           <div className="flex justify-between items-center mb-2"><h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Estrutura de Custos Externos</h4><span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${simulationResults.isVolumeDeRolo ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>{simulationResults.isVolumeDeRolo ? 'Base: Rolo Fechado' : 'Base: Fracionado'}</span></div>
                           <div className="flex justify-between text-[11px] font-bold text-slate-500 uppercase"><p>Custo Produto ({simulationResults.isVolumeDeRolo ? 'Rolo' : 'Frac'})</p><p>R$ {simulationResults.custoUnitarioProduto.toFixed(2)} /m</p></div>
                           <div className="flex justify-between text-[11px] font-bold text-blue-600 uppercase border-t border-slate-200/50 pt-2"><p>(+) Custo Extra / Frete</p><p>R$ {simulationResults.custoExtraUnitario.toFixed(2)} /m</p></div>
                           <div className="flex justify-between text-[11px] font-bold text-amber-600 uppercase"><p>(+) Impostos Incidência</p><p>{simulationResults.impostoPercent}%</p></div>
                           <div className="flex justify-between text-xs font-black text-slate-800 uppercase border-t border-slate-300 pt-2"><p>Custo Real Total do Pedido</p><p>R$ {simulationResults.custoOperacionalTotal.toFixed(2)}</p></div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-6">
                         <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100 text-center"><p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-1">Preço Venda Ideal</p><p className="text-2xl font-black text-emerald-800 italic">R$ {simulationResults.valorTotalIdeal.toFixed(2)}</p><p className="text-[10px] font-bold text-emerald-600 mt-1">(R$ {simulationResults.precoMetroIdeal.toFixed(2)} / metro)</p></div>
                         <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100 text-center"><p className="text-[9px] font-black text-amber-700 uppercase tracking-widest mb-1">Preço Venda Mínimo</p><p className="text-2xl font-black text-amber-800 italic">R$ {simulationResults.valorTotalMinimo.toFixed(2)}</p><p className="text-[10px] font-bold text-emerald-600 mt-1">(R$ {simulationResults.precoMetroMinimo.toFixed(2)} / metro)</p></div>
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
              <div className="p-10 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                  <div><h3 className="text-2xl font-black text-slate-900 uppercase italic">Gestão Comercial de SKU</h3><p className="text-indigo-600 font-bold text-[10px] uppercase tracking-widest mt-1">{editingItem.sku}</p></div>
                  <button onClick={() => setEditingItem(null)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all"><ICONS.Add className="w-6 h-6 rotate-45" /></button>
              </div>
              <div className="p-10 space-y-10 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div className="space-y-6">
                    <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2 italic">Estrutura de Custo Base (R$)</h4>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase ml-1 italic">Custo Fracionado (m)</label><input type="number" step="0.01" value={editingItem.custoUnitarioFrac || 0} onChange={e => onCostChange('custoUnitarioFrac', e.target.value)} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border border-slate-200 focus:border-indigo-500 outline-none no-spinner" /></div>
                        <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase ml-1 italic">Custo Rolo (m)</label><input type="number" step="0.01" value={editingItem.custoUnitarioRolo || 0} onChange={e => onCostChange('custoUnitarioRolo', e.target.value)} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border border-slate-200 focus:border-indigo-500 outline-none no-spinner" /></div>
                      </div>
                      <div className="bg-slate-100/50 p-4 rounded-2xl border border-slate-200/50 space-y-4">
                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1 italic">Parâmetros Externos (Exclusivos Simulador)</p>
                        <div className="grid grid-cols-2 gap-4">
                           <div><label className="text-[9px] font-black text-blue-600 uppercase ml-1 italic">Custo Extra/Frete (m)</label><input type="number" step="0.01" value={editingItem.costExtraValue || 0} onChange={e => setEditingItem({...editingItem, costExtraValue: parseFloat(e.target.value) || 0})} className="w-full px-4 py-3 bg-white rounded-xl font-bold border border-slate-200 focus:border-blue-500 outline-none no-spinner" /></div>
                           <div><label className="text-[9px] font-black text-blue-600 uppercase ml-1 italic">Imposto s/ Custo (%)</label><input type="number" step="0.1" value={editingItem.costTaxPercent || 0} onChange={e => setEditingItem({...editingItem, costTaxPercent: parseFloat(e.target.value) || 0})} className="w-full px-4 py-3 bg-white rounded-xl font-bold border border-slate-200 focus:border-blue-500 outline-none no-spinner" /></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-6">
                    <h4 className="text-[11px] font-black text-indigo-500 uppercase tracking-widest border-b border-indigo-100 pb-2 italic">Precificação (Markup Tabela)</h4>
                    <div className="space-y-6">
                      <div className="space-y-3">
                         <p className="text-[10px] font-black text-slate-400 uppercase italic tracking-widest">Venda de Rolo Fechado</p>
                         <div className="grid grid-cols-12 gap-3"><div className="col-span-8 space-y-1"><label className="text-[8px] font-bold text-slate-400 uppercase ml-1">Preço Mín (Tabela)</label><input readOnly value={editingItem.priceRoloMin?.toFixed(2)} className="w-full px-4 py-2 bg-slate-200 border rounded-xl font-medium text-slate-500 cursor-not-allowed" /></div><div className="col-span-4 space-y-1"><label className="text-[8px] font-bold text-slate-400 uppercase ml-1">Markup (%)</label><input value={markupStrings.roloMin} onChange={e => onMarkupChange('roloMin', 'priceRoloMin', e.target.value, true)} className="w-full px-4 py-2 bg-white border border-slate-300 rounded-xl text-center font-bold no-spinner" placeholder="%" /></div></div>
                         <div className="grid grid-cols-12 gap-3"><div className="col-span-8 space-y-1"><label className="text-[8px] font-bold text-indigo-500 uppercase ml-1">Preço Ideal (Tabela)</label><input readOnly value={editingItem.priceRoloIdeal?.toFixed(2)} className="w-full px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl font-black text-indigo-900/50 cursor-not-allowed" /></div><div className="col-span-4 space-y-1"><label className="text-[8px] font-bold text-indigo-500 uppercase ml-1">Markup (%)</label><input value={markupStrings.roloIdeal} onChange={e => onMarkupChange('roloIdeal', 'priceRoloIdeal', e.target.value, true)} className="w-full px-4 py-2 bg-white border border-indigo-300 rounded-xl text-center font-black text-indigo-900 no-spinner" placeholder="%" /></div></div>
                      </div>
                      <div className="space-y-3 pt-6 border-t border-slate-100">
                         <p className="text-[10px] font-black text-slate-400 uppercase italic tracking-widest">Venda Fracionada</p>
                         <div className="grid grid-cols-12 gap-3"><div className="col-span-8 space-y-1"><label className="text-[8px] font-bold text-slate-400 uppercase ml-1">Preço Mín (Tabela)</label><input readOnly value={editingItem.priceFracMin?.toFixed(2)} className="w-full px-4 py-2 bg-slate-200 border rounded-xl font-medium text-slate-500 cursor-not-allowed" /></div><div className="col-span-4 space-y-1"><label className="text-[8px] font-bold text-slate-400 uppercase ml-1">Markup (%)</label><input value={markupStrings.fracMin} onChange={e => onMarkupChange('fracMin', 'priceFracMin', e.target.value, false)} className="w-full px-4 py-2 bg-white border border-slate-300 rounded-xl text-center font-bold no-spinner" placeholder="%" /></div></div>
                         <div className="grid grid-cols-12 gap-3"><div className="col-span-8 space-y-1"><label className="text-[8px] font-bold text-emerald-600 uppercase ml-1">Preço Ideal (Tabela)</label><input readOnly value={editingItem.priceFracIdeal?.toFixed(2)} className="w-full px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl font-black text-emerald-900/50 cursor-not-allowed" /></div><div className="col-span-4 space-y-1"><label className="text-[8px] font-bold text-emerald-600 uppercase ml-1">Markup (%)</label><input value={markupStrings.fracIdeal} onChange={e => onMarkupChange('fracIdeal', 'priceFracIdeal', e.target.value, false)} className="w-full px-4 py-2 bg-white border border-emerald-300 rounded-xl text-center font-black text-emerald-900 no-spinner" placeholder="%" /></div></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-10 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-4"><button onClick={() => setEditingItem(null)} className="px-8 py-4 text-slate-400 font-black text-[10px] uppercase tracking-widest italic hover:text-slate-900 transition-colors">Cancelar</button><button onClick={handleSavePrice} disabled={isSaving} className="px-12 py-4 bg-slate-900 text-white rounded-[1.5rem] font-black text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-indigo-600 transition-all italic active:scale-95 disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar Tabela'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesPriceTable;
