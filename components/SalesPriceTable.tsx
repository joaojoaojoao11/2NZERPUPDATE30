import React, { useState, useEffect, useMemo, useRef } from 'react';
import PricingEngineering from './PricingEngineering';
import { PricingService } from '../services/pricingService';
import { DataService } from '../services/dataService';
import { ICONS } from '../constants';
import Toast from './Toast';
import { PricingGridItem, StockItem, User, AuditLog, MasterProduct } from '../types';

interface SalesPriceTableProps {
  user: User;
  onNavigateToInventory?: (sku: string) => void;
  initialSearchTerm?: string;
  initialTab?: 'ENGINEERING' | 'TABLE' | 'LOG';
}

type SortKey = 'sku_nome' | 'categoria' | 'metragem' | 'estoque' | 'preco_rolo' | 'preco_frac';

const SalesPriceTable: React.FC<SalesPriceTableProps> = ({ user, onNavigateToInventory, initialSearchTerm, initialTab }) => {
  const [products, setProducts] = useState<PricingGridItem[]>([]);
  const [inventory, setInventory] = useState<StockItem[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm || '');
  const [filterCategory, setFilterCategory] = useState('TODAS');
  const [filterStatus, setFilterStatus] = useState<'TODOS' | 'ATIVOS' | 'INATIVOS'>('ATIVOS');
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' | 'warning' } | null>(null);

  const [activeTab, setActiveTab] = useState<'ENGINEERING' | 'TABLE' | 'LOG'>(initialTab || (user.role === 'DIRETORIA' ? 'ENGINEERING' : 'TABLE'));

  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>({ key: 'sku_nome', direction: 'asc' });

  const [simulatingProduct, setSimulatingProduct] = useState<PricingGridItem | null>(null);
  const [simulationMeters, setSimulationMeters] = useState<string>('1');

  const isDiretoria = user.role === 'DIRETORIA';

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pData, iData, lData] = await Promise.all([
        PricingService.getPricingGrid(),
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



  const refreshData = () => {
    setProducts([]);
    fetchData();
  };

  useEffect(() => {
    refreshData();
  }, [activeTab]);

  const stockMap = useMemo(() => {
    const map: Record<string, number> = {};
    inventory.forEach(item => {
      const current = map[item.sku] || 0;
      map[item.sku] = current + (item.quantMl || 0);
    });
    return map;
  }, [inventory]);

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
          case 'preco_rolo': valA = (a.pricing?.preco_venda_ideal_atacado || 0); valB = (b.pricing?.preco_venda_ideal_atacado || 0); break;
          case 'preco_frac': valA = a.pricing?.preco_venda_ideal_fracionado || 0; valB = b.pricing?.preco_venda_ideal_fracionado || 0; break;
          default: return 0;
        }

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [products, searchTerm, filterCategory, filterStatus, sortConfig, stockMap]);

  const filteredLogs = useMemo(() => {
    if (activeTab !== 'LOG') return [];
    return logs.filter(l =>
      l.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.usuario.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.detalhes.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [logs, activeTab, searchTerm]);

  const simulationResults = useMemo(() => {
    if (!simulatingProduct) return null;
    const meters = parseFloat(simulationMeters.replace(',', '.')) || 0;
    if (meters <= 0) return null;

    const isVolumeDeRolo = meters >= (simulatingProduct.metragemPadrao || 15);
    const pricing = simulatingProduct.pricing;

    const custoBaseMetro = pricing?.custo_rolo_base || 0;
    const custoExtraTotalFixo = pricing?.custo_extra_frete || 0;

    let precoMetroIdeal_base = 0;
    let precoMetroMinimo_base = 0;

    if (isVolumeDeRolo) {
      const metragemPadrao = simulatingProduct.metragemPadrao || 15;
      precoMetroIdeal_base = (pricing?.preco_venda_ideal_atacado || 0) / metragemPadrao;
      precoMetroMinimo_base = (pricing?.preco_venda_min_atacado || 0) / metragemPadrao;
    } else {
      precoMetroIdeal_base = pricing?.preco_venda_ideal_fracionado || 0;
      precoMetroMinimo_base = pricing?.preco_venda_min_fracionado || 0;
    }

    const custoExtraDiluidoPorMetro = meters > 0 ? (custoExtraTotalFixo / meters) : 0;

    const precoMetroIdeal_final = precoMetroIdeal_base + custoExtraDiluidoPorMetro;
    const precoMetroMinimo_final = precoMetroMinimo_base + custoExtraDiluidoPorMetro;

    const valorTotalIdeal_final = precoMetroIdeal_final * meters;
    const valorTotalMinimo_final = precoMetroMinimo_final * meters;

    return {
      isVolumeDeRolo,
      custoUnitarioProduto: custoBaseMetro,
      custoExtraUnitario: custoExtraTotalFixo,
      custoExtraDiluido: custoExtraDiluidoPorMetro,
      valorTotalIdeal: valorTotalIdeal_final,
      valorTotalMinimo: valorTotalMinimo_final,
      precoMetroIdeal: precoMetroIdeal_final,
      precoMetroMinimo: precoMetroMinimo_final
    };
  }, [simulatingProduct, simulationMeters]);

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

  const SortIndicator = ({ activeKey }: { activeKey: SortKey }) => {
    if (sortConfig?.key !== activeKey) return <span className="w-4 h-4 inline-block" />;
    return sortConfig.direction === 'asc' ? <ICONS.ChevronUp className="w-4 h-4 ml-1 inline text-indigo-500" /> : <ICONS.ChevronDown className="w-4 h-4 ml-1 inline text-indigo-500" />;
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
            {isDiretoria && (
              <button
                onClick={() => setActiveTab('ENGINEERING')}
                className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'ENGINEERING' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
              >
                Engenharia de Preços
              </button>
            )}
            <button onClick={() => setActiveTab('TABLE')} className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'TABLE' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}>Precificação Atual</button>
            <button onClick={() => setActiveTab('LOG')} className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'LOG' ? 'bg-indigo-900 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}>Log de Alterações</button>
            <button onClick={refreshData} className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-blue-600 transition-all shadow-sm" title="Atualizar Dados"><ICONS.History className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="flex items-center gap-3">
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

      {activeTab !== 'ENGINEERING' && (
        <div className="bg-white p-2 rounded-[2.5rem] border border-slate-200 shadow-sm flex items-center shrink-0">
          <div className="pl-6 text-slate-300"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="3" /></svg></div>
          <input type="text" placeholder={activeTab === 'LOG' ? "BUSCAR LOGS (SKU, NOME OU OPERADOR)..." : "BUSCAR MATERIAL (SKU OU NOME)..."} className="w-full px-6 py-4 bg-transparent outline-none font-black text-sm uppercase placeholder:text-slate-200" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
      )}

      {activeTab === 'ENGINEERING' && isDiretoria ? (
        <PricingEngineering user={user} />
      ) : activeTab === 'TABLE' ? (

        <div className="table-container flex-1 overflow-y-auto bg-white border border-slate-100 rounded-[2.5rem] shadow-sm relative custom-scrollbar">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-30">
              <tr className="bg-slate-900 text-slate-400 text-[9px] font-black uppercase tracking-widest">
                <th className="px-8 py-6 text-left sticky left-0 z-40 bg-slate-900 cursor-pointer group select-none" onClick={() => handleSort('sku_nome')}><div className="flex items-center">Produto / SKU <SortIndicator activeKey="sku_nome" /></div></th>
                <th className="px-4 py-6 text-center cursor-pointer group select-none" onClick={() => handleSort('categoria')}><div className="flex items-center justify-center">Categoria <SortIndicator activeKey="categoria" /></div></th>
                <th className="px-4 py-6 text-center cursor-pointer group select-none" onClick={() => handleSort('metragem')}><div className="flex items-center justify-center">Metragem <SortIndicator activeKey="metragem" /></div></th>
                <th className="px-4 py-6 text-center cursor-pointer group select-none" onClick={() => handleSort('estoque')}><div className="flex items-center justify-center">Disponibilidade <SortIndicator activeKey="estoque" /></div></th>
                <th className="px-2 py-6 text-center bg-indigo-950/40 text-indigo-300 whitespace-nowrap w-24">ROLO (A)</th>
                <th className="px-2 py-6 text-center bg-indigo-900/20 text-indigo-400 whitespace-nowrap w-24 cursor-pointer group select-none" onClick={() => handleSort('preco_rolo')}><div className="flex items-center justify-center">ROLO (V) <SortIndicator activeKey="preco_rolo" /></div></th>
                <th className="px-2 py-6 text-center bg-emerald-950/40 text-emerald-300 whitespace-nowrap w-24">PREÇO FRAC. (A)</th>
                <th className="px-2 py-6 text-center bg-emerald-900/30 text-emerald-200 whitespace-nowrap w-24 cursor-pointer group select-none" onClick={() => handleSort('preco_frac')}><div className="flex items-center justify-center">PREÇO FRAC. (V) <SortIndicator activeKey="preco_frac" /></div></th>
                <th className="px-6 py-6 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredProducts.map(p => {
                const lastUpdateDate = p.updatedAt ? new Date(p.updatedAt) : null;
                const now = new Date();
                const diffTime = lastUpdateDate ? (now.getTime() - lastUpdateDate.getTime()) : Infinity;
                const isUpdatedRecently = diffTime < (30 * 24 * 60 * 60 * 1000);

                const availableStock = stockMap[p.sku] || 0;
                const isDrop = availableStock <= 0.01;

                const hasExtra = (p.pricing?.custo_extra_frete || 0) > 0;
                const custoExtra = p.pricing?.custo_extra_frete || 0;

                const precoRoloMinBase = p.pricing?.preco_venda_min_atacado || 0;
                const precoRoloIdealBase = p.pricing?.preco_venda_ideal_atacado || 0;

                const precoRoloMinFinal = (isDrop && hasExtra) ? (precoRoloMinBase + custoExtra) : precoRoloMinBase;
                const precoRoloIdealFinal = (isDrop && hasExtra) ? (precoRoloIdealBase + custoExtra) : precoRoloIdealBase;

                const hideFrac = isDrop && hasExtra;

                return (
                  <tr key={p.sku} className={`group hover:bg-indigo-50/20 transition-all ${p.active === false ? 'opacity-40 grayscale' : ''}`}>
                    <td className="px-8 py-6 sticky left-0 z-10 bg-white group-hover:bg-indigo-50/20 shadow-[5px_0_10px_-5px_rgba(0,0,0,0.05)]">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="bg-slate-100 text-slate-500 text-[8px] font-black px-1.5 py-0.5 rounded w-fit uppercase">{p.sku}</span>
                          {p.active === false && <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter">PAUSADO</span>}
                        </div>
                        <div className="flex items-center gap-2">
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
                        <div
                          onClick={() => onNavigateToInventory?.(p.sku)}
                          className={`inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg font-black text-[8px] uppercase italic shadow-sm ${onNavigateToInventory ? 'cursor-pointer hover:bg-emerald-100 transition-colors' : ''}`}
                        >
                          ESTOQUE
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 border-amber-100 rounded-lg font-black text-[8px] uppercase italic">{hasExtra ? 'DROP (+EXTRA)' : 'DROP'}</div>
                      )}
                    </td>
                    <td className="px-2 py-6 text-center bg-indigo-50/10 text-[11px] font-bold text-slate-400 italic">R$ {precoRoloMinFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="px-2 py-6 text-center bg-indigo-50/20 text-xs font-black text-indigo-700 italic border-x border-slate-100/50">R$ {precoRoloIdealFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="px-2 py-6 text-center bg-emerald-50/10 text-[11px] font-bold text-slate-400 italic">
                      {hideFrac ? <span className="text-[9px] text-amber-500">USE CALC</span> : `R$ ${(p.pricing?.preco_venda_min_fracionado || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                    </td>
                    <td className="px-2 py-6 text-center bg-emerald-50/20 text-xs font-black text-emerald-700 italic border-x border-slate-100/50">
                      {hideFrac ? <span className="text-[9px] text-amber-500">USE CALC</span> : `R$ ${(p.pricing?.preco_venda_ideal_fracionado || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                    </td>
                    <td className="px-6 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {isDrop && (
                          <button onClick={() => { setSimulatingProduct(p); setSimulationMeters('1'); }} className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-green-600 hover:border-green-200 transition-all shadow-sm" title="Simular (Calculadora de DROP com Custo Extra)"><ICONS.Calculator className="w-4 h-4" /></button>
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
                      <div className="flex justify-between text-[11px] font-bold text-slate-500 uppercase"><p>Custo Produto de Base</p><p>R$ {simulationResults.custoUnitarioProduto.toFixed(2)} /m</p></div>
                      <div className="flex justify-between text-[11px] font-bold text-blue-600 uppercase border-t border-slate-200/50 pt-2"><p>(+) Custo Extra Totais</p><p>R$ {simulationResults.custoExtraUnitario.toFixed(2)}</p></div>
                      <div className="flex justify-between text-[11px] font-bold text-slate-400 uppercase"><p>Custo Extra Diluído na Metragem</p><p>R$ {simulationResults.custoExtraDiluido.toFixed(2)} /m</p></div>
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
    </div>
  );
};

export default SalesPriceTable;
