import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabaseClient } from '../services/core';
import { ICONS } from '../constants';

interface ImportModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

const COLUMNS_MAP = {
    "ID": "ID",
    "IDCliente": "IDCliente",
    "Data Emissão": "Data Emissão",
    "Data Vencimento": "Data Vencimento",
    "Data Liquidação": "Data Liquidação",
    "Valor documento": "Valor documento",
    "Saldo": "Saldo",
    "Situação": "Situação",
    "Número documento": "Número documento",
    "Número no banco": "Número no banco",
    "Categoria": "Categoria",
    "Histórico": "Histórico",
    "Forma de recebimento": "Forma de recebimento",
    "Meio de recebimento": "Meio de recebimento",
    "Taxas": "Taxas",
    "Competência": "Competência",
    "Recebimento": "Recebimento",
    "Recebido": "Recebido"
};

const AccountsReceivableImportModal: React.FC<ImportModalProps> = ({ onClose, onSuccess }) => {
    const [step, setStep] = useState<'UPLOAD' | 'REVIEW' | 'SAVING'>('UPLOAD');
    const [file, setFile] = useState<File | null>(null);
    const [stats, setStats] = useState({ new: 0, updated: 0, unchanged: 0 });
    const [previewData, setPreviewData] = useState<{ newRows: any[], updatedRows: any[] }>({ newRows: [], updatedRows: [] });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDownloadTemplate = () => {
        const headers = Object.keys(COLUMNS_MAP);
        const ws = XLSX.utils.aoa_to_sheet([headers]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Modelo Importacao");
        XLSX.writeFile(wb, "Modelo_Contas_Receber.xlsx");
    };

    const processFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;
        setFile(selectedFile);

        const reader = new FileReader();
        reader.onload = async (evt) => {
            const bstr = evt.target?.result;
            const wb = XLSX.read(bstr, { type: 'binary' });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = XLSX.utils.sheet_to_json(ws);

            await analyzeData(data);
        };
        reader.readAsBinaryString(selectedFile);
    };

    // --- Helpers de Sanitização ---
    const excelDateToISO = (serialOrStr: any) => {
        if (!serialOrStr) return null;
        // Se for número (Serial Date do Excel)
        if (typeof serialOrStr === 'number') {
            const utc_days = Math.floor(serialOrStr - 25569);
            const utc_value = utc_days * 86400;
            const date_info = new Date(utc_value * 1000);
            return date_info.toISOString().split('T')[0];
        }
        // Se for string "dd/mm/yyyy"
        if (typeof serialOrStr === 'string' && serialOrStr.includes('/')) {
            const parts = serialOrStr.split('/');
            if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD
        }
        return String(serialOrStr);
    };

    const parseCurrency = (val: any) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        if (typeof val === 'string') {
            let clean = val.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
            return parseFloat(clean) || 0;
        }
        return 0;
    };
    // ------------------------------

    const analyzeData = async (importedRows: any[]) => {
        const importedIds = importedRows.map(r => String(r["ID"])).filter(id => id);

        const { data: existingData, error } = await supabaseClient
            .from('accounts_receivable')
            .select('*')
            .in('ID', importedIds);

        if (error) {
            alert("Erro ao verificar dados existentes: " + error.message);
            return;
        }

        const existingMap = new Map((existingData || []).map(d => [String(d.ID), d]));
        const newRows: any[] = [];
        const updatedRows: any[] = [];
        let unchangedCount = 0;

        importedRows.forEach((rawRow: any) => {
            // --- HIGIENIZAÇÃO DA LINHA ---
            const row: any = { ...rawRow };

            // Datas
            ['Data Emissão', 'Data Vencimento', 'Data Liquidação', 'Recebimento'].forEach(field => {
                if (row[field]) row[field] = excelDateToISO(row[field]);
            });

            // Valores Numéricos
            ['Valor documento', 'Saldo', 'Taxas', 'Recebido'].forEach(field => {
                row[field] = parseCurrency(row[field]);
            });

            // Mapeamento Explícito de CLIENTE (Caso venha como "Cliente" na planilha)
            if (row["Cliente"] && !row["IDCliente"]) {
                row["IDCliente"] = row["Cliente"];
            }
            // -----------------------------

            const id = String(row["ID"]);
            if (!id) return;

            const existing = existingMap.get(id);

            if (!existing) {
                newRows.push(row);
            } else {
                let hasChanges = false;
                const diffs: any = { _id: id };

                Object.keys(COLUMNS_MAP).forEach(key => {
                    if (key === 'ID') return;

                    let valImport = row[key];
                    let valExist = existing[key];

                    // --- PROTEÇÃO DE DADOS ---
                    // Se o campo for Data Liquidação e o novo valor estiver vazio, mas já existir data no banco, IGNORA a atualização
                    if (key === 'Data Liquidação' && !valImport && valExist) {
                        return;
                    }
                    // -------------------------

                    const strImport = (valImport === undefined || valImport === null) ? "" : String(valImport);
                    const strExist = (valExist === undefined || valExist === null) ? "" : String(valExist);

                    if (strImport !== strExist) {
                        hasChanges = true;
                        diffs[key] = { old: valExist, new: valImport };
                    }
                });

                if (hasChanges) {
                    updatedRows.push({ ...row, _diffs: diffs });
                } else {
                    unchangedCount++;
                }
            }
        });

        setPreviewData({ newRows, updatedRows });
        setStats({ new: newRows.length, updated: updatedRows.length, unchanged: unchangedCount });
        setStep('REVIEW');
    };

    const handleSave = async () => {
        setStep('SAVING');
        try {
            const rawPayload = [...previewData.newRows, ...previewData.updatedRows.map(r => {
                const { _diffs, ...rest } = r;
                return rest;
            })];

            // Filter columns to match strict schema
            const validColumns = Object.values(COLUMNS_MAP);
            const allPayload = rawPayload.map(r => {
                const clean: any = {};
                validColumns.forEach(col => {
                    // Check if r has property to allow falsy values (0, empty string)
                    if (Object.prototype.hasOwnProperty.call(r, col)) {
                        clean[col] = r[col];
                    }
                });
                return clean;
            });

            if (allPayload.length === 0) {
                onSuccess();
                return;
            }

            const BATCH_SIZE = 100;
            for (let i = 0; i < allPayload.length; i += BATCH_SIZE) {
                const batch = allPayload.slice(i, i + BATCH_SIZE);
                const { error } = await supabaseClient
                    .from('accounts_receivable')
                    .upsert(batch);

                if (error) {
                    console.error("Erro Supabase:", error);
                    throw new Error(error.message || "Falha ao salvar lote.");
                }
            }

            onSuccess();
        } catch (err: any) {
            alert(`ERRO AO IMPORTAR: ${err.message}. Verifique se os dados estão corretos (Datas, Números).`);
            setStep('REVIEW');
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">

                {/* HEADER */}
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h2 className="text-2xl font-black text-slate-800 uppercase italic tracking-tighter">Importar Contas a Receber</h2>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
                            {step === 'UPLOAD' && 'Carregamento de Dados'}
                            {step === 'REVIEW' && 'Conferência e Validação'}
                            {step === 'SAVING' && 'Processando...'}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-all"><ICONS.Close className="w-6 h-6 text-slate-400" /></button>
                </div>

                {/* CONTENT */}
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">

                    {step === 'UPLOAD' && (
                        <div className="flex flex-col md:flex-row gap-8">
                            <div className="flex-1 space-y-6">
                                <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100">
                                    <h3 className="text-blue-700 font-black uppercase text-sm tracking-widest mb-4 flex items-center gap-2">
                                        <ICONS.Document className="w-4 h-4" /> Boas Práticas
                                    </h3>
                                    <ul className="space-y-3 text-xs font-medium text-slate-600">
                                        <li className="flex items-start gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5" /> Mantenha o ID único e não o altere se quiser atualizar um registro existente.</li>
                                        <li className="flex items-start gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5" /> Datas devem estar no formato DD/MM/AAAA ou YYYY-MM-DD. O Excel geralmente trata datas automaticamente.</li>
                                        <li className="flex items-start gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5" /> Em colunas de Valor (R$), use apenas números e vírgula/ponto (sem símbolo de moeda).</li>
                                        <li className="flex items-start gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5" /> Não altere o cabeçalho da Planilha Modelo.</li>
                                    </ul>
                                </div>

                                <button
                                    onClick={handleDownloadTemplate}
                                    className="w-full py-4 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center gap-2 hover:border-blue-500 hover:bg-blue-50 transition-all group"
                                >
                                    <ICONS.Download className="w-6 h-6 text-slate-400 group-hover:text-blue-500" />
                                    <span className="text-xs font-black uppercase text-slate-400 group-hover:text-blue-600">Baixar Planilha Modelo</span>
                                </button>
                            </div>

                            <div className="flex-[1.5] border-l border-slate-100 pl-8 flex flex-col justify-center items-center">
                                <input
                                    type="file"
                                    accept=".xlsx, .xls, .csv"
                                    ref={fileInputRef}
                                    onChange={processFile}
                                    className="hidden"
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full max-w-sm aspect-video bg-slate-900 rounded-[2rem] flex flex-col items-center justify-center gap-4 text-white hover:scale-105 transition-all shadow-2xl shadow-slate-200"
                                >
                                    <ICONS.Upload className="w-12 h-12" />
                                    <div className="text-center">
                                        <p className="font-black uppercase text-lg italic tracking-tighter">Carregar Arquivo</p>
                                        <p className="text-[10px] uppercase tracking-widest opacity-60 mt-1">.XLSX ou .CSV</p>
                                    </div>
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 'REVIEW' && (
                        <div className="space-y-8">
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 text-center">
                                    <p className="text-[9px] font-black uppercase text-emerald-400 tracking-widest">Novos Registros</p>
                                    <p className="text-2xl font-black text-emerald-600">{stats.new}</p>
                                </div>
                                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 text-center">
                                    <p className="text-[9px] font-black uppercase text-amber-400 tracking-widest">Atualizados</p>
                                    <p className="text-2xl font-black text-amber-600">{stats.updated}</p>
                                </div>
                                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center opacity-60">
                                    <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Sem Alteração</p>
                                    <p className="text-2xl font-black text-slate-600">{stats.unchanged}</p>
                                </div>
                            </div>

                            {stats.new > 0 && (
                                <div className="space-y-3">
                                    <h4 className="text-xs font-black uppercase text-emerald-600 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500" /> Novos Itens para Inserir</h4>
                                    <div className="max-h-[200px] overflow-y-auto overflow-x-auto bg-slate-50 rounded-xl border border-slate-200 p-2">
                                        <table className="w-full text-left border-collapse">
                                            <thead className="text-[8px] font-black uppercase text-slate-400 sticky top-0 bg-slate-50 z-40 shadow-sm">
                                                <tr>
                                                    {Object.values(COLUMNS_MAP).map(col => (
                                                        <th
                                                            key={col}
                                                            className={`p-2 whitespace-nowrap border-b border-slate-200 min-w-[100px] bg-slate-50 ${col === 'ID' ? 'sticky left-0 z-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]' : ''}`}
                                                        >
                                                            {col}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody className="text-[9px] font-medium text-slate-600">
                                                {previewData.newRows.map((r, i) => (
                                                    <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-white transition-colors relative">
                                                        {Object.values(COLUMNS_MAP).map(col => (
                                                            <td
                                                                key={col}
                                                                className={`p-2 whitespace-nowrap border-r border-slate-50 last:border-0 ${col === 'ID' ? 'bg-emerald-100 text-emerald-700 font-bold sticky left-0 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]' : ''}`}
                                                            >
                                                                {r[col] !== undefined && r[col] !== null ? String(r[col]) : '-'}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {stats.updated > 0 && (
                                <div className="space-y-3">
                                    <h4 className="text-xs font-black uppercase text-amber-600 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-amber-500" /> Itens Modificados</h4>
                                    <div className="max-h-[300px] overflow-y-auto bg-slate-50 rounded-xl border border-slate-200 p-2">
                                        {previewData.updatedRows.map((r) => (
                                            <div key={r.ID} className="mb-2 bg-white p-3 rounded-lg border border-slate-100 shadow-sm text-[10px]">
                                                <div className="flex justify-between items-center mb-2 border-b border-slate-50 pb-1">
                                                    <span className="font-black text-slate-700">ID: {r.ID}</span>
                                                    <span className="text-amber-500 font-bold uppercase text-[8px]">Alterado</span>
                                                </div>
                                                <div className="grid grid-cols-1 gap-1">
                                                    {Object.keys(r._diffs).map(k => {
                                                        if (k === '_id' || typeof r._diffs[k] !== 'object') return null;
                                                        return (
                                                            <div key={k} className="flex items-center gap-2">
                                                                <span className="font-bold text-slate-400 w-24 text-right truncate">{k}:</span>
                                                                <span className="line-through text-red-300 bg-red-50 px-1 rounded">{String(r._diffs[k].old || "Vazio")}</span>
                                                                <span className="text-slate-300">➜</span>
                                                                <span className="bg-emerald-50 text-emerald-600 px-1 rounded font-bold">{String(r._diffs[k].new)}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                        </div>
                    )}
                </div>

                {/* FOOTER */}
                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-4">
                    {step === 'REVIEW' && (
                        <>
                            <button onClick={() => { setStep('UPLOAD'); setFile(null); }} className="px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-200 transition-all text-xs uppercase">Cancelar</button>
                            <button onClick={handleSave} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-black text-xs uppercase hover:bg-emerald-600 transition-all shadow-lg">
                                Confirmar e Atualizar Base
                            </button>
                        </>
                    )}
                    {step === 'UPLOAD' && (
                        <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-200 transition-all text-xs uppercase">Fechar</button>
                    )}
                </div>

            </div>
        </div>
    );
};

export default AccountsReceivableImportModal;
