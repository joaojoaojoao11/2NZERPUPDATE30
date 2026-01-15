
import React, { useState, useRef } from 'react';
import { DataService } from '../services/dataService';
import { InventoryUpdateStaging, User } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';

interface InventoryUpdateProps {
  currentUser: User;
  onClose: () => void;
  onSuccess: () => void;
}

type UpdateStep = 'UPLOAD' | 'PREVIEW';

const InventoryUpdate: React.FC<InventoryUpdateProps> = ({ currentUser, onClose, onSuccess }) => {
  const [step, setStep] = useState<UpdateStep>('UPLOAD');
  const [staging, setStaging] = useState<InventoryUpdateStaging[]>([]);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [filter, setFilter] = useState<'TODOS' | 'NOVOS' | 'ATUALIZADOS' | 'EXCLUIDOS'>('TODOS');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadExample = () => {
    // Usando Pipe (|) no template para evitar erros com casas decimais (vírgula)
    const headers = "lpn|sku|nome|categoria|lote|coluna|prateleira|quantMl";
    const example = "\nNZ-24001|NZW01|NZWRAP BLACK PIANO ULTRA|ENVELOPAMENTO|L-76946|A|1|16,50";
    const blob = new Blob([headers + example], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'modelo_estoque_nz_pipe.csv');
    link.click();
  };

  // Fix: Made handleFileUpload asynchronous and awaiting processInventoryUpdateStaging
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const csv = event.target?.result as string;
        const lines = csv.split(/\r?\n/);
        
        // Detecta o separador: tenta Pipe primeiro, depois vírgula se não achar Pipe
        let separator = '|';
        if (!lines[0].includes('|') && lines[0].includes(',')) {
          separator = ',';
        }

        const headers = lines[0].toLowerCase().split(separator).map(h => h.trim());
        
        const items: any[] = [];
        lines.slice(1).forEach(line => {
          if (!line.trim()) return;
          const values = line.split(separator).map(v => v.trim());
          const item: any = {};
          headers.forEach((h, i) => {
            if (h.includes('lpn')) item.lpn = values[i];
            else if (h.includes('sku')) item.sku = values[i];
            else if (h.includes('nome')) item.nome = values[i];
            else if (h.includes('cat')) item.categoria = values[i];
            else if (h.includes('lote')) item.lote = values[i];
            else if (h.includes('col')) item.coluna = values[i].toUpperCase();
            else if (h.includes('prat') || h.includes('niv')) item.prateleira = values[i];
            else if (h.includes('quant') || h.includes('ml')) {
               // Normaliza decimais (aceita vírgula ou ponto)
               item.quantMl = parseFloat(values[i].replace(',', '.'));
            }
          });
          if (item.lpn || item.sku) items.push(item);
        });

        const stagingResult = await DataService.processInventoryUpdateStaging(items);
        setStaging(stagingResult);
        setStep('PREVIEW');
      } catch (err) {
        setToast({ msg: 'Erro ao processar arquivo. Verifique o delimitador Pipe (|).', type: 'error' });
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsText(file);
  };

  // Fix: Made confirmUpdate asynchronous and awaiting commitInventoryBatch
  const confirmUpdate = async () => {
    setIsProcessing(true);
    try {
      await DataService.commitInventoryBatch(staging, currentUser);
      setToast({ msg: 'Estoque atualizado com sucesso!', type: 'success' });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      setToast({ msg: 'Erro ao sincronizar estoque.', type: 'error' });
      setIsProcessing(false);
    }
  };

  const filteredStaging = staging.filter(s => {
    if (filter === 'TODOS') return true;
    if (filter === 'NOVOS') return s.status === 'NEW';
    if (filter === 'ATUALIZADOS') return s.status === 'CHANGED';
    if (filter === 'EXCLUIDOS') return s.status === 'DELETED';
    return true;
  });

  const stats = {
    total: staging.length,
    new: staging.filter(s => s.status === 'NEW').length,
    changed: staging.filter(s => s.status === 'CHANGED').length,
    deleted: staging.filter(s => s.status === 'DELETED').length,
    unchanged: staging.filter(s => s.status === 'UNCHANGED').length
  };

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[100] flex items-center justify-center p-6 overflow-y-auto">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="bg-[#111827] max-w-6xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-500 border border-slate-800 flex flex-col h-[90vh]">
        
        <div className="p-8 border-b border-slate-800 flex justify-between items-center bg-[#1F2937]">
          <div>
            <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter">Importação de Estoque</h2>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Sincronização em massa (Delimitador: Pipe |)</p>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-500 rounded-xl transition-all">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        {step === 'UPLOAD' ? (
          <div className="flex-1 p-10 flex flex-col lg:flex-row gap-12 overflow-y-auto">
            <div className="flex-1 space-y-6">
              <div className="bg-[#1F2937] p-8 rounded-[2rem] border border-slate-800 flex items-center justify-between group hover:border-blue-500 transition-all">
                <div className="flex items-center space-x-6">
                  <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center font-black text-white group-hover:bg-blue-600 transition-all text-xl">1</div>
                  <div>
                    <p className="text-white font-black text-lg">Baixe a planilha modelo</p>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Utilize o separador Pipe (|) para evitar erros</p>
                  </div>
                </div>
                <button onClick={downloadExample} className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-black text-[10px] uppercase tracking-widest border border-white/10 flex items-center space-x-2 transition-all">
                  <ICONS.Inventory className="w-4 h-4" />
                  <span>Baixar Modelo Pipe</span>
                </button>
              </div>

              <div className="bg-[#1F2937] p-8 rounded-[2rem] border border-slate-800 flex items-center justify-between group hover:border-blue-500 transition-all cursor-pointer relative overflow-hidden" onClick={() => fileInputRef.current?.click()}>
                <div className="flex items-center space-x-6">
                  <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center font-black text-white group-hover:bg-blue-600 transition-all text-xl">2</div>
                  <div>
                    <p className="text-white font-black text-lg">Envie o arquivo Pipe-Delimited</p>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Suporte completo a decimais brasileiros (vírgula)</p>
                  </div>
                </div>
                <div className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-blue-900/40 flex items-center space-x-2">
                  <ICONS.Upload className="w-4 h-4" />
                  <span>{isProcessing ? 'Processando...' : 'Enviar Planilha'}</span>
                </div>
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv,.txt" className="hidden" />
              </div>
            </div>

            <div className="lg:w-[400px] space-y-8">
              <div className="space-y-4">
                <h4 className="text-sm font-black text-blue-500 uppercase tracking-[0.2em] italic">Orientações Técnicas</h4>
                <ul className="space-y-4">
                  <li className="flex items-start space-x-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                    <p className="text-[11px] text-slate-400 font-bold leading-relaxed">Utilize o delimitador <span className="text-white">Pipe (|)</span> ao invés da vírgula.</p>
                  </li>
                  <li className="flex items-start space-x-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                    <p className="text-[11px] text-slate-400 font-bold leading-relaxed">Decimais podem ser escritos com <span className="text-blue-400">VÍRGULA (8,50)</span> sem deslocar colunas.</p>
                  </li>
                  <li className="flex items-start space-x-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                    <p className="text-[11px] text-slate-400 font-bold leading-relaxed">Itens novos serão incluídos, itens alterados serão atualizados e itens <span className="text-red-500">não presentes</span> na planilha serão removidos do estoque.</p>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col p-8 overflow-hidden">
            <div className="mb-6">
               <h3 className="text-lg font-black text-white uppercase italic tracking-tighter">Conferência de Integridade de Dados</h3>
               <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Os valores decimais foram processados corretamente através do delimitador Pipe.</p>
            </div>

            <div className="flex bg-[#1F2937] p-1.5 rounded-2xl mb-8 w-fit border border-slate-700">
               {[
                 { id: 'TODOS', label: 'Todos', count: stats.total },
                 { id: 'NOVOS', label: 'Novos', count: stats.new, color: 'text-emerald-500' },
                 { id: 'ATUALIZADOS', label: 'Atualizados', count: stats.changed, color: 'text-blue-500' },
                 { id: 'EXCLUIDOS', label: 'Excluir', count: stats.deleted, color: 'text-red-500' }
               ].map(tab => (
                 <button 
                  key={tab.id} 
                  onClick={() => setFilter(tab.id as any)}
                  className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center space-x-3 ${filter === tab.id ? 'bg-[#111827] text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                   <span>{tab.label}</span>
                   <span className={`bg-slate-800 px-2 py-0.5 rounded-lg ${tab.color || 'text-slate-400'}`}>{tab.count}</span>
                 </button>
               ))}
            </div>

            <div className="flex-1 overflow-auto rounded-[2rem] border border-slate-800 bg-[#111827]">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-[#1F2937] text-slate-500 text-[9px] font-black uppercase tracking-widest sticky top-0 z-10">
                  <tr>
                    <th className="px-8 py-4">Status</th>
                    <th className="px-8 py-4">LPN / SKU</th>
                    <th className="px-8 py-4">Material</th>
                    <th className="px-8 py-4 text-center">Local</th>
                    <th className="px-8 py-4 text-right">Saldo ML</th>
                    <th className="px-8 py-4">Diferenças</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredStaging.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-800/30 transition-all">
                      <td className="px-8 py-4">
                        <div className={`w-2.5 h-2.5 rounded-full ${
                          row.status === 'NEW' ? 'bg-emerald-500' :
                          row.status === 'CHANGED' ? 'bg-blue-500' :
                          row.status === 'DELETED' ? 'bg-red-500' : 'bg-slate-700 opacity-30'
                        }`} />
                      </td>
                      <td className="px-8 py-4">
                        <p className="font-black text-white">{row.item.lpn}</p>
                        <p className="text-[9px] text-blue-500 font-black">{row.item.sku}</p>
                      </td>
                      <td className="px-8 py-4 max-w-[200px]">
                        <p className="text-slate-400 font-bold truncate uppercase">{row.item.nome}</p>
                      </td>
                      <td className="px-8 py-4 text-center">
                        <span className="text-slate-200 font-black">{row.item.coluna}{row.item.prateleira}</span>
                      </td>
                      <td className="px-8 py-4 text-right">
                         <p className="text-white font-black">{row.item.quantMl.toFixed(2)} ML</p>
                      </td>
                      <td className="px-8 py-4 italic text-[9px] text-slate-500">
                        {row.diff && row.diff.length > 0 ? row.diff.join(' • ') : (row.status === 'NEW' ? 'Nova entrada' : (row.status === 'DELETED' ? 'REMOÇÃO' : 'Sem alterações'))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-8 flex justify-between items-center p-8 bg-[#1F2937] rounded-[2.5rem] border border-slate-800">
              <div className="flex space-x-8">
                <div className="text-center">
                  <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Total Volumes</p>
                  <p className="text-2xl font-black text-white">{stats.total}</p>
                </div>
                <div className="text-center">
                  <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Incluir</p>
                  <p className="text-2xl font-black text-emerald-500">{stats.new}</p>
                </div>
                <div className="text-center">
                  <p className="text-[8px] font-black text-red-500 uppercase tracking-widest">Remover</p>
                  <p className="text-2xl font-black text-red-500">{stats.deleted}</p>
                </div>
              </div>
              <div className="flex gap-4">
                <button onClick={() => setStep('UPLOAD')} className="px-8 py-4 bg-slate-800 text-slate-400 hover:text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all">Cancelar</button>
                <button onClick={confirmUpdate} className="px-10 py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-blue-900/40 hover:bg-blue-500 transition-all flex items-center space-x-3">
                   <ICONS.Inventory className="w-4 h-4" />
                   <span>Confirmar Sincronização</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InventoryUpdate;
