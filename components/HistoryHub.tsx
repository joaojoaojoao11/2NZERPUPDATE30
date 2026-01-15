
import React, { useState, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { AuditLog, ApprovalCase, User } from '../types';
import AuditLogs from './AuditLogs';
import CaseManagement from './CaseManagement';

interface HistoryHubProps {
  currentUser: User;
}

const HistoryHub: React.FC<HistoryHubProps> = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState<'LOGS' | 'CASOS'>('LOGS');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    DataService.getApprovalCases().then(cases => {
      setPendingCount(cases.filter(c => c.status === 'PENDENTE').length);
    });
  }, [activeTab]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 shrink-0">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Central de Auditoria</h2>
          <p className="text-[10px] text-blue-600 font-bold uppercase tracking-[0.3em] mt-3 italic">Rastreabilidade global e controle de incidentes</p>
        </div>

        <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200 shadow-inner">
           <button 
             onClick={() => setActiveTab('LOGS')} 
             className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === 'LOGS' ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-500 hover:text-slate-700'}`}
           >
             Timeline de Operações
           </button>
           <button 
             onClick={() => setActiveTab('CASOS')} 
             className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-3 ${activeTab === 'CASOS' ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-500 hover:text-slate-700'}`}
           >
             Fila de Auditoria
             {pendingCount > 0 && (
               <span className={`px-2 py-0.5 rounded-md text-[8px] font-black ${activeTab === 'CASOS' ? 'bg-blue-500 text-white' : 'bg-red-500 text-white'}`}>
                 {pendingCount}
               </span>
             )}
           </button>
        </div>
      </div>

      <div className="bg-white rounded-[3rem] border border-slate-100 premium-shadow min-h-[600px] overflow-hidden">
        <div className="p-8">
           {activeTab === 'LOGS' ? <AuditLogs /> : <CaseManagement admin={currentUser} />}
        </div>
      </div>
    </div>
  );
};

export default HistoryHub;
