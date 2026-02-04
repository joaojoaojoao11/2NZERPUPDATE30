// Fix: Correctly import 'supabaseClient' as 'supabase' from './core'
import { supabaseClient as supabase } from './core';
import { User, CompanySettings, AppNotification } from '../types';

export class UserService {
  static async login(email: string, pass: string): Promise<User | null> {
    const { data, error } = await supabase.from('users').select('*').eq('email', email).eq('password', pass).eq('active', true).single();
    return (error || !data) ? null : data;
  }

  static async getUsers(): Promise<User[]> {
    const { data, error } = await supabase.from('users').select('*').order('name', { ascending: true });
    return error ? [] : data;
  }

  static async saveUser(user: User): Promise<{ success: boolean, message?: string }> {
    const payload = { ...user };
    if (!payload.id || payload.id === "undefined") delete payload.id;
    const { error } = await supabase.from('users').upsert(payload);
    return { success: !error, message: error?.message };
  }

  static async getNotifications(user: User): Promise<AppNotification[]> {
    const { data, error } = await supabase.from('notifications').select('*').eq('lida', false).order('timestamp', { ascending: false });
    return error ? [] : data.map(n => ({ ...n, clienteTarget: n.cliente_target || n.clienteTarget }));
  }

  static async getCompanySettings(): Promise<CompanySettings> {
    try {
      const { data, error } = await supabase.from('company_settings').select('*').single();
      if (error || !data) {
        console.warn("NZERP: Usando configurações padrão (tabela vazia ou erro).");
        return { name: 'NZ ERP', cnpj: '', address: '', logoUrl: '' };
      }
      return {
        name: data.name || '',
        cnpj: data.cnpj || '',
        address: data.address || '',
        logoUrl: data.logo_url || data.logoUrl || ''
      };
    } catch (e) {
      return { name: 'NZ ERP', cnpj: '', address: '', logoUrl: '' };
    }
  }

  static async saveCompanySettings(settings: CompanySettings): Promise<{ success: boolean; message?: string }> {
    try {
      // Ajustado para snake_case conforme o schema real do Supabase
      const payload = {
        id: 1,
        name: settings.name,
        cnpj: settings.cnpj,
        address: settings.address,
        logo_url: settings.logoUrl
      };

      const { error } = await supabase
        .from('company_settings')
        .upsert(payload, { onConflict: 'id' });

      if (error) {
        const technicalMsg = `${error.message}${error.details ? ' | ' + error.details : ''}`;
        console.error("NZSTOK DB Error saving settings:", technicalMsg);
        return { success: false, message: error.message };
      }

      return { success: true };
    } catch (e: any) {
      const errorMsg = e.message || "Erro de conexão inesperado.";
      console.error("NZSTOK Critical failure saving settings:", errorMsg);
      return { success: false, message: errorMsg };
    }
  }
}