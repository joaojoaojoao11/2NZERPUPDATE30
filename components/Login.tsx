
import React, { useState, useEffect } from 'react';
import { DataService } from '../services/dataService';
import { User, CompanySettings } from '../types';

interface LoginProps {
  onLogin: (user: User) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState<CompanySettings | null>(null);

  useEffect(() => {
    DataService.getCompanySettings().then(setCompany);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const user = await DataService.login(email, password);
      if (user) onLogin(user);
      else {
        setError('CREDENCIAIS INVÁLIDAS.');
        setLoading(false);
      }
    } catch (err) {
      setError('FALHA NA CONEXÃO.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-12">
           <h1 className="text-6xl font-black text-white italic tracking-tighter mb-2 uppercase">NZERP</h1>
           <p className="text-[10px] font-black text-blue-400 uppercase tracking-[0.5em] italic">Gestão de Rotinas v1.0</p>
        </div>

        <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 border border-white/10">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4 italic">Credencial Corporativa</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl outline-none font-bold text-sm transition-all" placeholder="exemplo@nzstok.com" />
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4 italic">Senha de Acesso</label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-600 rounded-2xl outline-none font-bold text-sm transition-all" placeholder="••••••••" />
            </div>

            {error && <div className="text-red-500 text-[10px] font-black text-center uppercase tracking-widest italic">{error}</div>}

            <button type="submit" disabled={loading} className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-blue-600 transition-all italic">
              {loading ? 'AUTENTICANDO...' : 'ACESSAR ROTINAS'}
            </button>
          </form>
          <div className="mt-10 text-center opacity-30">
            <p className="text-[8px] font-bold text-slate-900 uppercase tracking-widest leading-relaxed">© 2025 NZ LOGISTICS ENTERPRISE</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
