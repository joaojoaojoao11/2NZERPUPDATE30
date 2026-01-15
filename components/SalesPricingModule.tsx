
import React, { useState, useEffect, useMemo } from 'react';
import { DataService } from '../services/dataService';
import { MasterProduct, User } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';

const BRAZIL_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

// Regras simplificadas de Alíquota Interna por UF
const getInternalTaxRate = (uf: string): number => {
  if (['SP', 'MG', 'PR'].includes(uf)) return 18;
  if (['RJ', 'RS', 'SC', 'ES'].includes(uf)) return 12; // Sul/Sudeste simplificado
  return 7; // Norte/Nordeste/Centro-Oeste
};

const SalesPricingModule: React.FC<{ user: User }> = ({ user }) => {
  const [catalog, setCatalog] = useState<MasterProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);

  // Estados do Simulador
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<MasterProduct | null>(null);
  const [destinationUF, setDestinationUF] = useState('SP');
  const [shippingCost, setShippingCost] = useState<number>(0);
  const [suggestedPrice, setSuggestedPrice] = useState<number>(0);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    DataService.getMasterCatalog().then(data => {
      setCatalog(data);
      setLoading(false);
    });
  }, []);

  const filteredCatalog = useMemo(() => {
    if (!searchTerm || selectedProduct) return [];
    return catalog.filter(p => 
      p.sku.toLowerCase().includes(searchTerm.toLowerCase()) || 
      p.nome.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 6);
  }, [catalog, searchTerm, selectedProduct]);

  const pricingResults = useMemo(() => {
    if (!selectedProduct || suggestedPrice <= 0) return null;

    const costBase = selectedProduct.custoUnitario || 0;
    const originUF = selectedProduct.supplierState || 'MG'; // Default para MG se vazio
    const isForeign = selectedProduct.taxOrigin === 1 || selectedProduct.taxOrigin === 2;

    // 1. Alíquota Interestadual (Saída da Origem)
    // Regra: Estrangeiro p/ outro estado = 4%. Nacional ou mesma UF = 12%
    const interRate = (isForeign && originUF !== destinationUF) ? 4 : 12;

    // 2. Alíquota Interna no Destino
    const intraRate = getInternalTaxRate(destinationUF);

    // 3. Cálculo DIFAL (Diferença entre Interna e Interestadual)
    const difalRate = Math.max(0, intraRate - interRate);
    const difalValue = (suggestedPrice * difalRate) / 100;
    const originIcmsValue = (suggestedPrice * interRate) / 100;

    const totalTaxes = difalValue + originIcmsValue;
    const totalCosts = costBase + shippingCost + totalTaxes;
    const netProfit = suggestedPrice - totalCosts;
    const marginPercent = (netProfit / suggestedPrice) * 100;

    return {
      interRate,
      intraRate,
      difalRate,
      difalValue,
      originIcmsValue,
      totalTaxes,
      totalCosts,
      netProfit,
      marginPercent
    };
  }, [selectedProduct, suggestedPrice, destinationUF, shippingCost]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 opacity-30">
      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Inteligência de Venda</h2>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.25em] mt-3 italic">Simulador de Margem e Impacto Tributário</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        
        {/* COLUNA 1: CONFIGURAÇÃO DA VENDA */}
        <div className="lg:col-span-7 space-y-8">
          <div className="bg-white p-10 rounded-[3rem] border border-slate-100 premium-shadow space-y-8">
            
            {/* Seleção de Produto */}
            <div className="space-y-4 relative">
              <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest ml-1 italic">1. Localizar Material no Catálogo</label>
              <div className="relative">
                <input 
                  type="text" 
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); if (selectedProduct) setSelectedProduct(null); }}
                  placeholder="DIGITE SKU OU DESCRIÇÃO..."
                  className="w-full px-8 py-5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-[2rem] outline-none font-black text-sm shadow-inner transition-all uppercase"
                />
                {selectedProduct && (
                  <button onClick={() => { setSelectedProduct(null); setSearchTerm(''); }} className="absolute right-6 top-1/2 -translate-y-1/2 text-red-500">
                    <ICONS.Add className="w-6 h-6 rotate-45" />
                  </button>
                )}
              </div>

              {filteredCatalog.length > 0 && (
                <div className="absolute top-full left-0 w-full mt-3 bg-white rounded-[2rem] shadow-2xl border border-slate-100 z-[100] overflow-hidden">
                  {filteredCatalog.map(p => (
                    <button 
                      key={p.sku} 
                      onClick={() => { setSelectedProduct(p); setSearchTerm(`${p.sku} - ${p.nome}`); }}
                      className="w-full px-8 py-4 text-left hover:bg-blue-50 flex justify-between items-center border-b border-slate-50 last:border-0 transition-all"
                    >
                      <div className="flex flex-col">
                        <span className="bg-slate-900 text-white text-[8px] font-black px-2 py-0.5 rounded-lg w-fit mb-1 uppercase">SKU: {p.sku}</span>
                        <p className="font-black text-slate-800 text-[10px] uppercase">{p.nome}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black text-blue-600 uppercase">Custo: R$ {p.custoUnitario?.toFixed(2)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dados Automáticos do Produto */}
            {selectedProduct && (
              <div className="grid grid-cols-3 gap-4 animate-in slide-in-from-top-2 duration-300">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p className="text-[8px] font-black text-slate-400 uppercase mb-1">NCM</p>
                  <p className="text-xs font-black text-slate-900">{selectedProduct.ncmCode || 'NÃO INF.'}</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Origem / UF</p>
                  <p className="text-xs font-black text-slate-900">
                    {selectedProduct.taxOrigin === 0 ? 'NAC' : 'EST'} ({selectedProduct.supplierState || 'MG'})
                  </p>
                </div>
                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                  <p className="text-[8px] font-black text-blue-600 uppercase mb-1">Custo Base</p>
                  <p className="text-xs font-black text-blue-900 italic">R$ {selectedProduct.custoUnitario?.toFixed(2)}</p>
                </div>
              </div>
            )}

            {/* Variáveis da Venda */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t border-slate-100">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">UF Destino (Cliente)</label>
                <select 
                  value={destinationUF}
                  onChange={(e) => setDestinationUF(e.target.value)}
                  className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl outline-none font-black text-sm transition-all cursor-pointer"
                >
                  {BRAZIL_STATES.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Frete de Envio (R$)</label>
                <input 
                  type="number"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(Number(e.target.value))}
                  className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl outline-none font-black text-sm transition-all"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest ml-1 italic">Preço de Venda Sugerido (R$)</label>
              <input 
                type="number"
                value={suggestedPrice || ''}
                onChange={(e) => setSuggestedPrice(Number(e.target.value))}
                className="w-full px-8 py-6 bg-blue-50/50 border-2 border-transparent focus:border-blue-600 rounded-[2rem] outline-none font-black text-3xl text-center text-blue-900 shadow-inner transition-all tracking-tighter"
                placeholder="R$ 0,00"
              />
            </div>
          </div>
        </div>

        {/* COLUNA 2: ANÁLISE DE RESULTADO */}
        <div className="lg:col-span-5">
          {!pricingResults ? (
            <div className="h-full bg-slate-900/5 border-2 border-dashed border-slate-200 rounded-[3rem] flex flex-col items-center justify-center p-12 text-center opacity-40">
              <ICONS.Finance className="w-16 h-16 mb-6 text-slate-300" />
              <p className="font-black text-slate-400 uppercase tracking-widest text-xs italic">Aguardando dados da venda para processar cálculo de margem líquida.</p>
            </div>
          ) : (
            <div className="bg-slate-900 rounded-[3rem] shadow-2xl text-white overflow-hidden flex flex-col h-full animate-in zoom-in-95 duration-300 border border-slate-800">
              <div className="p-10 bg-gradient-to-br from-slate-800 to-slate-900 border-b border-white/5">
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-2 italic">Resultado da Simulação</p>
                <div className="flex justify-between items-end">
                  <h3 className="text-5xl font-black italic tracking-tighter leading-none">
                    R$ {pricingResults.netProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </h3>
                  <div className={`px-5 py-2 rounded-2xl font-black text-sm italic border-2 ${pricingResults.marginPercent < 10 ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-emerald-500/20 border-emerald-500 text-emerald-400'}`}>
                    {pricingResults.marginPercent.toFixed(1)}% MARGEM
                  </div>
                </div>
              </div>

              <div className="p-10 flex-1 space-y-6">
                
                {/* Decomposição de Impostos */}
                <div className="space-y-4">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest italic flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                    Impostos (NF Saída)
                  </h4>
                  <div className="grid grid-cols-1 gap-2">
                    <div className="flex justify-between items-center p-4 bg-white/5 rounded-2xl border border-white/5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">ICMS Interestadual ({pricingResults.interRate}%)</span>
                      <span className="text-sm font-black italic text-slate-200">R$ {pricingResults.originIcmsValue.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center p-4 bg-white/5 rounded-2xl border border-white/5">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">DIFAL Destino ({pricingResults.difalRate}%)</span>
                        <span className="text-[8px] font-medium text-slate-500 uppercase tracking-tighter">Alíquota Interna {destinationUF}: {pricingResults.intraRate}%</span>
                      </div>
                      <span className="text-sm font-black italic text-slate-200">R$ {pricingResults.difalValue.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Resumo de Desembolso */}
                <div className="space-y-4 pt-4">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest italic flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                    Total de Custos & Logística
                  </h4>
                  <div className="space-y-3 px-2">
                    <div className="flex justify-between text-xs font-bold text-slate-400 uppercase">
                      <span>Custo do Material</span>
                      <span className="text-white">R$ {selectedProduct.custoUnitario?.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold text-slate-400 uppercase">
                      <span>Frete Operacional</span>
                      <span className="text-white">R$ {shippingCost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold text-slate-400 uppercase border-b border-white/10 pb-2">
                      <span>Impostos Totais</span>
                      <span className="text-white">R$ {pricingResults.totalTaxes.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-black text-blue-400 uppercase pt-1">
                      <span>Custo Total Efetivo</span>
                      <span className="italic">R$ {pricingResults.totalCosts.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

              </div>

              <div className="p-8 bg-black/30 border-t border-white/5 text-center">
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest leading-relaxed italic">
                  Cálculo baseado em Simples Nacional (Regime Comercial).<br/>
                  Sujeito a variações de IPI ou Substituição Tributária por NCM.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SalesPricingModule;
