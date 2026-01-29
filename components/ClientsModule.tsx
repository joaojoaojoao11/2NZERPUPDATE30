import React, { useState, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { supabaseClient as supabase } from '../services/core';
import { Client, User } from '../types';

const ClientsModule: React.FC<{ user: User }> = ({ user }) => {
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);

    const ITEMS_PER_PAGE = 50;

    const fetchClients = async (reset = false) => {
        setLoading(true);
        try {
            const currentPage = reset ? 0 : page;
            const data = await DataService.getClients(ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE, searchTerm);

            if (reset) {
                setClients(data);
                setPage(1);
            } else {
                setClients(prev => [...prev, ...data]);
                setPage(prev => prev + 1);
            }

            if (data.length < ITEMS_PER_PAGE) setHasMore(false);
            else setHasMore(true);

        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Debounce search
        const timer = setTimeout(() => {
            setPage(0);
            setHasMore(true);
            fetchClients(true);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const handleSync = async () => {
        setIsSyncing(true);
        try {
            const { data, error } = await supabase.functions.invoke('clients-integration');
            if (error) throw error;
            alert(`Sincronização concluída! ${data.upserted_count || 0} clientes atualizados.`);
            fetchClients(true);
        } catch (err: any) {
            alert(`Erro na sincronização: ${err.message}`);
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Cadastros de Clientes</h2>
                    <p className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.4em] mt-2 italic">
                        Base Centralizada CRM
                    </p>
                </div>

                <div className="flex gap-3 items-center">
                    <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center w-full md:w-96 transition-all focus-within:ring-2 focus-within:ring-indigo-100 focus-within:border-indigo-400">
                        <svg className="w-5 h-5 text-slate-400 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        <input
                            type="text"
                            placeholder="Buscar Cliente, CPF/CNPJ..."
                            className="w-full px-4 py-2 bg-transparent outline-none font-bold text-xs uppercase text-slate-700 placeholder:text-slate-300"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {searchTerm.length > 2 && (
                        <button
                            onClick={async () => {
                                // const confirm = window.confirm(`Deseja buscar '${searchTerm}' no Tiny ERP?`);
                                // if(!confirm) return;

                                setIsSyncing(true);
                                try {
                                    const { TinyService } = await import('../services/tinyService');
                                    const results = await TinyService.searchFullClients(searchTerm);

                                    if (results.length > 0) {
                                        const { count } = await DataService.upsertClients(results);
                                        if (count > 0) {
                                            alert(`${count} cliente(s) importado(s) do Tiny!`);
                                            fetchClients(true);
                                        } else {
                                            alert('Cliente encontrado no Tiny mas já atualizado no sistema.');
                                        }
                                    } else {
                                        alert('Nenhum cliente encontrado no Tiny com este nome.');
                                    }
                                } catch (e) { console.error(e); alert('Erro ao buscar no Tiny.'); }
                                finally { setIsSyncing(false); }
                            }}
                            disabled={isSyncing}
                            className="px-4 py-3 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-2xl font-black text-[10px] uppercase hover:bg-indigo-100 transition-colors whitespace-nowrap shadow-sm h-full"
                            title="Buscar e importar do Tiny"
                        >
                            {isSyncing ? '...' : 'Buscar no Tiny'}
                        </button>
                    )}

                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className="bg-indigo-600 text-white p-4 rounded-2xl shadow-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95"
                        title="Sincronizar com Tiny"
                    >
                        {isSyncing ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        )}
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden min-h-[60vh]">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-slate-100">
                            <tr>
                                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider">Nome / Razão Social</th>
                                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider">CPF / CNPJ</th>
                                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider">Contato</th>
                                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider">Localização</th>
                                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Situação</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {clients.map(client => (
                                <tr key={client.id} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-xs text-slate-900 uppercase">{client.nome}</div>
                                        {client.fantasia && <div className="text-[10px] text-slate-400 font-medium uppercase mt-0.5">{client.fantasia}</div>}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="font-mono text-[10px] font-bold text-slate-600 bg-slate-100 inline-block px-2 py-1 rounded-md border border-slate-200">
                                            {client.cpf_cnpj || '-'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-1">
                                            {client.email && (
                                                <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                                    {client.email}
                                                </div>
                                            )}
                                            {client.telefone && (
                                                <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                                                    {client.telefone}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-[10px] font-bold text-slate-600 uppercase">
                                            {client.cidade} <span className="text-slate-400 font-normal">/</span> {client.estado}
                                        </div>
                                        <div className="text-[9px] text-slate-400 mt-0.5 truncate max-w-[200px]" title={client.endereco}>
                                            {client.endereco}, {client.bairro}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${client.situacao === 'I' || client.situacao === 'Inativo'
                                            ? 'bg-red-50 text-red-600 border border-red-100'
                                            : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                            }`}>
                                            {client.situacao === 'I' ? 'Inativo' : 'Ativo'}
                                        </span>
                                    </td>
                                </tr>
                            ))}

                            {clients.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-20 text-center text-slate-400 text-xs uppercase font-bold tracking-widest italic opacity-50">
                                        Nenhum cliente encontrado
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {hasMore && (
                    <div className="p-4 border-t border-slate-100 flex justify-center bg-slate-50">
                        <button
                            onClick={() => fetchClients()}
                            disabled={loading}
                            className="text-xs font-black uppercase text-slate-500 hover:text-indigo-600 transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Carregando...' : 'Carregar Mais'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ClientsModule;
