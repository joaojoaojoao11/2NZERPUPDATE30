
import React from 'react';
import { ICONS } from '../constants';
import { ModuleContext } from '../types';

interface ModuleSelectionProps {
  onSelect: (context: ModuleContext) => void;
  userName: string;
  userPermissions: string[];
  isDirectory: boolean;
}

const ModuleSelection: React.FC<ModuleSelectionProps> = ({ onSelect, userName, userPermissions, isDirectory }) => {
  
  const hasLogisticsAccess = isDirectory || ['INVENTARIO', 'SAIDA', 'ENTRADA', 'MAPA_FISICO', 'HISTORICO_HUB'].some(p => userPermissions.includes(p));
  const hasFinanceAccess = isDirectory || ['LANCAMENTO_RECEBER', 'FINANCEIRO', 'CONTAS_PAGAR'].some(p => userPermissions.includes(p));
  const hasRhAccess = isDirectory || userPermissions.includes('RH_COLLABORATORS');
  const hasComercialAccess = isDirectory || ['SALES_PRICETABLE', 'SALES_HISTORY'].some(p => userPermissions.includes(p));
  
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 py-8 animate-in fade-in zoom-in-95 duration-700">
      <div className="text-center mb-12">
        <h2 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">
          Olá, {userName.split(' ')[0]}
        </h2>
        <p className="text-[10px] md:text-xs text-slate-400 font-bold uppercase tracking-[0.4em] mt-4 italic">
          NZERP • Selecione o Ambiente de Trabalho
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-7xl">
        
        {/* MÓDULO LOGÍSTICA */}
        {hasLogisticsAccess ? (
          <button 
            onClick={() => onSelect('ESTOQUE')}
            className="group bg-white p-8 rounded-[3rem] border border-slate-100 shadow-2xl text-left hover:border-blue-600 hover:bg-blue-50/20 transition-all transform active:scale-95 flex flex-col justify-between h-[380px]"
          >
            <div>
              <div className="w-16 h-16 bg-blue-600 text-white rounded-3xl flex items-center justify-center shadow-lg mb-8 group-hover:scale-110 group-hover:rotate-3 transition-all">
                <ICONS.Inventory className="w-8 h-8" />
              </div>
              <h3 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter leading-none group-hover:text-blue-700 transition-colors">
                PÁTIO E<br/>LOGÍSTICA
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-4 leading-relaxed opacity-70">
                Inventário físico, etiquetas LPN, movimentações e conferência de entrada.
              </p>
            </div>
            <div className="flex items-center space-x-3 text-blue-600 font-black text-[10px] uppercase tracking-widest mt-6">
              <span>Iniciar Rotina</span>
              <svg className="w-4 h-4 transition-transform group-hover:translate-x-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 8l4 4m0 0l-4 4m4-4H3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </button>
        ) : (
          <div className="p-8 bg-slate-50 rounded-[3rem] border border-slate-200 text-center opacity-50 flex flex-col justify-center items-center h-[380px]">
             <ICONS.Inventory className="w-12 h-12 text-slate-400 mb-4" />
             <h3 className="text-xl font-black text-slate-900 uppercase">Logística Restrita</h3>
          </div>
        )}

        {/* MÓDULO COMERCIAL */}
        {hasComercialAccess ? (
          <button 
            onClick={() => onSelect('COMERCIAL')}
            className="group bg-white p-8 rounded-[3rem] border border-slate-100 shadow-2xl text-left hover:border-indigo-600 hover:bg-indigo-50/20 transition-all transform active:scale-95 flex flex-col justify-between h-[380px]"
          >
            <div>
              <div className="w-16 h-16 bg-gradient-to-br from-indigo-600 to-purple-600 text-white rounded-3xl flex items-center justify-center shadow-lg mb-8 group-hover:scale-110 group-hover:rotate-3 transition-all">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
              </div>
              <h3 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter leading-none group-hover:text-indigo-700 transition-colors">
                GESTÃO<br/>COMERCIAL
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-4 leading-relaxed opacity-70">
                Tabela de preços dinâmica, gestão de markup, controle de status de produtos e histórico de faturamento.
              </p>
            </div>
            <div className="flex items-center space-x-3 text-indigo-600 font-black text-[10px] uppercase tracking-widest mt-6">
              <span>Acessar Vendas</span>
              <svg className="w-4 h-4 transition-transform group-hover:translate-x-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 8l4 4m0 0l-4 4m4-4H3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </button>
        ) : (
          <div className="p-8 bg-slate-50 rounded-[3rem] border border-slate-200 text-center opacity-50 flex flex-col justify-center items-center h-[380px]">
             <svg className="w-12 h-12 text-slate-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
             <h3 className="text-xl font-black text-slate-900 uppercase">Comercial Restrito</h3>
          </div>
        )}

        {/* MÓDULO FINANCEIRO */}
        {hasFinanceAccess ? (
          <button 
            onClick={() => onSelect('FINANCEIRO')}
            className="group bg-white p-8 rounded-[3rem] border border-slate-100 shadow-2xl text-left hover:border-emerald-600 hover:bg-emerald-50/20 transition-all transform active:scale-95 flex flex-col justify-between h-[380px]"
          >
            <div>
              <div className="w-16 h-16 bg-emerald-600 text-white rounded-3xl flex items-center justify-center shadow-lg mb-8 group-hover:scale-110 group-hover:-rotate-3 transition-all">
                <ICONS.Finance className="w-8 h-8" />
              </div>
              <h3 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter leading-none group-hover:text-emerald-700 transition-colors">
                GESTÃO<br/>FINANCEIRA
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-4 leading-relaxed opacity-70">
                Controle de Contas a Pagar e Receber, fluxo de caixa e conciliação bancária.
              </p>
            </div>
            <div className="flex items-center space-x-3 text-emerald-600 font-black text-[10px] uppercase tracking-widest mt-6">
              <span>Acessar Módulo</span>
              <svg className="w-4 h-4 transition-transform group-hover:translate-x-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 8l4 4m0 0l-4 4m4-4H3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </button>
        ) : (
          <div className="p-8 bg-slate-50 rounded-[3rem] border border-slate-200 text-center opacity-50 flex flex-col justify-center items-center h-[380px]">
             <ICONS.Finance className="w-12 h-12 text-slate-400 mb-4" />
             <h3 className="text-xl font-black text-slate-900 uppercase">Financeiro Restrito</h3>
          </div>
        )}

        {/* MÓDULO RH */}
        {hasRhAccess ? (
          <button 
            onClick={() => onSelect('RH')}
            className="group bg-white p-8 rounded-[3rem] border border-slate-100 shadow-2xl text-left hover:border-purple-600 hover:bg-purple-50/20 transition-all transform active:scale-95 flex flex-col justify-between h-[380px]"
          >
            <div>
              <div className="w-16 h-16 bg-blue-900 text-white rounded-3xl flex items-center justify-center shadow-lg mb-8 group-hover:scale-110 group-hover:rotate-3 transition-all">
                 <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              </div>
              <h3 className="text-3xl font-black text-slate-900 uppercase italic tracking-tighter leading-none group-hover:text-purple-700 transition-colors">
                RH &<br/>PESSOAS
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-4 leading-relaxed opacity-70">
                Gestão de colaboradores, contratos, folha de pagamento e benefícios.
              </p>
            </div>
            <div className="flex items-center space-x-3 text-purple-600 font-black text-[10px] uppercase tracking-widest mt-6">
              <span>Gerenciar Equipe</span>
              <svg className="w-4 h-4 transition-transform group-hover:translate-x-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 8l4 4m0 0l-4 4m4-4H3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </button>
        ) : (
          <div className="p-8 bg-slate-50 rounded-[3rem] border border-slate-200 text-center opacity-50 flex flex-col justify-center items-center h-[380px]">
             <svg className="w-12 h-12 text-slate-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
             <h3 className="text-xl font-black text-slate-900 uppercase">RH Restrito</h3>
          </div>
        )}
      </div>
    </div>
  );
};

export default ModuleSelection;
