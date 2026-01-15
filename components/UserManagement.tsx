
import React, { useState, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { User, UserRole, ViewType } from '../types';
import Toast from './Toast';
import { ICONS } from '../constants';

const SYSTEM_FEATURES = [
  { id: 'INVENTARIO', label: 'Estoque / Pátio', group: 'LOGÍSTICA' },
  { id: 'CONFERENCIA_INVENTARIO', label: 'Executar Auditoria', group: 'LOGÍSTICA' },
  { id: 'CATALOGO_MESTRE', label: 'Catálogo Mestre', group: 'LOGÍSTICA' }, 
  { id: 'SAIDA', label: 'Registrar Saídas', group: 'LOGÍSTICA' },
  { id: 'ENTRADA', label: 'Registrar Entradas', group: 'LOGÍSTICA' },
  { id: 'HISTORICO_HUB', label: 'Timeline & Auditoria', group: 'LOGÍSTICA' },
  { id: 'LANCAMENTO_RECEBER', label: 'Contas a Receber', group: 'FINANCEIRO' },
  { id: 'INADIMPLENCIA', label: 'Inadimplência', group: 'FINANCEIRO' },
  { id: 'CONTAS_PAGAR', label: 'Contas a Pagar', group: 'FINANCEIRO' },
  { id: 'BI_CAIXA', label: 'Fluxo de Caixa (BI)', group: 'FINANCEIRO' }, 
  { id: 'BI_DESPESAS', label: 'Análise de Despesas (BI)', group: 'FINANCEIRO' }, 
  { id: 'RH_COLLABORATORS', label: 'Gestão de Colaboradores', group: 'RH' },
  { id: 'RH_PAYROLL', label: 'Folha de Pagamento', group: 'RH' },
  { id: 'RH_SERVICE_ORDERS', label: 'Gestão Contratos PJ', group: 'RH' }, 
  { id: 'SALES_PRICETABLE', label: 'Tabela de Preços', group: 'COMERCIAL' },
  { id: 'GESTAO_USUARIOS', label: 'Administrar Usuários', group: 'SISTEMA' },
  { id: 'CONFIGURACOES', label: 'Parâmetros Globais', group: 'SISTEMA' },
  { id: 'CAN_EDIT', label: 'Permitir Edição Cadastral', group: 'AÇÕES' },
];

const DEFAULT_PERMISSIONS: Record<UserRole, string[]> = {
  'ESTOQUISTA': ['INVENTARIO', 'CONFERENCIA_INVENTARIO', 'SAIDA', 'ENTRADA', 'CATALOGO_MESTRE'],
  'ADM': ['INVENTARIO', 'CONFERENCIA_INVENTARIO', 'SAIDA', 'ENTRADA', 'CATALOGO_MESTRE', 'HISTORICO_HUB', 'LANCAMENTO_RECEBER', 'INADIMPLENCIA', 'CONTAS_PAGAR', 'BI_CAIXA', 'BI_DESPESAS', 'GESTAO_USUARIOS', 'CAN_EDIT', 'RH_COLLABORATORS', 'RH_PAYROLL', 'RH_SERVICE_ORDERS', 'SALES_PRICETABLE'],
  'DIRETORIA': SYSTEM_FEATURES.map(f => f.id)
};

const UserManagement: React.FC<{ admin: User, onSelfUpdate?: () => void }> = ({ admin, onSelfUpdate }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [editing, setEditing] = useState<Partial<User> | null>(null);
  const [loading, setLoading] = useState(true);

  const isDirectory = admin.role === 'DIRETORIA';

  const refreshUsers = async () => {
    setLoading(true);
    const data = await DataService.getUsers();
    setUsers(data);
    setLoading(false);
  };

  useEffect(() => {
    refreshUsers();
  }, []);

  const handleRoleChange = (role: UserRole) => {
    if (!editing) return;
    setEditing({
      ...editing,
      role: role,
      permissions: DEFAULT_PERMISSIONS[role] || []
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing?.email || !editing?.name) {
      setToast({ msg: 'Preencha Nome e E-mail.', type: 'error' });
      return;
    }
    
    const validId = editing.id && editing.id !== "" && editing.id !== "undefined" ? editing.id : undefined;

    const userToSave: User = {
      id: validId as string,
      name: editing.name || '',
      email: editing.email || '',
      role: editing.role || 'ESTOQUISTA',
      password: editing.password || '123',
      active: editing.active !== undefined ? editing.active : true,
      permissions: editing.permissions || []
    };

    const result = await DataService.saveUser(userToSave, admin);
    if (result.success) {
      setToast({ msg: 'DADOS SINCRONIZADOS COM SUCESSO!', type: 'success' });
      
      if (editing.email === admin.email && onSelfUpdate) {
        onSelfUpdate();
      }
      
      setEditing(null);
      await refreshUsers();
    } else {
      setToast({ msg: `FALHA NO CADASTRO: ${result.message}`, type: 'error' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!isDirectory) {
      setToast({ msg: 'Apenas DIRETORIA pode excluir usuários.', type: 'error' });
      return;
    }
    if (window.confirm('Excluir este usuário permanentemente?')) {
      const success = await DataService.deleteUser(id, admin);
      if (success) {
        setToast({ msg: 'Usuário removido.', type: 'success' });
        await refreshUsers();
      } else {
        setToast({ msg: 'Erro ao excluir.', type: 'error' });
      }
    }
  };

  const togglePermission = (slug: string) => {
    if (!isDirectory) return;
    const current = editing?.permissions || [];
    const updated = current.includes(slug) 
      ? current.filter(s => s !== slug) 
      : [...current, slug];
    setEditing({ ...editing, permissions: updated });
  };

  const toggleGroup = (group: string) => {
    if (!isDirectory || !editing) return;
    const groupFeatureIds = SYSTEM_FEATURES.filter(f => f.group === group).map(f => f.id);
    const currentPermissions = editing.permissions || [];
    
    const allGroupSelected = groupFeatureIds.every(id => currentPermissions.includes(id));
    
    let updatedPermissions: string[];
    if (allGroupSelected) {
      updatedPermissions = currentPermissions.filter(id => !groupFeatureIds.includes(id));
    } else {
      updatedPermissions = Array.from(new Set([...currentPermissions, ...groupFeatureIds]));
    }
    
    setEditing({ ...editing, permissions: updatedPermissions });
  };

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="flex justify-between items-center bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-2xl font-black text-slate-800 uppercase italic tracking-tighter">IAM & Governança NZ</h2>
          <p className="text-sm text-slate-400 font-medium">Controle central de acessos e matriz de permissões.</p>
        </div>
        {isDirectory && (
          <button 
            onClick={() => setEditing({ 
              role: 'ESTOQUISTA', 
              active: true, 
              password: '123', 
              permissions: DEFAULT_PERMISSIONS['ESTOQUISTA'] 
            })}
            className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-black hover:bg-blue-700 shadow-xl transition-all uppercase tracking-widest text-xs italic"
          >
            + Novo Usuário
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-20 text-center opacity-30 font-black uppercase tracking-[0.3em] text-[10px]">Sincronizando Matriz de Acesso...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {users.map(u => (
            <div key={u.id || u.email} className={`p-6 bg-white rounded-3xl border border-slate-100 shadow-sm hover:border-blue-200 transition-all ${!u.active ? 'opacity-60 bg-slate-50' : ''}`}>
              <div className="flex items-center space-x-4 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-xl italic">
                  {u.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-black text-slate-800 truncate uppercase italic">{u.name}</h3>
                  <p className="text-xs text-slate-400 font-bold truncate">{u.email}</p>
                </div>
              </div>
              <div className="flex justify-between items-center mb-6">
                <span className={`px-3 py-1 rounded-xl text-[9px] font-black uppercase border ${
                  u.role === 'DIRETORIA' ? 'bg-indigo-600 text-white border-indigo-700' : 
                  u.role === 'ADM' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-slate-50 text-slate-500 border-slate-100'
                }`}>
                  {u.role}
                </span>
                <span className={`text-[9px] font-black uppercase ${u.active ? 'text-emerald-500' : 'text-red-400'}`}>
                  {u.active ? '• Ativo' : '• Bloqueado'}
                </span>
              </div>
              <div className="flex space-x-2 pt-4 border-t border-slate-50">
                <button onClick={() => setEditing(u)} className="flex-1 py-3 bg-slate-50 text-slate-600 font-black rounded-xl text-[9px] uppercase hover:bg-slate-100 transition-all italic tracking-widest">
                  {isDirectory ? 'Configurar Acessos' : 'Ver Perfil'}
                </button>
                {isDirectory && u.id && u.id !== admin.id && (
                  <button onClick={() => handleDelete(u.id)} className="px-4 py-3 bg-red-50 text-red-500 font-black rounded-xl text-[9px] uppercase hover:bg-red-100 transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[200] flex items-center justify-center p-6">
          <form onSubmit={handleSave} className="bg-white max-w-4xl w-full rounded-[2.5rem] p-10 shadow-2xl space-y-8 animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center border-b border-slate-50 pb-6 shrink-0">
               <div>
                  <h3 className="text-2xl font-black text-slate-800 uppercase italic tracking-tighter">
                     {editing.id ? 'Ficha de Governança' : 'Credenciamento NZ'}
                  </h3>
                  <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-1">Configuração de Alçada e Matriz de Risco</p>
               </div>
               <button type="button" onClick={() => setEditing(null)} className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-400 hover:text-red-500">
                  <ICONS.Add className="w-6 h-6 rotate-45" />
               </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-4 space-y-10 custom-scrollbar">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] italic">Dados de Identificação</p>
                     <div className="space-y-4">
                        <div className="space-y-1">
                           <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Nome de Exibição</label>
                           <input required disabled={!isDirectory} value={editing.name || ''} onChange={e => setEditing({...editing, name: e.target.value.toUpperCase()})} className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl font-bold uppercase outline-none shadow-inner" />
                        </div>
                        <div className="space-y-1">
                           <label className="text-[9px] font-black text-slate-400 uppercase ml-1">E-mail Corporativo</label>
                           <input required disabled={!isDirectory} type="email" value={editing.email || ''} onChange={e => setEditing({...editing, email: e.target.value})} className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl font-bold outline-none shadow-inner" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                           <div className="space-y-1">
                              <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Nível de Hierarquia</label>
                              <select 
                                disabled={!isDirectory} 
                                value={editing.role} 
                                onChange={e => handleRoleChange(e.target.value as UserRole)} 
                                className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl font-black italic uppercase outline-none shadow-inner cursor-pointer"
                              >
                                 <option value="ESTOQUISTA">Estoquista</option>
                                 <option value="ADM">Administrador</option>
                                 <option value="DIRETORIA">Diretoria</option>
                              </select>
                           </div>
                           <div className="space-y-1">
                              <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Senha Privada</label>
                              <input required disabled={!isDirectory} type="text" value={editing.password || ''} onChange={e => setEditing({...editing, password: e.target.value})} className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl font-bold outline-none shadow-inner" />
                           </div>
                        </div>
                        <div className="flex items-center space-x-3 pt-2">
                           <button 
                             type="button" 
                             disabled={!isDirectory}
                             onClick={() => setEditing({...editing, active: !editing.active})}
                             className={`w-12 h-6 rounded-full transition-all relative ${editing.active ? 'bg-emerald-500' : 'bg-slate-300'}`}
                           >
                              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${editing.active ? 'left-7' : 'left-1'}`}></div>
                           </button>
                           <label className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Acesso Habilitado</label>
                        </div>
                     </div>
                  </div>

                  <div className="space-y-4">
                     <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] italic">Matriz de Autorização (Abas & Ações)</p>
                     <div className="bg-slate-50 rounded-[2rem] p-6 border border-slate-100 space-y-6">
                        {Array.from(new Set(SYSTEM_FEATURES.map(f => f.group))).map(group => {
                          const groupIds = SYSTEM_FEATURES.filter(f => f.group === group).map(f => f.id);
                          const isAllSelected = groupIds.every(id => editing.permissions?.includes(id));
                          
                          return (
                            <div key={group} className="space-y-3">
                               <div className="flex justify-between items-center border-b border-slate-200/60 pb-1">
                                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{group}</p>
                                  {isDirectory && (
                                    <button 
                                      type="button"
                                      onClick={() => toggleGroup(group)}
                                      className={`text-[7px] font-black uppercase px-2 py-0.5 rounded transition-all ${
                                        isAllSelected ? 'text-red-500 hover:bg-red-50' : 'text-blue-600 hover:bg-blue-50'
                                      }`}
                                    >
                                      {isAllSelected ? 'Limpar Todos' : 'Marcar Todos'}
                                    </button>
                                  )}
                               </div>
                               <div className="grid grid-cols-1 gap-2">
                                  {SYSTEM_FEATURES.filter(f => f.group === group).map(feature => (
                                    <button
                                      key={feature.id}
                                      type="button"
                                      disabled={!isDirectory}
                                      onClick={() => togglePermission(feature.id)}
                                      className={`flex items-center justify-between p-3 rounded-xl transition-all border ${
                                        editing.permissions?.includes(feature.id) 
                                          ? 'bg-blue-600 border-blue-700 text-white shadow-md' 
                                          : 'bg-white border-slate-100 text-slate-400 grayscale'
                                      }`}
                                    >
                                       <span className="text-[9px] font-black uppercase tracking-tight">{feature.label}</span>
                                       {editing.permissions?.includes(feature.id) ? (
                                         <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                       ) : (
                                         <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-200"></div>
                                       )}
                                    </button>
                                  ))}
                               </div>
                            </div>
                          );
                        })}
                     </div>
                  </div>
               </div>
            </div>

            <div className="flex space-x-4 pt-6 border-t border-slate-50 shrink-0">
              <button type="button" onClick={() => setEditing(null)} className="flex-1 py-5 bg-slate-50 text-slate-500 font-black rounded-[1.5rem] uppercase tracking-widest text-[10px] italic">Cancelar</button>
              {isDirectory && (
                <button type="submit" className="flex-[2] py-5 bg-slate-950 text-white font-black rounded-[1.5rem] shadow-2xl shadow-blue-200 uppercase tracking-widest text-[10px] hover:bg-blue-600 transition-all italic">Efetivar Configuração de Acesso</button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
