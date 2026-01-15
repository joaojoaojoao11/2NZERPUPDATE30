

import React, { useState, useMemo, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { AccountsReceivable } from '../types';
import { ICONS } from '../constants';
import * as XLSX from 'xlsx';

type RangeFilter = 'TODOS' | '1-15' | '16-30' | '31-60' | '60+';

const DelinquencyModule: React.FC = () => {
  const [data, setData] = useState<AccountsReceivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('TODOS');
  
  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const items = await DataService.getAccountsReceivable();
      setData(items);
      setLoading(false);
    };
    fetch();
  }, []);

  const processedData = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    return data.filter(item => {
      if (!item.data_vencimento || item.saldo <= 0.01) return false;
      
      const [year, month, day] = item.data_vencimento.split('-').map(Number);
      const dueDate = new Date(year, month - 1, day).getTime();
      const diffDays = Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24));
      
      const isOverdue = dueDate < today;
      const notPaid = !(item.situacao || '').toLowerCase().includes('paga') && 
                      !(item.situacao || '').toLowerCase().includes('recebi');

      if (!isOverdue || !notPaid) return false;

      const matchesSearch = item.cliente.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           item.id.toLowerCase().includes(searchTerm.toLowerCase());
      
      if (!matchesSearch) return false;

      if (rangeFilter === '1-15') return diffDays <= 15;
      if (rangeFilter === '16-30') return diffDays > 15 && diffDays <= 30;
      if (rangeFilter === '31-60') return diffDays > 30 && diffDays <= 60;
      if (rangeFilter === '60+') return diffDays > 60;

      return true;
    }).map(item => {
      const [year, month, day] = item.data_vencimento.split('-').map(Number);
      const dueDate = new Date(year, month - 1, day).getTime();
      const diffDays = Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24));
      return { ...item, daysOverdue: diffDays };
    }).sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [data, searchTerm, rangeFilter]);

  const exportExcel = () => {
    const exportData = processedData.map(d => ({
      "ID": d.id,
      "CLIENTE": d.cliente,
      "VENCIMENTO": d.data_vencimento.split('-').reverse().join('/'),
      "DIAS EM ATRASO": d.daysOverdue,
      "VALOR SALDO": d.saldo,
      "FORMA PAGTO": d.forma_pagamento,
      "SITUAÇÃO": d.situacao,
      "CATEGORIA": d.categoria
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inadimplencia_NZERP");
    ws['!cols'] = [
      { wch: 10 }, { wch: 40 }, { wch: 15 }, { wch: 15 }, 
      { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 20 }
    ];
    XLSX.writeFile(wb, `NZERP_ATRASOS_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  if (loading) return (
    <div className="py-20 text-center opacity-30 font-black uppercase text-xs italic animate-pulse">
      Gerando Dossier de Inadimplência...
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10 flex flex-col h-full overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 shrink-0">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Atrasos de Carteira</h2>
          <p className="text-[10px] font-black text-red-600 uppercase tracking-[0.4em] mt-3 italic">Controle de Inadimplência NZERP</p>
        </div>
        
        <div className="flex flex-wrap gap-3">
           <button 
             onClick={exportExcel}
             className="px-6 py-4 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-emerald-700 transition-all flex items-center space-x-3 italic"
           >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="3"/></svg>
              <span>Exportar Excel</span>
           </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col md:flex-row gap-6 items-center shrink-0">
        <div className="relative flex-1 w-full">
          <input 
            type="text" 
            placeholder="LOCALIZAR CLIENTE OU TÍTULO..." 
            className="w-full pl-12 pr-6 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl outline-none font-black text-xs uppercase transition-all shadow-inner"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <svg className="w-5 h-5 text-slate-300 absolute left-4 top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeWidth="3"/></svg>
        </div>

        <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200 overflow-x-auto w-full md:w-auto shrink-0">
          {(['TODOS', '1-15', '16-30', '31-60', '60+'] as RangeFilter[]).map(r => (
            <button 
              key={r}
              onClick={() => setRangeFilter(r)}
              className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all whitespace-nowrap ${rangeFilter === r ? 'bg-white text-slate-900 shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {r === 'TODOS' ? 'TUDO' : `${r} dias`}
            </button>
          ))}
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th className="px-8 py-5">Cliente Vencido</th>
              <th className="px-8 py-5">Vencimento</th>
              <th className="px-8 py-5 text-center">Atraso</th>
              <th className="px-8 py-5 text-right">Saldo Devedor</th>
              <th className="px-8 py-5 text-left">Forma Pgto</th>
              <th className="px-8 py-5 text-center">ID</th>
            </tr>
          </thead>
          <tbody>
            {processedData.map(item => (
              <tr key={item.id} className="group hover:bg-red-50/30 transition-all cursor-default">
                <td className="px-8 py-6 border-b border-slate-100 font-black text-slate-900 uppercase italic text-[12px]">
                  {item.cliente}
                </td>
                <td className="px-8 py-6 border-b border-slate-100 font-bold text-[11px] text-slate-500">
                  {item.data_vencimento.split('-').reverse().join('/')}
                </td>
                <td className="px-8 py-6 border-b border-slate-100 text-center">
                  <div className={`inline-flex px-3 py-1 rounded-lg font-black text-[10px] uppercase border ${
                    item.daysOverdue > 30 ? 'bg-red-600 text-white border-red-700 shadow-lg' : 'bg-red-50 text-red-600 border-red-100'
                  }`}>
                    {item.daysOverdue} dias
                  </div>
                </td>
                <td className="px-8 py-6 border-b border-slate-100 text-right font-black text-slate-900 text-[13px]">
                  R$ {(item.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-8 py-6 border-b border-slate-100 font-black text-blue-600 text-[10px] uppercase italic">
                  {item.forma_pagamento}
                </td>
                <td className="px-8 py-6 border-b border-slate-100 text-center font-bold text-slate-300 text-[10px]">
                  #{item.id}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {processedData.length === 0 && (
          <div className="py-24 text-center">
             <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-100">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>
             </div>
             <p className="font-black text-slate-400 uppercase tracking-widest text-[10px] italic">Sua carteira está em dia.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DelinquencyModule;