
import React, { useState, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { CompanySettings, User, ViewType } from '../types';
import { ICONS } from '../constants';
import Toast from './Toast';

interface SettingsProps {
  admin: User;
  onUpdate: (settings: CompanySettings) => void;
  onNavigate: (view: ViewType) => void;
}

const Settings: React.FC<SettingsProps> = ({ admin, onUpdate, onNavigate }) => {
  const [settings, setSettings] = useState<CompanySettings>({ name: '', cnpj: '', address: '', logoUrl: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
  
  // Estado para mostrar script SQL
  const [showSql, setShowSql] = useState(false);

  useEffect(() => {
    DataService.getCompanySettings().then(data => {
      setSettings(data);
      setLoading(false);
    });
  }, []);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSettings(prev => ({ ...prev, logoUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await DataService.saveCompanySettings(settings);
      if (result.success) {
        onUpdate(settings);
        setToast({ msg: 'Configurações atualizadas com sucesso!', type: 'success' });
      } else {
        const errorMsg = result.message || 'Erro ao salvar configurações no banco de dados.';
        setToast({ msg: `FALHA: ${errorMsg}`, type: 'error' });
      }
    } catch (err: any) {
      setToast({ msg: `ERRO CRÍTICO: ${err.message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const copySqlToClipboard = () => {
    const sql = `
-- Script de Correção de Schema NZERP v1.2
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS price_rolo_min NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS price_rolo_ideal NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS price_frac_min NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS price_frac_ideal NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS cost_tax_percent NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS cost_extra_value NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS custo_unitario_frac NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS custo_unitario_rolo NUMERIC DEFAULT 0;

-- Sincronização de dados iniciais
UPDATE master_catalog 
SET 
  custo_unitario_frac = custo_unitario,
  custo_unitario_rolo = custo_unitario
WHERE (custo_unitario_frac = 0 OR custo_unitario_frac IS NULL) 
  AND custo_unitario > 0;

-- Correção de níveis hierárquicos (Users Role Constraint)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('DIRETORIA', 'ADM', 'ESTOQUISTA', 'VENDEDOR'));
    `.trim();
    navigator.clipboard.writeText(sql);
    setToast({ msg: 'Script SQL copiado!', type: 'success' });
  };

  const hasUserManagementAccess = admin.role === 'DIRETORIA' || admin.permissions?.includes('GESTAO_USUARIOS');

  if (loading) return <div className="py-24 text-center text-slate-500 font-black uppercase text-xs animate-pulse">Carregando Configurações...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="flex items-center space-x-5 mb-10">
        <div className="p-4 bg-slate-900 rounded-3xl text-white shadow-xl">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" strokeWidth="2"/>
            <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeWidth="2"/>
          </svg>
        </div>
        <div>
          <h2 className="text-4xl font-black text-slate-900 italic tracking-tighter uppercase leading-none">Ajustes Avançados</h2>
          <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.5em] mt-3 italic">Gestão Institucional & Branding</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-slate-200">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-8 border-b border-slate-50 pb-4 italic">Dados da Empresa</h3>
            <div className="space-y-6">
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4 italic">Nome Fantasia *</label>
                <input required value={settings.name} onChange={e => setSettings({...settings, name: e.target.value.toUpperCase()})} className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl outline-none font-black text-sm transition-all" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4 italic">CNPJ</label>
                    <input value={settings.cnpj} onChange={e => setSettings({...settings, cnpj: e.target.value})} className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl outline-none font-black text-sm transition-all" placeholder="00.000.000/0000-00" />
                 </div>
                 <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4 italic">Logradouro / Endereço</label>
                    <input value={settings.address} onChange={e => setSettings({...settings, address: e.target.value.toUpperCase()})} className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl outline-none font-black text-sm transition-all" />
                 </div>
              </div>
            </div>
          </div>
          
          {hasUserManagementAccess && (
            <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-slate-200">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-8 border-b border-slate-50 pb-4 italic">Administração de Usuários</h3>
              <p className="text-xs text-slate-500 leading-relaxed font-medium mb-6">Controle central de acessos, alçadas e credenciais do sistema NZERP.</p>
              <button 
                type="button"
                onClick={() => onNavigate('GESTAO_USUARIOS')}
                className="px-10 py-5 bg-blue-600 text-white rounded-[2rem] font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all flex items-center space-x-3 italic"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 20h-4v-2c0-2.209-1.791-4-4-4s-4 1.791-4 4v2H3c-1.104 0-2 .896-2 2v2c0 1.104.896 2 2 2h18c1.104 0 2-.896 2-2v-2c0-1.104-.896-2-2-2zM12 8c0-2.209 1.791-4 4-4s4 1.791 4 4-1.791 4-4 4-4-1.791-4-4zM6 8c0-2.209 1.791-4 4-4s4 1.791 4 4-1.791-4-4 4 4-4-1.791-4-4z" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span>Gerenciar Usuários</span>
              </button>
            </div>
          )}

          {hasUserManagementAccess && (
            <div className="bg-slate-900 p-10 rounded-[3rem] shadow-2xl border border-slate-800 text-white">
                <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                    <h3 className="text-sm font-black uppercase tracking-widest italic text-amber-400">Manutenção de Banco de Dados</h3>
                    <button 
                        type="button"
                        onClick={() => setShowSql(!showSql)}
                        className="text-[9px] font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                    >
                        {showSql ? 'Ocultar Script' : 'Ver Script de Correção'}
                    </button>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed font-medium mb-6">
                    Execute este script SQL no painel do Supabase (SQL Editor) para garantir total compatibilidade com custos diferenciados e novas métricas.
                </p>
                
                {showSql && (
                    <div className="bg-black/30 rounded-2xl p-4 border border-white/10 relative group">
                        <pre className="text-[10px] font-mono text-emerald-400 whitespace-pre-wrap break-all">
{`-- Script de Correção de Schema NZERP v1.2
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS price_rolo_min NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS price_rolo_ideal NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS price_frac_min NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS price_frac_ideal NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS cost_tax_percent NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS cost_extra_value NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS custo_unitario_frac NUMERIC DEFAULT 0;
ALTER TABLE master_catalog ADD COLUMN IF NOT EXISTS custo_unitario_rolo NUMERIC DEFAULT 0;

-- Sincronização de dados iniciais
UPDATE master_catalog 
SET 
  custo_unitario_frac = custo_unitario,
  custo_unitario_rolo = custo_unitario
WHERE (custo_unitario_frac = 0 OR custo_unitario_frac IS NULL) 
  AND custo_unitario > 0;`}
                        </pre>
                        <button 
                            type="button"
                            onClick={copySqlToClipboard}
                            className="absolute top-2 right-2 bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            title="Copiar SQL"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                        </button>
                    </div>
                )}
            </div>
          )}

          <div className="flex justify-end pt-4">
             <button type="submit" disabled={saving} className="px-12 py-5 bg-blue-600 text-white rounded-[2rem] font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-900/40 hover:bg-blue-700 transition-all flex items-center space-x-3 italic">
                {saving ? 'SALVANDO...' : 'ATUALIZAR CONFIGURAÇÕES'}
             </button>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-slate-200 text-center">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-8 italic">Logo Oficial</h3>
            <div className="w-48 h-48 bg-slate-50 rounded-[2.5rem] mx-auto mb-8 flex items-center justify-center border-2 border-dashed border-slate-200 overflow-hidden group relative">
               {settings.logoUrl ? (
                 <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-contain p-4 transition-transform group-hover:scale-110" />
               ) : (
                 <ICONS.Inventory className="w-12 h-12 text-slate-200" />
               )}
               <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <label htmlFor="logo-upload" className="cursor-pointer text-white font-black text-[10px] uppercase tracking-widest">ALTERAR LOGO</label>
               </div>
               <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" id="logo-upload" />
            </div>
            <label htmlFor="logo-upload" className="cursor-pointer inline-flex px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-600 transition-all shadow-lg italic">Fazer Upload</label>
            <p className="text-[8px] text-slate-400 font-bold uppercase mt-6 tracking-widest leading-relaxed">Formatos: PNG, JPG ou SVG<br/>Recomendado: 512x512px</p>
          </div>
        </div>
      </form>
    </div>
  );
};

export default Settings;
