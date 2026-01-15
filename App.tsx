
import React, { useState, useEffect, useRef } from 'react';
import { User, ModuleContext, ViewType, CompanySettings, AppNotification } from './types';
import { DataService } from './services/dataService';
import { ICONS, SYSTEM_FEATURES } from './constants'; 
import { supabaseClient } from './services/core'; 

import Login from './components/Login';
import Inventory from './components/Inventory';
import ModuleSelection from './components/ModuleSelection';
import WithdrawalForm from './components/WithdrawalForm';
import MasterCatalog from './components/MasterCatalog';
import UserManagement from './components/UserManagement';
import InboundForm from './components/InboundForm';
import AuditInventoryForm from './components/AuditInventoryForm';
import Settings from './components/Settings';
import HistoryHub from './components/HistoryHub';
import MovementsList from './components/MovementsList'; 
import AccountsReceivableForm from './components/AccountsReceivableForm'; 
import AccountsPayableModule from './components/AccountsPayable';
import CashFlowBI from './components/CashFlowBI';
import ExpenseBI from './components/ExpenseBI'; 
import InventoryBI from './components/InventoryBI';
import HREmployees from './components/HREmployees';
import HRPayrollModule from './components/HRPayrollModule';
import HRServiceOrdersModule from './components/HRServiceOrdersModule';
import SalesPriceTable from './components/SalesPriceTable';
import SalesHistoryModule from './components/SalesHistoryModule';

interface AppErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface AppErrorBoundaryProps {
  children?: React.ReactNode;
}

