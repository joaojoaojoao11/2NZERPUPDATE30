import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { DataService } from '../services/dataService';
import { ICONS } from '../constants';
import { DebtorInfo, User } from '../types';
import Toast from './Toast';

interface DelinquencyModuleProps {
  currentUser: User;
}

const DelinquencyModule: React.FC<DelinquencyModuleProps> = ({ currentUser }) => {
  const [debtors, setDebtors] = useState<DebtorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  const [viewMode, setViewMode] = useState<'LIST' | 'ANALYTICS'>('ANALYTICS');
  
  // Filtros
  const [filterTerm, setFilterTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await DataService.getDebtorsSummary();
      setDebtors(data);
    } catch (error) {
      console.error(error);
      setToast({ msg: 'Erro ao carregar inadimplência', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // --- Estatísticas Gerais ---
  const stats = useMemo(() => {
    const totalVencido = debtors.reduce((acc, d) => acc + d.totalVencido, 0);
    const totalClientes = debtors.length;
    const criticos = debtors.filter(d => d.totalVencido > 5000).length; // Regra de negócio exemplo
    const cartorio = debtors.filter(d => d.enviadoCartorio).length;
    
    return { totalVencido, totalClientes, criticos, cartorio };
  }, [debtors]);

  // --- Dados para Gráficos ---
  const chartData = useMemo(() => {
    const sorted = [...debtors]
      .sort((a, b) => b.totalVencido - a.totalVencido)
      .slice(0, 10); // Top 10 Devedores

    return sorted.map(d => ({
      name: d.cliente.substring(0, 15) + '...', // Truncar nome
      valor: d.totalVencido,
      status: d.statusCobranca
    }));
  }, [debtors]);

  const pieData = useMemo(() => {
    const faixas = {
      'Até 1k': 0,
      '1k a 5k': 0,
      '5k a 10k': 0,
      '+10k': 0
    };

    debtors.forEach(d => {
      if (d.totalVencido <= 1000) faixas['Até 1k']++;
      else if (d.totalVencido <= 5000) faixas['1k a 5k']++;
      else if (d.totalVencido <= 10000) faixas['5k a 10k']++;
      else faixas['+10k']++;
    });

    return Object.entries(faixas).map(([name, value]) => ({ name, value }));
  }, [debtors]);

  const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444'];

  // --- Renderização ---
  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">
            Gestão de Inadimplência
          </h2>
          <p className="text-[10px] font-black text-red-500 uppercase tracking-[0.3em] mt-2 italic">
            Monitoramento de Risco e Recuperação
          </p>
        </div>
        <div className="flex bg-white p-1 rounded-xl border border-slate-200">
          <button 
            onClick={() => setViewMode('ANALYTICS')}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'ANALYTICS' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Dashboard
          </button>
          <button 
            onClick={() => setViewMode('LIST')}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'LIST' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Lista Detalhada
          </button>
        </div>
      </div>

      {/* Cards de KPI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden group">
          <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <ICONS.Finance className="w-24 h-24" />
          </div>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Vencido</p>
          <h3 className="text-2xl font-black text-slate-900 italic">
            R$ {stats.totalVencido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </h3>
        </div>

        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden group">
          <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <ICONS.Clients className="w-24 h-24" />
          </div>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Clientes Devedores</p>
          <h3 className="text-2xl font-black text-slate-900 italic">
            {stats.totalClientes}
          </h3>
        </div>

        <div className="bg-red-50 p-6 rounded-[2rem] border border-red-100 shadow-sm relative overflow-hidden group">
          <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <ICONS.Alert className="w-24 h-24 text-red-600" />
          </div>
          <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-1">Críticos (>5k)</p>
          <h3 className="text-2xl font-black text-red-600 italic">
            {stats.criticos}
          </h3>
        </div>

        <div className="bg-slate-900 p-6 rounded-[2rem] shadow-lg relative overflow-hidden group text-white">
          <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <ICONS.Legal className="w-24 h-24" />
          </div>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Em Cartório/Jurídico</p>
          <h3 className="text-2xl font-black italic">
            {stats.cartorio}
          </h3>
        </div>
      </div>

      {viewMode === 'ANALYTICS' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Gráfico de Barras - Top Devedores */}
          <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight mb-6 flex items-center gap-2">
              <ICONS.Chart className="w-4 h-4 text-slate-400" /> Top 10 Maiores Dívidas
            </h3>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 10, fill: '#64748b'}} />
                  <Tooltip 
                    cursor={{fill: '#f8fafc'}}
                    contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                  />
                  <Bar dataKey="valor" fill="#0f172a" radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gráfico de Pizza - Faixas de Dívida */}
          <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight mb-6 flex items-center gap-2">
              <ICONS.Filter className="w-4 h-4 text-slate-400" /> Distribuição por Valor
            </h3>
            <div className="h-[300px] w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : (
        /* Lista Detalhada */
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex gap-4 items-center bg-slate-50/50">
             <div className="flex-1 relative">
                <ICONS.Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Buscar cliente..." 
                  className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold uppercase outline-none focus:border-slate-400 transition-all"
                  value={filterTerm}
                  onChange={(e) => setFilterTerm(e.target.value)}
                />
             </div>
             <select 
               className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold uppercase outline-none"
               value={filterStatus}
               onChange={(e) => setFilterStatus(e.target.value)}
             >
               <option value="ALL">Todos Status</option>
               <option value="PENDENTE">Pendente</option>
               <option value="COBRANCA">Em Cobrança</option>
               <option value="CARTORIO">Cartório</option>
             </select>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-widest">
                <tr>
                  <th className="px-6 py-4 text-left">Cliente</th>
                  <th className="px-6 py-4 text-center">Títulos</th>
                  <th className="px-6 py-4 text-right">Total Vencido</th>
                  <th className="px-6 py-4 text-right">Vencido > 15d</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-center">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {debtors
                  .filter(d => d.cliente.toLowerCase().includes(filterTerm.toLowerCase()))
                  .filter(d => filterStatus === 'ALL' || d.statusCobranca === filterStatus)
                  .map((debtor, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <p className="font-bold text-slate-700 text-[10px] uppercase truncate max-w-[200px]">{debtor.cliente}</p>
                      {debtor.nextActionDate && (
                        <span className="text-[8px] text-blue-500 font-bold flex items-center gap-1 mt-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Próx. Ação: {new Date(debtor.nextActionDate).toLocaleDateString()}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center font-bold text-slate-600 text-xs">{debtor.qtdTitulos}</td>
                    <td className="px-6 py-4 text-right font-black text-slate-900 text-xs">
                      R$ {debtor.totalVencido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-red-500 text-xs">
                      R$ {debtor.vencidoMais15d.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2 py-1 rounded text-[8px] font-black uppercase border ${
                        debtor.statusCobranca === 'CARTORIO' ? 'bg-red-50 text-red-600 border-red-100' :
                        debtor.statusCobranca === 'COBRANCA' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                        'bg-slate-100 text-slate-500 border-slate-200'
                      }`}>
                        {debtor.statusCobranca}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                       <button className="text-slate-400 hover:text-blue-600 transition-colors">
                          <ICONS.Edit className="w-4 h-4" />
                       </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default DelinquencyModule;