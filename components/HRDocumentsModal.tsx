
import React, { useState, useEffect, useMemo } from 'react';
import { HRService } from '../services/hrService';
import { Employee, HRDocument } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';

interface HRDocumentsModalProps {
  employee: Employee;
  onClose: () => void;
}

// Mapeamento de nomes amigáveis para os tipos de documentos
const DOC_LABELS: Record<string, string> = {
  // CLT
  CTPS: 'Carteira de Trabalho (Digital ou Física)',
  RG_CPF: 'Documento de Identidade (RG/CPF/CNH)',
  COMP_RESIDENCIA: 'Comprovante de Residência Atualizado',
  ASO: 'Atestado de Saúde Ocupacional (ASO)',
  TITULO_ELEITOR: 'Título de Eleitor',
  CERTIDAO_NASC_CASAMENTO: 'Certidão de Nasc. ou Casamento',
  
  // PJ
  CONTRATO_SOCIAL_MEI: 'Contrato Social ou CCMEI',
  CARTAO_CNPJ: 'Cartão CNPJ',
  RG_SOCIOS: 'RG/CPF dos Sócios',
  CONTRATO_PRESTACAO: 'Contrato de Prestação de Serviços'
};

const REQUIRED_CLT = ['CTPS', 'RG_CPF', 'COMP_RESIDENCIA', 'ASO', 'TITULO_ELEITOR', 'CERTIDAO_NASC_CASAMENTO'];
const REQUIRED_PJ = ['CONTRATO_SOCIAL_MEI', 'CARTAO_CNPJ', 'RG_SOCIOS', 'CONTRATO_PRESTACAO'];

const HRDocumentsModal: React.FC<HRDocumentsModalProps> = ({ employee, onClose }) => {
  const [documents, setDocuments] = useState<HRDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null); // Rastreia qual doc está sendo enviado
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);

  // Define a lista de documentos baseada no tipo de contrato
  const requiredDocs = useMemo(() => {
    return employee.contractType === 'PJ' ? REQUIRED_PJ : REQUIRED_CLT;
  }, [employee.contractType]);

  const fetchDocuments = async () => {
    if (!employee.id) return;
    setLoading(true);
    const docs = await HRService.getDocuments(employee.id);
    setDocuments(docs);
    setLoading(false);
  };

  useEffect(() => {
    fetchDocuments();
  }, [employee.id]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, docType: string) => {
    const file = e.target.files?.[0];
    if (!file || !employee.id) return;

    setUploadingDocType(docType);
    
    try {
      const res = await HRService.uploadDocument(employee.id, file, docType);
      if (res.success) {
        setToast({ msg: 'Documento enviado com sucesso!', type: 'success' });
        await fetchDocuments();
      } else {
        setToast({ msg: res.message || 'Erro ao enviar documento.', type: 'error' });
      }
    } catch (error) {
      setToast({ msg: 'Erro de conexão.', type: 'error' });
    } finally {
      setUploadingDocType(null);
    }
  };

  const handleDelete = async (doc: HRDocument) => {
    if (!window.confirm(`Deseja excluir o arquivo "${doc.fileName}"?`)) return;

    // Loading estado local "falso" para feedback imediato (opcional, aqui usaremos o refresh)
    try {
      const res = await HRService.deleteDocument(doc.id, doc.fileUrl);
      if (res.success) {
        setToast({ msg: 'Documento removido.', type: 'success' });
        await fetchDocuments();
      } else {
        setToast({ msg: res.message || 'Erro ao excluir.', type: 'error' });
      }
    } catch (error) {
      setToast({ msg: 'Erro de conexão.', type: 'error' });
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in duration-300">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-10 py-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter">
              Documentação Digital
            </h3>
            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-1">
              {employee.fullName} • Contrato: {employee.contractType}
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all shadow-sm"
          >
            <ICONS.Add className="w-6 h-6 rotate-45" />
          </button>
        </div>

        {/* Lista de Documentos */}
        <div className="flex-1 overflow-y-auto p-10 custom-scrollbar bg-slate-50/30">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 opacity-50">
              <div className="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em]">Buscando arquivos...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {requiredDocs.map((docType) => {
                const existingDoc = documents.find(d => d.documentType === docType);
                const isUploading = uploadingDocType === docType;

                return (
                  <div 
                    key={docType}
                    className={`relative flex items-center justify-between p-6 rounded-3xl border transition-all ${
                      existingDoc 
                        ? 'bg-white border-l-4 border-l-emerald-500 border-y-slate-200 border-r-slate-200 shadow-sm' 
                        : 'bg-white border-l-4 border-l-amber-500 border-y-red-50 border-r-red-50 shadow-sm border-dashed'
                    }`}
                  >
                    {/* Informações do Documento */}
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                        existingDoc ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-500'
                      }`}>
                        {existingDoc ? (
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                        ) : (
                          <ICONS.Alert className="w-6 h-6" />
                        )}
                      </div>
                      <div>
                        <h4 className="font-black text-slate-800 uppercase text-xs tracking-wide">
                          {DOC_LABELS[docType] || docType}
                        </h4>
                        {existingDoc ? (
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-emerald-600 uppercase mt-0.5 truncate max-w-[200px]">
                              {existingDoc.fileName}
                            </span>
                            <span className="text-[8px] text-slate-400 font-medium">
                              Enviado em: {new Date(existingDoc.uploadedAt).toLocaleDateString('pt-BR')}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[9px] font-black text-amber-600 uppercase mt-1 inline-block bg-amber-50 px-2 py-0.5 rounded">
                            Pendente de Envio
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-3">
                      {isUploading ? (
                        <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 rounded-xl">
                          <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                          <span className="text-[9px] font-black text-slate-500 uppercase">Enviando...</span>
                        </div>
                      ) : existingDoc ? (
                        <>
                          <a 
                            href={existingDoc.fileUrl} 
                            target="_blank" 
                            rel="noreferrer"
                            className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-[9px] font-black uppercase hover:bg-slate-200 transition-colors flex items-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            Visualizar
                          </a>
                          <button 
                            onClick={() => handleDelete(existingDoc)}
                            className="p-2 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 transition-colors"
                            title="Excluir Arquivo"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </>
                      ) : (
                        <div className="relative">
                          <input 
                            type="file" 
                            id={`file-${docType}`}
                            className="hidden" 
                            onChange={(e) => handleUpload(e, docType)}
                            accept=".pdf,.jpg,.jpeg,.png"
                          />
                          <label 
                            htmlFor={`file-${docType}`}
                            className="cursor-pointer px-6 py-3 bg-slate-900 text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg hover:bg-blue-600 transition-all flex items-center gap-2"
                          >
                            <ICONS.Upload className="w-3.5 h-3.5" />
                            Enviar
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="p-6 bg-slate-50 border-t border-slate-100 text-center">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
            Formatos aceitos: PDF, JPG, PNG (Max 5MB)
          </p>
        </div>
      </div>
    </div>
  );
};

export default HRDocumentsModal;
