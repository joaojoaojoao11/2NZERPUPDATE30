
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DataService } from '../services/dataService';
import { StockItem, WarehouseLayout } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';

const BoxMap: React.FC = () => {
  const [layout, setLayout] = useState<WarehouseLayout>({ columns: [], shelvesPerColumn: {} });
  const [inventory, setInventory] = useState<StockItem[]>([]);
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<'ADD_SHELF' | 'MANAGE_COL' | null>(null);
  const [selectedColContext, setSelectedColContext] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [loading, setLoading] = useState(true);
  
  const actionsRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [invData, layoutData] = await Promise.all([
        DataService.getInventory(),
        DataService.getLayout()
      ]);
      setInventory(invData.filter(i => i.quantMl > 0));
      setLayout(layoutData);
    } catch (e) {
      setToast({ msg: 'Erro ao sincronizar dados do pátio.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const grid = useMemo(() => {
    const data: Record<string, StockItem[]> = {};
    layout.columns.forEach(col => {
      if (layout.shelvesPerColumn[col]) {
        layout.shelvesPerColumn[col].forEach(shelf => {
          data[`${col}${shelf}`] = [];
        });
      }
    });
    inventory.forEach(item => {
      const key = `${item.coluna}${item.prateleira}`;
      if (data[key]) data[key].push(item);
    });
    return data;
  }, [inventory, layout]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) {
        setIsActionsOpen(false);
        setActiveSubmenu(null);
        setSelectedColContext(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateAndSaveLayout = async (newLayout: WarehouseLayout, shouldCloseMenu = false) => {
    // 1. Atualização Otimista
    setLayout(newLayout);

    if (shouldCloseMenu) {
      setIsActionsOpen(false);
      setActiveSubmenu(null);
      setSelectedColContext(null);
    }

    // 2. Persistência
    try {
      const success = await DataService.saveLayout(newLayout);
      if (success) {
        setToast({ msg: 'Layout atualizado.', type: 'success' });
      } else {
        console.warn("Falha no salvamento cloud, mantendo estado local.");
        // Não mostra erro para usuário para evitar confusão se a UI já atualizou
      }
    } catch (e) {
      console.error("Erro ao salvar layout:", e);
    }
  };

  const handleAddColumn = () => {
    const lastCol = layout.columns[layout.columns.length - 1] || '@';
    const nextCol = String.fromCharCode(lastCol.charCodeAt(0) + 1);
    const newLayout: WarehouseLayout = {
      columns: [...layout.columns, nextCol],
      shelvesPerColumn: { ...layout.shelvesPerColumn, [nextCol]: ['1', '2'] }
    };
    updateAndSaveLayout(newLayout, true);
  };

  const handleAddShelf = (col: string) => {
    const existing = layout.shelvesPerColumn[col] || [];
    // Ensure we handle numbers or strings correctly for calculation
    const next = existing.length > 0 ? Math.max(...existing.map(s => parseInt(String(s), 10))) + 1 : 1;
    const newLayout = {
      ...layout,
      shelvesPerColumn: { ...layout.shelvesPerColumn, [col]: [...existing, next.toString()] }
    };
    updateAndSaveLayout(newLayout, true);
  };

  const handleDeleteColumn = (e: React.MouseEvent, col: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Pequeno delay para garantir que o menu não feche antes do confirm
    setTimeout(() => {
        const columnHasItems = inventory.some(item => item.coluna === col);
        const msg = columnHasItems 
          ? `A Coluna ${col} possui itens em estoque! Excluir a estrutura física mesmo assim?`
          : `Confirmar exclusão da Coluna ${col}?`;

        if (window.confirm(msg)) {
          const newColumns = layout.columns.filter(c => c !== col);
          const newShelves = { ...layout.shelvesPerColumn };
          delete newShelves[col];
          updateAndSaveLayout({ columns: newColumns, shelvesPerColumn: newShelves }, false);
        }
    }, 10);
  };

  const handleDeleteShelf = (e: React.MouseEvent, col: string, shelfId: string) => {
    e.preventDefault();
    e.stopPropagation();

    setTimeout(() => {
        const shelfHasItems = inventory.some(item => item.coluna === col && String(item.prateleira) === String(shelfId));
        const msg = shelfHasItems 
          ? `O Nível ${shelfId} da Coluna ${col} não está vazio! Remover do mapa logístico?`
          : `Deseja remover o Nível ${shelfId} da Coluna ${col}?`;

        if (window.confirm(msg)) {
          const existing = layout.shelvesPerColumn[col] || [];
          // FIX CRÍTICO: Conversão explicita para String para garantir igualdade
          const newShelves = existing.filter(s => String(s) !== String(shelfId));
          
          const newLayout = {
            ...layout,
            shelvesPerColumn: {
              ...layout.shelvesPerColumn,
              [col]: newShelves
            }
          };
          updateAndSaveLayout(newLayout, false);
        }
    }, 10);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 opacity-30">
        <div className="w-12 h-12 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-[10px] font-black uppercase tracking-[0.5em]">Sincronizando Pátio...</p>
      </div>
    );
  }

  return (
    <div className="space-y-12 animate-in fade-in duration-700 max-w-[1600px] mx-auto">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-200/60">
        <div className="space-y-1">
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Mapa Logístico</h2>
          <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.5em] flex items-center italic">
            <span className="w-8 h-px bg-blue-600 mr-3"></span>
            Posicionamento Físico de Pátio
          </p>
        </div>
        
        <div className="flex items-center space-x-4 print:hidden">
          <div className="relative" ref={actionsRef}>
            <button 
              type="button"
              onClick={() => setIsActionsOpen(!isActionsOpen)}
              className={`px-8 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all border flex items-center space-x-3 shadow-xl ${
                isActionsOpen ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 premium-shadow'
              }`}
            >
              <ICONS.Settings className="w-4 h-4" />
              <span>Configurar Pátio</span>
            </button>

            {isActionsOpen && (
              <div className="absolute top-full right-0 mt-3 w-80 bg-white rounded-3xl shadow-2xl border border-slate-100 py-4 z-[110] animate-in fade-in slide-in-from-top-2 overflow-visible">
                <p className="px-6 py-2 text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Operações de Estrutura</p>
                
                <button 
                  type="button"
                  onClick={handleAddColumn} 
                  className="w-full px-6 py-3 text-left hover:bg-slate-50 flex items-center space-x-4 group"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"><ICONS.Add className="w-4 h-4" /></div>
                  <span className="text-[10px] font-black text-slate-700 uppercase">Adicionar Coluna</span>
                </button>

                <div className="relative group/addshelf">
                  <button 
                    type="button"
                    onClick={() => { setActiveSubmenu(activeSubmenu === 'ADD_SHELF' ? null : 'ADD_SHELF'); setSelectedColContext(null); }}
                    className={`w-full px-6 py-3 text-left flex justify-between items-center group transition-colors ${activeSubmenu === 'ADD_SHELF' ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center space-x-4">
                       <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><ICONS.Add className="w-4 h-4" /></div>
                       <span className="text-[10px] font-black text-slate-700 uppercase">Novo Nível (Altura)</span>
                    </div>
                    <svg className={`w-3 h-3 text-slate-400 transition-transform ${activeSubmenu === 'ADD_SHELF' ? 'rotate-90 text-emerald-600' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  {activeSubmenu === 'ADD_SHELF' && (
                    <div className="absolute top-0 right-full mr-2 w-48 bg-white shadow-2xl border border-slate-100 rounded-2xl py-2 z-[120] animate-in slide-in-from-right-2">
                      <p className="px-4 py-2 text-[8px] font-black text-slate-400 uppercase italic">Escolher Coluna</p>
                      {layout.columns.map(c => (
                        <button key={c} type="button" onClick={() => handleAddShelf(c)} className="w-full px-4 py-2 text-left text-[10px] font-black hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 uppercase italic">COLUNA {c}</button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="my-2 border-t border-slate-100 mx-4"></div>

                <p className="px-6 py-2 text-[8px] font-black text-red-500 uppercase tracking-widest mb-1 italic">Administração</p>
                
                <div className="relative">
                  <button 
                    type="button"
                    onClick={() => { 
                      setActiveSubmenu(activeSubmenu === 'MANAGE_COL' ? null : 'MANAGE_COL');
                      setSelectedColContext(null);
                    }}
                    className={`w-full px-6 py-3 text-left flex justify-between items-center transition-colors group ${activeSubmenu === 'MANAGE_COL' ? 'bg-red-50 text-red-700' : 'hover:bg-red-50'}`}
                  >
                    <div className="flex items-center space-x-4">
                       <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${activeSubmenu === 'MANAGE_COL' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600'}`}>
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                       </div>
                       <span className={`text-[10px] font-black uppercase ${activeSubmenu === 'MANAGE_COL' ? 'text-red-700' : 'text-slate-700 group-hover:text-red-700'}`}>Gerenciar Colunas</span>
                    </div>
                    <svg className={`w-3 h-3 transition-transform ${activeSubmenu === 'MANAGE_COL' ? 'rotate-180 text-red-600' : 'text-slate-400 group-hover:text-red-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  
                  {activeSubmenu === 'MANAGE_COL' && (
                    <div className="absolute top-0 right-full -mr-1 w-64 bg-white shadow-2xl border border-slate-100 rounded-2xl py-2 z-[120] animate-in slide-in-from-right-2 flex flex-col">
                      <p className="px-4 py-2 text-[8px] font-black text-slate-400 uppercase italic">Selecionar Coluna</p>
                      {layout.columns.map(c => (
                        <div key={c} className="relative">
                           <div 
                              onClick={() => setSelectedColContext(selectedColContext === c ? null : c)}
                              className={`w-full px-4 py-3 flex justify-between items-center cursor-pointer transition-all ${selectedColContext === c ? 'bg-slate-900 shadow-lg' : 'hover:bg-slate-50 border-b border-slate-50 last:border-0'}`}
                           >
                              <span className={`flex-1 text-[11px] font-black uppercase italic select-none ${selectedColContext === c ? 'text-white' : 'text-slate-600'}`}>
                                COLUNA {c}
                              </span>
                              
                              <div className="flex items-center gap-2">
                                <button 
                                  type="button"
                                  onClick={(e) => handleDeleteColumn(e, c)}
                                  className={`p-2 rounded-lg transition-all relative z-[130] hover:scale-110 ${selectedColContext === c ? 'text-red-400 hover:bg-white/20' : 'text-slate-300 hover:text-red-600 hover:bg-red-50'}`}
                                  title={`Apagar Coluna ${c}`}
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                </button>
                                <svg className={`w-3 h-3 transition-transform ${selectedColContext === c ? 'rotate-90 text-blue-400' : 'text-slate-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              </div>
                           </div>
                           
                           {selectedColContext === c && (
                             <div className="absolute top-0 right-full -mr-1 w-56 bg-white shadow-2xl border border-slate-200 rounded-2xl py-2 z-[140] animate-in slide-in-from-right-1 overflow-hidden">
                                <p className="px-4 py-2 text-[8px] font-black text-slate-400 uppercase italic bg-slate-50 border-b border-slate-100 mb-1">Níveis da Coluna {c}</p>
                                <div className="max-h-72 overflow-y-auto custom-scrollbar">
                                  {[...(layout.shelvesPerColumn[c] || [])].sort((a,b) => parseInt(String(b)) - parseInt(String(a))).map(shelf => (
                                    <div key={shelf} className="px-4 py-3 flex justify-between items-center hover:bg-slate-50 border-b border-slate-50 last:border-0 group/shelfitem">
                                      <span className="text-[10px] font-black text-slate-600 uppercase italic">NÍVEL {shelf}</span>
                                      <button 
                                        type="button"
                                        onClick={(e) => handleDeleteShelf(e, c, shelf)}
                                        className="p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all z-[160] hover:scale-110"
                                        title="Excluir Nível"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                      </button>
                                    </div>
                                  ))}
                                  {(!layout.shelvesPerColumn[c] || layout.shelvesPerColumn[c].length === 0) && (
                                    <p className="px-4 py-6 text-[8px] text-slate-300 font-bold uppercase text-center">Coluna Vazia</p>
                                  )}
                                </div>
                             </div>
                           )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 pb-20">
        {layout.columns.map(col => (
          <div key={col} className="flex flex-col space-y-10">
            <div className="bg-slate-900 py-6 rounded-3xl text-white text-center shadow-[0_20px_50px_-10px_rgba(15,23,42,0.4)] border border-slate-800 relative group/col">
              <h3 className="text-2xl font-black tracking-[0.2em] uppercase italic">COLUNA {col}</h3>
            </div>
            {[...(layout.shelvesPerColumn[col] || [])].sort((a,b) => parseInt(String(b)) - parseInt(String(a))).map(shelf => {
              const key = `${col}${shelf}`;
              const items = grid[key] || [];
              return (
                <div key={key} className="bg-white rounded-[3rem] border border-slate-200 premium-shadow overflow-hidden flex flex-col min-h-[350px] transition-all hover:border-slate-300">
                  <div className="px-8 py-5 bg-slate-50 flex justify-between items-center border-b border-slate-100">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest italic">Nível {shelf}</span>
                    <span className="bg-blue-600 text-white px-4 py-1.5 rounded-2xl text-[9px] font-black uppercase shadow-lg shadow-blue-100">{items.length} VOL</span>
                  </div>
                  <div className="p-8 space-y-5 flex-1">
                    {items.map(it => (
                      <div key={it.lpn} className="bg-white border border-slate-100 p-6 rounded-[2rem] shadow-sm hover:border-blue-500 hover:shadow-[0_15px_40px_-10px_rgba(37,99,235,0.1)] transition-all group">
                        <div className="flex justify-between items-start mb-3">
                           <span className="text-[8px] font-black text-blue-600 bg-blue-50 px-3 py-1.5 rounded-xl uppercase tracking-widest border border-blue-100">{it.lpn}</span>
                           <span className="text-base font-black text-slate-900 italic">{it.quantMl.toFixed(2)} ML</span>
                        </div>
                        <p className="text-[11px] font-black text-slate-800 truncate uppercase tracking-tight italic leading-none">{it.sku}</p>
                        <p className="text-[8px] font-bold text-slate-400 truncate uppercase mt-2 italic tracking-widest">{it.nome}</p>
                      </div>
                    ))}
                    {items.length === 0 && (
                      <div className="h-full py-24 text-center flex flex-col items-center justify-center opacity-10">
                        <ICONS.Map className="w-12 h-12 mb-4 text-slate-400" />
                        <p className="uppercase font-black text-[9px] tracking-[0.4em] italic text-slate-900">Disponível</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {layout.columns.length === 0 && (
          <div className="col-span-full py-40 text-center flex flex-col items-center justify-center opacity-20">
             <ICONS.Dashboard className="w-20 h-20 mb-6" />
             <p className="font-black uppercase tracking-[0.3em]">Pátio vazio. Configure uma coluna.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default BoxMap;
