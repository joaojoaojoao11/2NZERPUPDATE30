
import React, { useState, useEffect, useMemo } from 'react';
import { HRService } from '../services/hrService';
import { Employee, User } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';
import HRDocumentsModal from './HRDocumentsModal';

interface HREmployeesProps {
  currentUser: User;
}

const HREmployees: React.FC<HREmployeesProps> = ({ currentUser }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Estados do Modal e Formulário de Cadastro/Edição
  const [showModal, setShowModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  
  // Estado para Modal de Documentos
  const [selectedEmployeeDocs, setSelectedEmployeeDocs] = useState<Employee | null>(null);

  // Estado local para controle do Checkbox de VT
  const [optanteVT, setOptanteVT] = useState(false);
  
  const initialFormState: Employee = {
    fullName: '',
    cpf: '',
    jobTitle: '',
    department: '',
    hireDate: new Date().toISOString().split('T')[0],
    salaryAmount: 0,
    contractType: 'CLT',
    status: 'ACTIVE',
    email: '',
    phone: '',
    pixKey: '',
    notes: '',
    transportDailyValue: 0
  };

  const [formData, setFormData] = useState<Employee>(initialFormState);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await HRService.getEmployees();
      setEmployees(data);
    } catch (e) {
      console.error("Erro ao carregar colaboradores", e);
      setToast({ msg: "Erro ao carregar lista.", type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredData = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return employees.filter(e => 
      e.fullName.toLowerCase().includes(term) ||
      e.cpf.includes(term) ||
      e.jobTitle.toLowerCase().includes(term) ||
      e.department.toLowerCase().includes(term)
    );
  }, [employees, searchTerm]);

  const handleOpenNew = () => {
    setFormData(initialFormState);
    setOptanteVT(false);
    setShowModal(true);
  };

  const handleOpenEdit = (emp: Employee) => {
    setFormData({ ...emp });
    // Define se é optante baseado se tem valor cadastrado > 0
    setOptanteVT(!!emp.transportDailyValue && emp.transportDailyValue > 0);
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Tem certeza que deseja excluir este colaborador?")) return;
    
    try {
      const res = await HRService.deleteEmployee(id);
      if (res.success) {
        setToast({ msg: "Colaborador removido com sucesso.", type: 'success' });
        fetchData();
      } else {
        setToast({ msg: res.message || "Erro ao remover.", type: 'error' });
      }
    } catch (e) {
      setToast({ msg: "Erro de conexão.", type: 'error' });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.fullName || !formData.cpf || !formData.jobTitle) {
      setToast({ msg: "Preencha os campos obrigatórios (Nome, CPF, Cargo).", type: 'error' });
      return;
    }

    setIsProcessing(true);
    try {
      // Prepara payload garantindo coerência do VT
      const payload = { ...formData };
      
      // Se não for optante, zera o valor forçadamente
      if (!optanteVT) {
        payload.transportDailyValue = 0;
      } else {
        // Garante que é um número válido antes de enviar
        payload.transportDailyValue = Number(payload.transportDailyValue) || 0;
      }

      const res = await HRService.saveEmployee(payload);
      if (res.success) {
        setToast({ msg: "Dados salvos com sucesso!", type: 'success' });
        // Pequeno delay para leitura do Toast
        if (res.message?.includes("Aviso")) {
             alert("Atenção: O valor do VT não foi salvo porque o banco de dados precisa ser atualizado. Contate o suporte.");
        }
        setShowModal(false);
        fetchData();
      } else {
        setToast({ msg: res.message || "Erro ao salvar.", type: 'error' });
      }
    } catch (err) {
      setToast({ msg: "Erro crítico ao salvar.", type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <span className="bg-emerald-50 text-emerald-600 border-emerald-100 border px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider">ATIVO</span>;
      case 'VACATION':
        return <span className="bg-blue-50 text-blue-600 border-blue-100 border px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider">FÉRIAS</span>;
      case 'TERMINATED':
        return <span className="bg-red-50 text-red-600 border-red-100 border px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider">DESLIGADO</span>;
      default:
        return <span className="bg-slate-50 text-slate-500 border-slate-200 border px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider">{status}</span>;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 opacity-30">
        <div className="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-[10px] font-black uppercase tracking-[0.3em]">Carregando Equipe...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10 flex flex-col h-full">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Gestão de Pessoas</h2>
          <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.4em] mt-2 italic">
            Recursos Humanos & Departamento Pessoal
          </p>
        </div>
        
        <div className="flex gap-3 items-center">
           <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex-1 md:w-80">
              <input 
                type="text" 
                placeholder="BUSCAR NOME, CPF OU CARGO..." 
                className="w-full px-4 py-2 bg-transparent outline-none font-bold text-xs uppercase placeholder:text-slate-300"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <div className="pr-2 text-slate-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
           </div>

           <button 
             onClick={handleOpenNew}
             className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg hover:bg-blue-600 transition-all flex items-center space-x-2 italic"
           >
             <ICONS.Add className="w-3.5 h-3.5" />
             <span>Novo Colaborador</span>
           </button>
        </div>
      </div>

      {/* Tabela */}
      <div className="table-container flex-1 overflow-auto border border-slate-200 rounded-[2rem] bg-white shadow-sm">
        <table className="w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800">Nome Completo</th>
              <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800">CPF</th>
              <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800">Cargo</th>
              <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-left border-b border-slate-800">Departamento</th>
              <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-center border-b border-slate-800">Contrato</th>
              <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-center border-b border-slate-800">Status</th>
              <th className="bg-slate-900 text-slate-400 px-6 py-4 text-[9px] font-black uppercase tracking-widest text-right border-b border-slate-800">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredData.map(emp => (
              <tr key={emp.id} className="group hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 border-b border-slate-100">
                  <div className="flex flex-col">
                    <span className="font-black text-slate-900 text-[11px] uppercase tracking-tight">{emp.fullName}</span>
                    <span className="text-[9px] text-slate-400 font-bold uppercase">{emp.email}</span>
                  </div>
                </td>
                <td className="px-6 py-4 border-b border-slate-100 font-mono text-[10px] font-bold text-slate-500">
                  {emp.cpf}
                </td>
                <td className="px-6 py-4 border-b border-slate-100 font-bold text-[10px] text-slate-600 uppercase">
                  {emp.jobTitle}
                </td>
                <td className="px-6 py-4 border-b border-slate-100 font-black text-[9px] text-blue-600 uppercase tracking-wide">
                  {emp.department}
                </td>
                <td className="px-6 py-4 border-b border-slate-100 text-center text-[9px] font-bold text-slate-500 uppercase">
                  {emp.contractType}
                </td>
                <td className="px-6 py-4 border-b border-slate-100 text-center">
                  {getStatusBadge(emp.status)}
                </td>
                <td className="px-6 py-4 border-b border-slate-100 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => setSelectedEmployeeDocs(emp)}
                      className="p-2 text-slate-400 hover:text-amber-600 bg-white border border-slate-200 rounded-xl hover:border-amber-200 transition-all shadow-sm"
                      title="Documentos"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                    </button>
                    <button 
                      onClick={() => handleOpenEdit(emp)}
                      className="p-2 text-slate-400 hover:text-blue-600 bg-white border border-slate-200 rounded-xl hover:border-blue-200 transition-all shadow-sm"
                      title="Editar"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                    <button 
                      onClick={() => handleDelete(emp.id!)}
                      className="p-2 text-slate-400 hover:text-red-600 bg-white border border-slate-200 rounded-xl hover:border-red-200 transition-all shadow-sm"
                      title="Excluir"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredData.length === 0 && (
              <tr>
                <td colSpan={7} className="py-20 text-center opacity-30 font-black uppercase text-[10px]">
                  Nenhum colaborador encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de Documentos */}
      {selectedEmployeeDocs && (
        <HRDocumentsModal 
          employee={selectedEmployeeDocs} 
          onClose={() => setSelectedEmployeeDocs(null)} 
        />
      )}

      {/* Modal de Edição/Criação */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[150] flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-white max-w-4xl w-full rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[90vh]">
              
              <div className="px-10 py-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
                 <div>
                    <h3 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter">
                       {formData.id ? 'Editar Colaborador' : 'Novo Contrato'}
                    </h3>
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-2 italic">
                       Ficha Cadastral & Contratual
                    </p>
                 </div>
                 <button onClick={() => setShowModal(false)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all">
                    <ICONS.Add className="w-5 h-5 rotate-45" />
                 </button>
              </div>

              <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-10 custom-scrollbar">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    
                    {/* Coluna 1: Dados Pessoais */}
                    <div className="space-y-5">
                       <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">Dados Pessoais</h4>
                       
                       <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Nome Completo *</label>
                          <input 
                            required
                            value={formData.fullName}
                            onChange={e => setFormData({...formData, fullName: e.target.value.toUpperCase()})}
                            className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all uppercase"
                            placeholder="NOME DO FUNCIONÁRIO"
                          />
                       </div>

                       <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">CPF (Apenas Números) *</label>
                          <input 
                            required
                            value={formData.cpf}
                            onChange={e => setFormData({...formData, cpf: e.target.value.replace(/\D/g, '')})}
                            className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all uppercase"
                            placeholder="00000000000"
                            maxLength={11}
                          />
                       </div>

                       <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">E-mail Corporativo</label>
                          <input 
                            type="email"
                            value={formData.email}
                            onChange={e => setFormData({...formData, email: e.target.value})}
                            className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all"
                            placeholder="exemplo@nzstok.com"
                          />
                       </div>

                       <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Telefone / WhatsApp</label>
                          <input 
                            value={formData.phone}
                            onChange={e => setFormData({...formData, phone: e.target.value})}
                            className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all uppercase"
                            placeholder="(00) 00000-0000"
                          />
                       </div>
                    </div>

                    {/* Coluna 2: Dados Contratuais e Benefícios */}
                    <div className="space-y-5">
                       <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">Vínculo & Cargo</h4>

                       <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Cargo / Função *</label>
                             <input 
                               required
                               value={formData.jobTitle}
                               onChange={e => setFormData({...formData, jobTitle: e.target.value.toUpperCase()})}
                               className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all uppercase"
                             />
                          </div>
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Departamento</label>
                             <input 
                               value={formData.department}
                               onChange={e => setFormData({...formData, department: e.target.value.toUpperCase()})}
                               className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all uppercase"
                             />
                          </div>
                       </div>

                       <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Salário Base (R$)</label>
                             <input 
                               type="number"
                               step="0.01"
                               value={formData.salaryAmount}
                               onChange={e => setFormData({...formData, salaryAmount: parseFloat(e.target.value)})}
                               className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all"
                             />
                          </div>
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Admissão</label>
                             <input 
                               type="date"
                               value={formData.hireDate}
                               onChange={e => setFormData({...formData, hireDate: e.target.value})}
                               className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all uppercase"
                             />
                          </div>
                       </div>

                       <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Regime Contrato</label>
                             <select 
                               value={formData.contractType}
                               onChange={e => setFormData({...formData, contractType: e.target.value as any})}
                               className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all uppercase cursor-pointer"
                             >
                                <option value="CLT">CLT</option>
                                <option value="PJ">PJ</option>
                                <option value="ESTAGIO">ESTÁGIO</option>
                                <option value="APRENDIZ">APRENDIZ</option>
                                <option value="OUTRO">OUTRO</option>
                             </select>
                          </div>
                          <div className="space-y-1.5">
                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Status Atual</label>
                             <select 
                               value={formData.status}
                               onChange={e => setFormData({...formData, status: e.target.value as any})}
                               className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all uppercase cursor-pointer"
                             >
                                <option value="ACTIVE">ATIVO</option>
                                <option value="VACATION">FÉRIAS</option>
                                <option value="TERMINATED">DESLIGADO</option>
                             </select>
                          </div>
                       </div>

                       <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Chave PIX (Pagamentos)</label>
                          <input 
                            value={formData.pixKey}
                            onChange={e => setFormData({...formData, pixKey: e.target.value})}
                            className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all"
                            placeholder="CPF, E-mail ou Aleatória"
                          />
                       </div>

                       {/* SEÇÃO DE BENEFÍCIOS */}
                       <div className="pt-4 mt-2 border-t border-slate-100">
                          <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-3">Benefícios & Transporte</h4>
                          <div className="space-y-3">
                             <label className="flex items-center gap-3 p-3 rounded-2xl bg-blue-50/50 border border-blue-100 cursor-pointer hover:bg-blue-50 transition-all">
                                <input 
                                  type="checkbox"
                                  checked={optanteVT}
                                  onChange={(e) => setOptanteVT(e.target.checked)}
                                  className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                />
                                <span className="text-[10px] font-black text-slate-700 uppercase">Optante pelo Vale Transporte?</span>
                             </label>
                             
                             {optanteVT && (
                                <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-300">
                                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Custo Diário de Transporte (R$)</label>
                                   <div className="relative">
                                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">R$</span>
                                      <input 
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={formData.transportDailyValue === 0 ? '' : formData.transportDailyValue}
                                        onChange={e => {
                                            const val = e.target.value;
                                            const numVal = val === '' ? 0 : parseFloat(val);
                                            setFormData({...formData, transportDailyValue: numVal});
                                        }}
                                        className="w-full pl-10 pr-5 py-3.5 bg-white border-2 border-slate-200 focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all"
                                        placeholder="0.00"
                                      />
                                   </div>
                                </div>
                             )}
                          </div>
                       </div>
                    </div>
                 </div>
                 
                 <div className="mt-8 space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Notas e Observações</label>
                    <textarea 
                      value={formData.notes}
                      onChange={e => setFormData({...formData, notes: e.target.value.toUpperCase()})}
                      rows={3}
                      className="w-full px-5 py-3.5 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl text-xs font-bold outline-none transition-all uppercase resize-none"
                      placeholder="OBSERVAÇÕES GERAIS..."
                    />
                 </div>

                 <div className="mt-10 flex justify-end gap-4">
                    <button 
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="px-8 py-4 bg-white border border-slate-200 text-slate-500 font-black rounded-2xl uppercase text-[10px] tracking-widest hover:bg-slate-50 hover:text-slate-700 transition-all italic"
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit"
                      disabled={isProcessing}
                      className="px-12 py-4 bg-blue-600 text-white font-black rounded-2xl uppercase text-[10px] tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all italic disabled:opacity-50"
                    >
                      {isProcessing ? 'SALVANDO...' : 'SALVAR FICHA'}
                    </button>
                 </div>
              </form>
           </div>
        </div>
      )}
    </div>
  );
};

export default HREmployees;
