
import React, { useState, useEffect, useMemo } from 'react';
import { DataService } from '../services/dataService';
import { StockItem, User, WithdrawalReason } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import { jsPDF } from 'jspdf';

interface AuditInventoryFormProps {
  currentUser: User;
  onCancel: () => void;
  onSuccess: () => void;
  filters: { column: string, shelf: string } | null;
}

const AuditInventoryForm: React.FC<AuditInventoryFormProps> = ({ currentUser, onCancel, onSuccess, filters }) => {
  const [inventory, setInventory] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [auditedValues, setAuditedValues] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [startTime] = useState(new Date().toISOString());

  useEffect(() => {
    const timer = setInterval(() => setSecondsElapsed(prev => prev + 1), 1000);
    
    const init = async () => {
      try {
        const data = await DataService.getInventory();
        const filtered = data.filter(item => {
          if (item.quantMl <= 0) return false;
          
          if (!filters || (!filters.column && !filters.shelf)) return true;
          
          // Lógica de filtro por texto livre (case insensitive includes)
          const matchCol = !filters.column || item.coluna.toUpperCase().includes(filters.column.toUpperCase());
          const matchShelf = !filters.shelf || item.prateleira.toUpperCase().includes(filters.shelf.toUpperCase());
          
          return matchCol && matchShelf;
        });

        setInventory(filtered);
        setLoading(false);
        
        await DataService.setAuditLock({
          id: 'ACTIVE',
          startTime,
          responsible: currentUser.name,
          status: 'IN_PROGRESS',
          itemsCount: filtered.length,
          posAdjustments: 0,
          negAdjustments: 0
        });
      } catch (e: any) {
        setToast({ msg: `Erro ao iniciar sessão: ${e.message}`, type: 'error' });
      }
    };
    init();

    return () => {
      clearInterval(timer);
      DataService.setAuditLock(null).catch(() => console.debug("Lock cleared."));
    };
  }, [filters, currentUser.name, startTime]);

  const generateInventoryPDF = () => {
    if (inventory.length === 0) return;

    const doc = new jsPDF();
    const itemsPerPage = 22;
    const totalPages = Math.ceil(inventory.length / itemsPerPage);

    for (let p = 0; p < totalPages; p++) {
      if (p > 0) doc.addPage();
      
      // Cabeçalho Premium
      doc.setFillColor(15, 23, 42); 
      doc.rect(0, 0, 210, 35, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('GABARITO DE INVENTARIO NZSTOK', 10, 15);
      
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(`DATA: ${new Date().toLocaleDateString()} | RESPONSAVEL: ${currentUser.name.toUpperCase()}`, 10, 22);
      doc.text(`STATUS: AUDITORIA EM CURSO | ITENS NO ESCOPO: ${inventory.length}`, 10, 26);

      let y = 45;
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(7);
      doc.text('LOCAL', 10, y);
      doc.text('LPN', 30, y);
      doc.text('SKU / MATERIAL', 60, y);
      doc.text('SISTEMA (ML)', 150, y);
      doc.text('FISICO (ANOTAR)', 180, y);
      
      doc.setDrawColor(226, 232, 240);
      doc.line(10, y + 2, 200, y + 2);
      
      y += 10;
      
      const pageItems = inventory.slice(p * itemsPerPage, (p + 1) * itemsPerPage);
      
      pageItems.forEach(item => {
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(`${item.coluna}-${item.prateleira}`, 10, y);
        
        doc.setFontSize(8);
        doc.setTextColor(37, 99, 235);
        doc.text(item.lpn, 30, y);
        
        doc.setTextColor(51, 65, 85);
        doc.setFontSize(8);
        doc.text(item.sku, 60, y);
        
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.text(item.nome.substring(0, 45).toUpperCase(), 60, y + 4);
        
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(9);
        doc.text(item.quantMl.toFixed(2), 150, y);
        
        doc.setDrawColor(148, 163, 184);
        doc.rect(178, y - 5, 22, 8);
        
        doc.setDrawColor(241, 245, 249);
        doc.line(10, y + 7, 200, y + 7);
        
        y += 11;
      });

      doc.setTextColor(148, 163, 184);
      doc.setFontSize(6);
      doc.text('NZSTOK ERP - DOCUMENTO DE CONTROLE INTERNO - EMISSAO DURANTE AUDITORIA', 105, 290, { align: 'center' });
    }

    doc.save(`NZSTOK_Gabarito_Realtime_${new Date().toISOString().slice(0,10)}.pdf`);
    setToast({ msg: 'GABARITO GERADO!', type: 'success' });
  };

  const filteredItems = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return inventory.filter(item => 
      item.sku.toLowerCase().includes(term) ||
      item.lpn.toLowerCase().includes(term) ||
      item.nome.toLowerCase().includes(term)
    );
  }, [inventory, searchTerm]);

  const handleFinishAudit = async () => {
    const lpnsToProcess = Object.keys(auditedValues);
    if (lpnsToProcess.length === 0) {
      setToast({ msg: 'PREENCHA AO MENOS UMA CONTAGEM.', type: 'error' });
      return;
    }

    if (!window.confirm(`Deseja finalizar o inventário de ${lpnsToProcess.length} itens?`)) return;

    setIsSubmitting(true);
    try {
      let pos = 0;
      let neg = 0;
      
      const withdrawalBatchItems: any[] = [];
      const auditLogConfirmations: any[] = [];

      for (const lpn of lpnsToProcess) {
        const item = inventory.find(i => i.lpn === lpn);
        if (!item) continue;

        const auditedQty = parseFloat(auditedValues[lpn].replace(',', '.'));
        if (isNaN(auditedQty)) continue;

        if (auditedQty !== item.quantMl) {
          const delta = item.quantMl - auditedQty;
          if (delta < 0) pos++; else neg++; 

          withdrawalBatchItems.push({
            lpn: item.lpn,
            sku: item.sku,
            nome: item.nome,
            categoria: item.categoria,
            lote: item.lote,
            quantidade: Math.abs(delta), 
            motivo: WithdrawalReason.AUDITORIA,
            relato: `INVENTÁRIO FÍSICO. SISTEMA: ${item.quantMl} | FÍSICO: ${auditedQty}.`,
            custoUnitario: item.custoUnitario,
            nfControle: item.nfControle, 
            extra: { pedido: 'INVENTÁRIO', cliente: 'NZSTOK PÁTIO', vendedor: currentUser.name }
          });
        } else {
            auditLogConfirmations.push({
              user: currentUser, 
              action: 'INVENTARIO_OK', 
              sku: item.sku, 
              lpn: item.lpn, 
              qty: 0, 
              details: 'Saldo físico confirmado.', 
              lote: item.lote, 
              name: item.nome, 
              valorOperacao: item.custoUnitario, 
              nfControle: item.nfControle, 
              tipo: 'LOGISTICA', 
              category: item.categoria
            });
        }
      }

      if (withdrawalBatchItems.length > 0) {
        const withdrawalResponse = await DataService.registerWithdrawalBatch(withdrawalBatchItems, currentUser);
        if (!withdrawalResponse.success) {
          throw new Error(withdrawalResponse.message || "Erro ao registrar ajustes de inventário.");
        }
      }

      for (const logData of auditLogConfirmations) {
        await DataService.addLog(logData.user, logData.action, logData.sku, logData.lpn, logData.qty, logData.details, logData.lote, logData.name, logData.valorOperacao, logData.nfControle, logData.tipo, logData.category);
      }

      await DataService.saveInventorySession({
        id: 'INV-' + Date.now(),
        startTime,
        endTime: new Date().toISOString(),
        responsible: currentUser.name,
        status: 'COMPLETED',
        itemsCount: lpnsToProcess.length,
        posAdjustments: pos,
        negAdjustments: neg,
        observation: 'Inventário finalizado.',
        durationSeconds: secondsElapsed
      });
      
      await DataService.setAuditLock(null);
      setToast({ msg: 'INVENTÁRIO FINALIZADO!', type: 'success' });
      setTimeout(onSuccess, 1000);
    } catch (e: any) {
      setToast({ msg: `Erro ao gravar inventário: ${e.message}`, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return (
    <div className="h-full flex flex-col items-center justify-center py-32 opacity-30">
      <div className="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-[10px] font-black uppercase tracking-[0.3em] mt-4">Sincronizando Sessão de Auditoria...</p>
    </div>
  );

  return (
    <div className="h-full flex flex-col space-y-6 animate-in slide-in-from-bottom-4 duration-500 overflow-hidden pb-4">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="bg-slate-950 p-6 md:p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl relative shrink-0">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h2 className="text-2xl font-black text-white uppercase italic leading-none">Inventário de Pátio</h2>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-2 italic">
              {(!filters || (!filters.column && !filters.shelf)) 
                ? 'Escopo: Pátio Inteiro (Físico Total)' 
                : `Escopo Parcial: ${filters.column ? `COL: ${filters.column} ` : ''}${filters.shelf ? `NÍV: ${filters.shelf}` : ''}`}
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
                onClick={generateInventoryPDF}
                className="px-6 py-4 bg-white/10 hover:bg-white/20 border border-white/10 text-white rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-2 italic"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Imprimir Gabarito
            </button>

            <div className="flex bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow-inner">
                <div className="text-center px-4 border-r border-slate-800">
                    <p className="text-[7px] font-black text-blue-500 uppercase mb-0.5">Tempo</p>
                    <p className="text-lg font-black text-white mono">{Math.floor(secondsElapsed/60)}m {secondsElapsed%60}s</p>
                </div>
                <div className="text-center px-4">
                    <p className="text-[7px] font-black text-emerald-500 uppercase mb-0.5">Contagens</p>
                    <p className="text-lg font-black text-white mono">{Object.keys(auditedValues).length}</p>
                </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white p-4 rounded-[2rem] border border-slate-200 shadow-sm shrink-0">
        <div className="relative group">
          <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="3"/></svg>
          </div>
          <input 
            type="text" 
            placeholder="Escanear LPN ou SKU para inventariar..." 
            className="w-full pl-14 pr-8 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl outline-none font-black text-sm transition-all uppercase shadow-inner"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value.toUpperCase())}
            autoFocus
          />
        </div>
      </div>

      <div className="table-container flex-1 overflow-auto bg-white border border-slate-200 rounded-[2rem]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-48 text-center"><div className="flex justify-center">Protocolo LPN</div></th>
              <th className="text-left">Material & Descrição</th>
              <th className="w-40 text-center"><div className="flex justify-center">Localização</div></th>
              <th className="w-56 text-center"><div className="flex justify-center">Saldo Contado (ML)</div></th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map(item => (
              <tr key={item.lpn} className="hover:bg-blue-50/30 transition-all">
                <td className="text-center">
                  <span className="lpn-badge-industrial">{item.lpn}</span>
                </td>
                <td className="text-left">
                  <p className="text-[13px] font-black text-slate-900 leading-none uppercase italic">{item.sku}</p>
                  <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase truncate max-w-[320px]">{item.nome}</p>
                </td>
                <td className="text-center">
                  <span className="loc-badge">COL {item.coluna}-{item.prateleira}</span>
                </td>
                <td className="text-center">
                  <div className="flex justify-center">
                    <div className="relative">
                      <input 
                        type="text" 
                        value={auditedValues[item.lpn] || ''}
                        onChange={(e) => setAuditedValues(prev => ({ ...prev, [item.lpn]: e.target.value }))}
                        placeholder="0.00"
                        className="w-40 px-4 py-2 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-xl font-black text-center italic outline-none transition-all"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[8px] font-black text-slate-300">ML</span>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
            {filteredItems.length === 0 && (
              <tr>
                <td colSpan={4} className="py-24 text-center opacity-30 italic font-black uppercase text-[10px]">
                  Nenhum volume localizado no escopo de auditoria
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-4 shrink-0 pt-2">
          <button 
            onClick={onCancel} 
            className="px-8 py-4 bg-white border border-slate-200 text-slate-400 font-black rounded-2xl uppercase text-[10px] tracking-widest transition-all hover:bg-slate-50 hover:text-red-500 italic"
          >
            Cancelar Inventário
          </button>
          <button 
            onClick={handleFinishAudit} 
            disabled={isSubmitting}
            className="px-12 py-4 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all italic disabled:opacity-50 active:scale-95"
          >
            {isSubmitting ? 'EFETIVANDO AJUSTES...' : 'Finalizar e Baixar Divergências'}
          </button>
      </div>
    </div>
  );
};

export default AuditInventoryForm;