class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, error: null };
  props: AppErrorBoundaryProps;

  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
    this.props = props;
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error: error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("NZERP CRITICAL: Erro de renderização não capturado na árvore de componentes:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col min-h-screen items-center justify-center p-6 text-center">
          <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-100 shadow-lg">
            <ICONS.Alert className="w-10 h-10" />
          </div>
          <h1 className="text-xl font-black text-slate-900 uppercase italic">ERRO CRÍTICO NA INTERFACE</h1>
          <p className="text-slate-600 max-w-md mt-2 mb-8 font-medium">
            Ocorreu um problema inesperado ao tentar carregar este módulo. A aplicação precisa ser recarregada.
          </p>
          <pre className="text-xs text-left mt-6 p-4 bg-red-50 text-red-700 rounded-lg overflow-auto max-w-lg mx-auto text-wrap break-all">
            {this.state.error instanceof Error ? this.state.error.message : JSON.stringify(this.state.error)}
          </pre>
          <button onClick={() => window.location.reload()} className="mt-8 px-8 py-3 bg-slate-900 text-white rounded-xl font-black text-xs uppercase tracking-widest italic hover:bg-blue-600 transition-all">
            RECARREGAR APLICATIVO
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [moduleContext, setModuleContext] = useState<ModuleContext>(null);
  const [currentView, setCurrentView] = useState<ViewType>('SELECAO_MODULO');
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);

  useEffect(() => {
    DataService.getCompanySettings().then(setCompanySettings).catch(() => {});
    
    const params = new URLSearchParams(window.location.search);
    if (params.get('lpn')) {
      setModuleContext('ESTOQUE');
      setCurrentView('INVENTARIO');
    }
  }, []);

  if (!currentUser) return <Login onLogin={setCurrentUser} />;

  if (!supabaseClient) {
    return (
      <div className="flex-1 flex flex-col min-h-screen items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-100 shadow-lg">
          <ICONS.Alert className="w-10 h-10" />
        </div>
        <h1 className="text-xl font-black text-slate-900 uppercase italic">FALHA NA CONEXÃO AO BANCO DE DADOS</h1>
        <p className="text-slate-600 max-w-md mt-2 mb-8 font-medium">
          Não foi possível estabelecer conexão com o Supabase. Verifique suas variáveis de ambiente.
        </p>
        <button onClick={() => window.location.reload()} className="mt-8 px-8 py-3 bg-slate-900 text-white rounded-xl font-black text-xs uppercase tracking-widest italic hover:bg-blue-600 transition-all">
          TENTAR RECONECTAR
        </button>
      </div>
    );
  }

  const hasAccess = (slug: string): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === 'DIRETORIA') return true;
    const permissions = Array.isArray(currentUser.permissions) ? currentUser.permissions : [];
    if (slug === 'CONFERENCIA_INVENTARIO') return permissions.includes('INVENTARIO');
    return permissions.includes(slug);
  };

  const navigate = (view: ViewType) => {
    if (view !== 'SELECAO_MODULO' && !hasAccess(view as string)) return;
    setCurrentView(view);
  };

  const renderContent = () => {
    try {
      switch (currentView) {
        case 'SELECAO_MODULO':
          return <ModuleSelection 
            onSelect={(ctx) => { 
              setModuleContext(ctx); 
              if (ctx === 'ESTOQUE') navigate('INVENTARIO');
              else if (ctx === 'FINANCEIRO') navigate('LANCAMENTO_RECEBER');
              else if (ctx === 'RH') navigate('RH_COLLABORATORS');
              else if (ctx === 'COMERCIAL') navigate('SALES_PRICETABLE');
            }} 
            userPermissions={currentUser.permissions || []} 
            isDirectory={currentUser.role === 'DIRETORIA'} 
            userName={currentUser.name} 
          />;
        
        case 'INVENTARIO': return <Inventory currentUser={currentUser} onStartAudit={(filters) => navigate('CONFERENCIA_INVENTARIO')} />;
        case 'BI_ESTOQUE': return <InventoryBI />; 
        case 'CONFERENCIA_INVENTARIO': return <AuditInventoryForm currentUser={currentUser} onCancel={() => navigate('INVENTARIO')} onSuccess={() => navigate('INVENTARIO')} filters={null} />;
        case 'MOVEMENTS_LIST': return <MovementsList />;
        case 'HISTORICO_HUB': return <HistoryHub currentUser={currentUser} />;
        case 'ENTRADA': return <InboundForm user={currentUser} onSuccess={() => navigate('INVENTARIO')} />;
        case 'SAIDA': return <WithdrawalForm currentUser={currentUser} onSuccess={() => navigate('INVENTARIO')} />;
        case 'CATALOGO_MESTRE': return <MasterCatalog user={currentUser} />;
        
        case 'LANCAMENTO_RECEBER': return <AccountsReceivableForm user={currentUser} onSuccess={() => {}} mode="LISTA" />;
        case 'INADIMPLENCIA': return <AccountsReceivableForm user={currentUser} onSuccess={() => {}} mode="INADIMPLENCIA" />;
        case 'CONTAS_PAGAR': return <AccountsPayableModule currentUser={currentUser} />;
        case 'BI_CAIXA': return <CashFlowBI />;
        case 'BI_DESPESAS': return <ExpenseBI />;

        case 'SALES_PRICETABLE': return <SalesPriceTable user={currentUser} />;
        case 'SALES_HISTORY': return <SalesHistoryModule user={currentUser} />;

        case 'RH_COLLABORATORS': return <HREmployees currentUser={currentUser} />;
        case 'RH_PAYROLL': return <HRPayrollModule currentUser={currentUser} />;
        case 'RH_SERVICE_ORDERS': return <HRServiceOrdersModule currentUser={currentUser} />;

        case 'GESTAO_USUARIOS': return <UserManagement admin={currentUser} />;
        case 'CONFIGURACOES': return <Settings admin={currentUser} onUpdate={setCompanySettings} onNavigate={navigate} />; 
        
        default: return <ModuleSelection onSelect={(ctx) => { setModuleContext(ctx); navigate('INVENTARIO'); }} userPermissions={currentUser.permissions || []} isDirectory={currentUser.role === 'DIRETORIA'} userName={currentUser.name} />;
      }
    } catch (e) {
      console.error("View Error:", e);
      return <div className="p-20 text-center font-black uppercase text-red-500">Módulo temporariamente indisponível. <button onClick={() => setCurrentView('SELECAO_MODULO')} className="underline">Retornar ao Início</button></div>;
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <nav className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center sticky top-0 z-[100] shadow-xl">
        <div className="flex flex-col cursor-pointer" onClick={() => navigate('SELECAO_MODULO')}>
          <h1 className="font-black italic text-2xl tracking-tighter text-white uppercase leading-none">NZERP</h1>
          <span className="text-[8px] font-black text-blue-400 uppercase tracking-widest mt-1">SISTEMA RESILIENTE</span>
        </div>

        <div className="flex items-center space-x-6">
          <div className="hidden md:flex space-x-4 border-r border-slate-800 pr-6 mr-6">
            
            {currentView !== 'SELECAO_MODULO' && moduleContext === 'ESTOQUE' && (
              <>
                {hasAccess('INVENTARIO') && <button onClick={() => navigate('INVENTARIO')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'INVENTARIO' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Estoque</button>}
                {hasAccess('BI_ESTOQUE') && <button onClick={() => navigate('BI_ESTOQUE')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'BI_ESTOQUE' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>BI Estoque</button>}
                {hasAccess('CATALOGO_MESTRE') && <button onClick={() => navigate('CATALOGO_MESTRE')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'CATALOGO_MESTRE' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Catálogo</button>}
                {hasAccess('ENTRADA') && <button onClick={() => navigate('ENTRADA')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'ENTRADA' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Entrada</button>}
                {hasAccess('SAIDA') && <button onClick={() => navigate('SAIDA')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'SAIDA' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Saída</button>}
                {hasAccess('MOVEMENTS_LIST') && <button onClick={() => navigate('MOVEMENTS_LIST')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'MOVEMENTS_LIST' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Movimentações</button>}
              </>
            )}

            {currentView !== 'SELECAO_MODULO' && moduleContext === 'COMERCIAL' && (
              <>
                {hasAccess('SALES_PRICETABLE') && <button onClick={() => navigate('SALES_PRICETABLE')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'SALES_PRICETABLE' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Tabela de Preço</button>}
                {hasAccess('SALES_HISTORY') && <button onClick={() => navigate('SALES_HISTORY')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'SALES_HISTORY' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Histórico Vendas</button>}
              </>
            )}

            {currentView !== 'SELECAO_MODULO' && moduleContext === 'FINANCEIRO' && (
              <>
                {hasAccess('LANCAMENTO_RECEBER') && <button onClick={() => navigate('LANCAMENTO_RECEBER')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'LANCAMENTO_RECEBER' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Contas a Receber</button>}
                {hasAccess('INADIMPLENCIA') && <button onClick={() => navigate('INADIMPLENCIA')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'INADIMPLENCIA' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Inadimplência</button>}
                {hasAccess('CONTAS_PAGAR') && <button onClick={() => navigate('CONTAS_PAGAR')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'CONTAS_PAGAR' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Contas a Pagar</button>}
                {hasAccess('BI_CAIXA') && <button onClick={() => navigate('BI_CAIXA')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'BI_CAIXA' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>BI Caixa</button>}
                {hasAccess('BI_DESPESAS') && <button onClick={() => navigate('BI_DESPESAS')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'BI_DESPESAS' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>BI Despesas</button>}
              </>
            )}

            {currentView !== 'SELECAO_MODULO' && moduleContext === 'RH' && (
              <>
                {hasAccess('RH_COLLABORATORS') && <button onClick={() => navigate('RH_COLLABORATORS')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'RH_COLLABORATORS' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Colaboradores</button>}
                {hasAccess('RH_PAYROLL') && <button onClick={() => navigate('RH_PAYROLL')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'RH_PAYROLL' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Folha de Pagamento</button>}
                {hasAccess('RH_SERVICE_ORDERS') && <button onClick={() => navigate('RH_SERVICE_ORDERS')} className={`text-[10px] font-black uppercase tracking-widest transition-all ${currentView === 'RH_SERVICE_ORDERS' ? 'text-white' : 'text-slate-400 hover:text-white'}`}>Contratos PJ</button>}
              </>
            )}
            
          </div>
          
          {hasAccess('CONFIGURACOES') && (
            <button 
              onClick={() => navigate('CONFIGURACOES')} 
              className="p-2.5 bg-blue-500/10 rounded-xl text-blue-500 hover:bg-blue-500 hover:text-white transition-all"
              title="Configurações"
            >
              <ICONS.Settings className="w-5 h-5" />
            </button>
          )}

          <button onClick={() => setCurrentUser(null)} className="p-2.5 bg-red-500/10 rounded-xl text-red-500 hover:bg-red-500 hover:text-white transition-all uppercase text-[10px] font-black italic">Sair</button>
        </div>
      </nav>

      <main className="flex-1 p-6 md:p-10 max-w-[1600px] w-full mx-auto">
        <AppErrorBoundary>
          {renderContent()}
        </AppErrorBoundary>
      </main>
    </div>
  );
};

export default App;
