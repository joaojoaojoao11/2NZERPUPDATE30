

import { supabaseClient as supabase } from './core';
import { Employee, HRDocument, PayrollRun, PayrollItem, LeaveRecord } from '../types';

export class HRService {
  private static formatSupabaseError(error: any): string {
    if (!error) return "Erro desconhecido";
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (typeof error === 'object') {
      const parts: string[] = [];
      const msg = error.message || error.msg;
      const details = error.details || error.detail;
      const code = error.code;
      if (msg) parts.push(msg);
      if (details) parts.push(`Detalhes: ${details}`);
      if (code) parts.push(`[Código: ${code}]`);
      if (parts.length > 0) return parts.join(' | ');
      return JSON.stringify(error);
    }
    return String(error);
  }

  static async getEmployees(): Promise<Employee[]> {
    try {
      if (!supabase) throw new Error("Cliente Supabase não inicializado.");
      
      const { data, error } = await supabase
        .from('hr_employees')
        .select('*')
        .order('full_name', { ascending: true });

      if (error) throw error;

      return (data || []).map(e => ({
        id: e.id,
        fullName: e.full_name,
        cpf: e.cpf,
        jobTitle: e.job_title,
        department: e.department,
        hireDate: e.hire_date,
        salaryAmount: Number(e.salary_amount),
        contractType: e.contract_type,
        status: e.status,
        email: e.email,
        phone: e.phone,
        pixKey: e.pix_key,
        notes: e.notes || '',
        // Se a coluna não existir, retorna undefined que vira 0
        transportDailyValue: Number(e.transport_daily_value || 0)
      }));
    } catch (e: any) {
      const msg = this.formatSupabaseError(e);
      console.error("Erro ao buscar funcionários:", msg);
      return [];
    }
  }

  static async saveEmployee(employee: Employee): Promise<{ success: boolean; message?: string }> {
    // Tratamento de segurança para o valor numérico
    const transportVal = Number(employee.transportDailyValue);
    const safeTransportVal = isNaN(transportVal) ? 0 : transportVal;

    // Mapeamento para snake_case do banco de dados
    const payload: any = {
      id: employee.id, // Se undefined, o banco gera novo UUID (upsert)
      full_name: employee.fullName.toUpperCase(),
      cpf: employee.cpf.replace(/\D/g, ''), // Remove formatação se houver
      job_title: employee.jobTitle.toUpperCase(),
      department: employee.department.toUpperCase(),
      hire_date: employee.hireDate,
      salary_amount: Number(employee.salaryAmount),
      contract_type: employee.contractType,
      status: employee.status,
      email: employee.email.toLowerCase(),
      phone: employee.phone,
      pix_key: employee.pixKey,
      notes: employee.notes ? employee.notes.toUpperCase() : null,
      transport_daily_value: safeTransportVal
    };

    // Remove ID do payload se for undefined para garantir insert
    if (!payload.id) delete payload.id;

    try {
      if (!supabase) throw new Error("Cliente Supabase não inicializado.");

      const { error } = await supabase
        .from('hr_employees')
        .upsert(payload, { onConflict: 'id' });

      if (error) throw error;

      return { success: true };
    } catch (e: any) {
      // --- LOGICA DE CORREÇÃO AUTOMÁTICA (FALLBACK) ---
      // Se o erro for "Coluna não encontrada" para transport_daily_value
      if (e.code === 'PGRST204' && e.message?.includes('transport_daily_value')) {
         const errorMsg = "Schema desatualizado: A coluna 'transport_daily_value' NÃO EXISTE no banco de dados. O valor foi descartado para evitar erro.";
         console.warn(errorMsg);
         
         // Remove o campo problemático e tenta de novo
         delete payload.transport_daily_value;
         
         try {
            const { error: retryError } = await supabase
              .from('hr_employees')
              .upsert(payload, { onConflict: 'id' });
            
            if (!retryError) {
              return { success: true, message: "Aviso: Salvo, mas o valor de VT foi ignorado. Execute o SQL de migração." };
            }
         } catch (retryErr) {
            console.error("Falha no fallback de salvamento.");
         }
      }

      const msg = this.formatSupabaseError(e);
      console.error("Erro ao salvar funcionário:", msg);
      return { success: false, message: msg };
    }
  }

  static async deleteEmployee(id: string): Promise<{ success: boolean; message?: string }> {
    try {
      if (!supabase) throw new Error("Cliente Supabase não inicializado.");

      const { error } = await supabase
        .from('hr_employees')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return { success: true };
    } catch (e: any) {
      const msg = this.formatSupabaseError(e);
      console.error("Erro ao excluir funcionário:", msg);
      return { success: false, message: msg };
    }
  }

  // --- MÉTODOS DE GESTÃO DE DOCUMENTOS ---

  static async uploadDocument(employeeId: string, file: File, docType: string): Promise<{ success: boolean; data?: HRDocument; message?: string }> {
    try {
      if (!supabase) throw new Error("Cliente Supabase não inicializado.");

      // 1. Upload para o Storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;
      const filePath = `${employeeId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('hr-documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // 2. Obter URL Pública
      const { data: urlData } = supabase.storage
        .from('hr-documents')
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;

      // 3. Salvar referência no Banco de Dados
      const { data: dbData, error: dbError } = await supabase
        .from('hr_documents')
        .insert({
          employee_id: employeeId,
          document_type: docType,
          file_url: publicUrl,
          file_name: file.name,
          uploaded_at: new Date().toISOString()
        })
        .select()
        .single();

      if (dbError) throw dbError;

      const newDoc: HRDocument = {
        id: dbData.id,
        employeeId: dbData.employee_id,
        documentType: dbData.document_type,
        fileUrl: dbData.file_url,
        fileName: dbData.file_name,
        uploadedAt: dbData.uploaded_at
      };

      return { success: true, data: newDoc };

    } catch (e: any) {
      const msg = this.formatSupabaseError(e);
      console.error("Erro ao fazer upload do documento:", msg);
      return { success: false, message: msg };
    }
  }

  static async getDocuments(employeeId: string): Promise<HRDocument[]> {
    try {
      if (!supabase) return [];

      const { data, error } = await supabase
        .from('hr_documents')
        .select('*')
        .eq('employee_id', employeeId)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(d => ({
        id: d.id,
        employeeId: d.employee_id,
        documentType: d.document_type,
        fileUrl: d.file_url,
        fileName: d.file_name,
        uploadedAt: d.uploaded_at
      }));
    } catch (e: any) {
      const msg = this.formatSupabaseError(e);
      console.error("Erro ao buscar documentos:", msg);
      return [];
    }
  }

  static async deleteDocument(id: string, fileUrl: string): Promise<{ success: boolean; message?: string }> {
    try {
      if (!supabase) throw new Error("Cliente Supabase não inicializado.");

      // 1. Extrair o caminho do arquivo da URL
      // Ex: .../hr-documents/EMPLOYEE_ID/FILE_NAME
      const bucketName = 'hr-documents';
      const urlParts = fileUrl.split(`/${bucketName}/`);
      if (urlParts.length < 2) throw new Error("URL do arquivo inválida.");
      const filePath = urlParts[1];

      // 2. Remover do Banco de Dados
      const { error: dbError } = await supabase
        .from('hr_documents')
        .delete()
        .eq('id', id);

      if (dbError) throw dbError;

      // 3. Remover do Storage (Clean up)
      const { error: storageError } = await supabase.storage
        .from(bucketName)
        .remove([filePath]);

      if (storageError) console.warn("Aviso: Falha ao remover arquivo físico, mas registro deletado.", storageError);

      return { success: true };
    } catch (e: any) {
      const msg = this.formatSupabaseError(e);
      console.error("Erro ao deletar documento:", msg);
      return { success: false, message: msg };
    }
  }

  // --- MÉTODOS DE FOLHA DE PAGAMENTO (PAYROLL) ---

  // Retorna APENAS CLTs e afins (exclui PJ)
  static async getPayrollList(referenceDate: string): Promise<PayrollRun[]> {
    try {
      if (!supabase) return [];

      // FILTRO DE SEGURANÇA JURÍDICA: Exclui PJ da lista de folha de pagamento CLT
      const { data: employees, error: empError } = await supabase
        .from('hr_employees')
        .select('*')
        .neq('contract_type', 'PJ')
        .order('full_name', { ascending: true });

      if (empError) throw empError;

      // 2. Busca folhas de pagamento já criadas para a data de referência
      const { data: runs, error: runError } = await supabase
        .from('hr_payroll_runs')
        .select('*')
        .eq('reference_date', referenceDate);

      if (runError) throw runError;

      // 3. Combina os dados
      return (employees || []).map(emp => {
        const existingRun = (runs || []).find(r => r.employee_id === emp.id);

        if (existingRun) {
          return {
            id: existingRun.id,
            employeeId: emp.id,
            employeeName: emp.full_name,
            employeeRole: emp.job_title,
            referenceDate: existingRun.reference_date,
            baseSalary: Number(existingRun.base_salary),
            totalEarnings: Number(existingRun.total_earnings),
            totalDeductions: Number(existingRun.total_deductions),
            netSalary: Number(existingRun.net_salary),
            status: existingRun.status,
            paymentDate: existingRun.payment_date,
            items: [], 
            notes: existingRun.notes
          };
        } else {
          return {
            employeeId: emp.id,
            employeeName: emp.full_name,
            employeeRole: emp.job_title,
            referenceDate: referenceDate,
            baseSalary: Number(emp.salary_amount || 0),
            totalEarnings: 0,
            totalDeductions: 0,
            netSalary: Number(emp.salary_amount || 0),
            status: 'DRAFT',
            items: []
          };
        }
      });

    } catch (e: any) {
      const msg = this.formatSupabaseError(e);
      console.error("Erro ao buscar lista de folha de pagamento:", msg);
      return [];
    }
  }

  // NOVO MÉTODO: Retorna APENAS PJs
  static async getServiceOrderList(referenceDate: string): Promise<PayrollRun[]> {
    try {
      if (!supabase) return [];

      // FILTRO: Apenas PJ
      const { data: employees, error: empError } = await supabase
        .from('hr_employees')
        .select('*')
        .eq('contract_type', 'PJ')
        .order('full_name', { ascending: true });

      if (empError) throw empError;

      // Reutiliza a tabela de runs (mas logicamente são 'Ordens de Serviço')
      const { data: runs, error: runError } = await supabase
        .from('hr_payroll_runs')
        .select('*')
        .eq('reference_date', referenceDate);

      if (runError) throw runError;

      return (employees || []).map(emp => {
        const existingRun = (runs || []).find(r => r.employee_id === emp.id);

        if (existingRun) {
          return {
            id: existingRun.id,
            employeeId: emp.id,
            employeeName: emp.full_name,
            employeeRole: emp.job_title,
            referenceDate: existingRun.reference_date,
            baseSalary: Number(existingRun.base_salary),
            totalEarnings: Number(existingRun.total_earnings),
            totalDeductions: Number(existingRun.total_deductions),
            netSalary: Number(existingRun.net_salary),
            status: existingRun.status,
            paymentDate: existingRun.payment_date,
            items: [], 
            notes: existingRun.notes
          };
        } else {
          return {
            employeeId: emp.id,
            employeeName: emp.full_name,
            employeeRole: emp.job_title,
            referenceDate: referenceDate,
            baseSalary: Number(emp.salary_amount || 0),
            totalEarnings: 0,
            totalDeductions: 0,
            netSalary: Number(emp.salary_amount || 0),
            status: 'DRAFT',
            items: []
          };
        }
      });

    } catch (e: any) {
      const msg = this.formatSupabaseError(e);
      console.error("Erro ao buscar lista de ordens de serviço:", msg);
      return [];
    }
  }

  static async getPayrollDetails(runId: string): Promise<PayrollRun | null> {
    try {
      if (!supabase) throw new Error("Cliente Supabase não inicializado.");

      // 1. Busca a Folha (Run)
      const { data: run, error: runError } = await supabase
        .from('hr_payroll_runs')
        .select('*, hr_employees(full_name, job_title)')
        .eq('id', runId)
        .single();

      if (runError) throw runError;
      if (!run) return null;

      // 2. Busca os Itens da Folha
      const { data: items, error: itemsError } = await supabase
        .from('hr_payroll_items')
        .select('*')
        .eq('payroll_run_id', runId); // Alterado de run_id para payroll_run_id

      if (itemsError) throw itemsError;

      // 3. Mapeia para interface
      return {
        id: run.id,
        employeeId: run.employee_id,
        // FIX: Use optional chaining to prevent crash if hr_employees join is null
        employeeName: run.hr_employees?.full_name, // Join via Supabase
        employeeRole: run.hr_employees?.job_title,
        referenceDate: run.reference_date,
        baseSalary: Number(run.base_salary),
        totalEarnings: Number(run.total_earnings),
        totalDeductions: Number(run.total_deductions),
        netSalary: Number(run.net_salary),
        status: run.status,
        paymentDate: run.payment_date,
        notes: run.notes,
        items: (items || []).map(i => ({
          id: i.id,
          description: i.description,
          type: i.type,
          amount: Number(i.amount),
          referenceValue: i.reference_value
        }))
      };

    } catch (e: any) {
      const msg = this.formatSupabaseError(e);
      console.error("Erro ao buscar detalhes da folha:", msg);
      return null;
    }
  }

  static async savePayroll(data: PayrollRun): Promise<{ success: boolean; message?: string; id?: string }> {
    try {
      if (!supabase) throw new Error("Cliente Supabase não inicializado.");

      // 1. Upsert na tabela de Runs
      const runPayload = {
        id: data.id, // Se undefined, gera novo no insert
        employee_id: data.employeeId,
        reference_date: data.referenceDate,
        base_salary: data.baseSalary,
        total_earnings: data.totalEarnings,
        total_deductions: data.totalDeductions,
        net_salary: data.netSalary,
        status: data.status,
        payment_date: data.paymentDate,
        notes: data.notes
      };

      if (!runPayload.id) delete runPayload.id;

      const { data: savedRun, error: runError } = await supabase
        .from('hr_payroll_runs')
        .upsert(runPayload, { onConflict: 'id' })
        .select()
        .single();

      if (runError) throw runError;
      if (!savedRun) throw new Error("Falha ao salvar cabeçalho da folha.");

      const runId = savedRun.id;

      // 2. Substituição dos Itens (Delete All + Insert All para garantir integridade)
      
      // A. Remove itens antigos
      const { error: delError } = await supabase
        .from('hr_payroll_items')
        .delete()
        .eq('payroll_run_id', runId); // Alterado de run_id para payroll_run_id

      if (delError) throw delError;

      // B. Insere novos itens
      if (data.items && data.items.length > 0) {
        const itemsPayload = data.items.map(item => ({
          payroll_run_id: runId, // Alterado de run_id para payroll_run_id
          description: item.description,
          type: item.type,
          amount: item.amount,
          reference_value: item.referenceValue
        }));

        const { error: insError } = await supabase
          .from('hr_payroll_items')
          .insert(itemsPayload);

        if (insError) throw insError;
      }

      return { success: true, id: runId };

    } catch (e: any) {
      const msg = this.formatSupabaseError(e);
      console.error("Erro ao salvar folha de pagamento:", msg);
      return { success: false, message: msg };
    }
  }

  // Novo método para alternar status (Reabrir)
  static async updatePayrollStatus(id: string, status: 'DRAFT' | 'CLOSED'): Promise<{ success: boolean; message?: string }> {
    try {
      if (!supabase) throw new Error("Cliente Supabase não inicializado.");

      const { error } = await supabase
        .from('hr_payroll_runs')
        .update({ status: status })
        .eq('id', id);

      if (error) throw error;

      return { success: true };
    } catch (e: any) {
      const msg = this.formatSupabaseError(e);
      return { success: false, message: msg };
    }
  }

  // --- MÉTODOS DE FÉRIAS E AUSÊNCIAS (LEAVES) ---

  static async getLeaves(employeeId?: string): Promise<LeaveRecord[]> {
    try {
      if (!supabase) return [];

      let query = supabase.from('hr_leaves').select('*');
      if (employeeId) {
        query = query.eq('employee_id', employeeId);
      }
      query = query.order('start_date', { ascending: false });

      const { data, error } = await query;

      if (error) {
        // Ignora erro de tabela não encontrada para evitar crash e logs excessivos
        // Código PGRST205: relation "public.hr_leaves" does not exist
        if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
            console.warn("Tabela 'hr_leaves' ainda não foi criada. A funcionalidade de férias ficará indisponível até a migração do banco.");
            return [];
        }
        throw error;
      }

      return (data || []).map(l => ({
        id: l.id,
        employeeId: l.employee_id,
        type: l.type,
        startDate: l.start_date,
        endDate: l.end_date,
        durationDays: Number(l.duration_days),
        vestingStart: l.vesting_start,
        vestingEnd: l.vesting_end,
        status: l.status,
        notes: l.notes
      }));
    } catch (e: any) {
      console.error("Erro ao buscar ausências:", this.formatSupabaseError(e));
      return [];
    }
  }

  static async saveLeave(leave: LeaveRecord): Promise<{ success: boolean; message?: string }> {
    try {
      if (!supabase) throw new Error("Cliente Supabase não inicializado.");

      const payload = {
        id: leave.id,
        employee_id: leave.employeeId,
        type: leave.type,
        start_date: leave.startDate,
        end_date: leave.endDate,
        duration_days: leave.durationDays,
        vesting_start: leave.vestingStart,
        vesting_end: leave.vestingEnd,
        status: leave.status,
        notes: leave.notes ? leave.notes.toUpperCase() : null
      };

      if (!payload.id) delete payload.id;

      const { error } = await supabase
        .from('hr_leaves')
        .upsert(payload, { onConflict: 'id' });

      if (error) {
         if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
             return { success: false, message: "Tabela de ausências não encontrada. Contate o administrador do sistema." };
         }
         throw error;
      }

      return { success: true };
    } catch (e: any) {
      const msg = this.formatSupabaseError(e);
      console.error("Erro ao salvar ausência:", msg);
      return { success: false, message: msg };
    }
  }

  static async deleteLeave(id: string): Promise<{ success: boolean; message?: string }> {
    try {
      if (!supabase) throw new Error("Cliente Supabase não inicializado.");

      const { error } = await supabase
        .from('hr_leaves')
        .delete()
        .eq('id', id);

      if (error) {
         if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
             return { success: false, message: "Tabela de ausências não encontrada." };
         }
         throw error;
      }

      return { success: true };
    } catch (e: any) {
      const msg = this.formatSupabaseError(e);
      return { success: false, message: msg };
    }
  }

  // --- CÁLCULO DE 13º SALÁRIO ---
  
  /**
   * Calcula quantos avos (meses) de 13º salário o funcionário tem direito no ano especificado.
   * Considera data de admissão e perde o avo se tiver > 15 dias de falta injustificada no mês.
   */
  static async calculateThirteenthMonths(employeeId: string, year: number): Promise<number> {
    try {
      if (!supabase) throw new Error("Cliente Supabase não inicializado.");

      // 1. Busca dados do funcionário (Admissão)
      const { data: emp, error: empError } = await supabase
        .from('hr_employees')
        .select('hire_date')
        .eq('id', employeeId)
        .single();

      if (empError || !emp || !emp.hire_date) return 0;

      const hireDate = new Date(emp.hire_date);
      // Zera horas para comparação correta
      hireDate.setUTCHours(0, 0, 0, 0);

      // 2. Busca faltas do ano (FALTA)
      const startOfYear = `${year}-01-01`;
      const endOfYear = `${year}-12-31`;

      // Utilizando 'hr_leaves' filtrando por type='FALTA'
      const { data: absences } = await supabase
        .from('hr_leaves')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('type', 'FALTA')
        .gte('end_date', startOfYear)
        .lte('start_date', endOfYear);

      let monthsCount = 0;

      // 3. Loop pelos 12 meses (0 = Janeiro, 11 = Dezembro)
      for (let month = 0; month < 12; month++) {
        // Datas limites do mês
        const monthStart = new Date(Date.UTC(year, month, 1));
        const monthEnd = new Date(Date.UTC(year, month + 1, 0)); // Último dia do mês

        // --- Verificação de Admissão ---
        // Se a admissão for DEPOIS do fim deste mês, não tem direito.
        if (hireDate > monthEnd) continue;

        // Se foi admitido neste mês, precisa ter trabalhado >= 15 dias
        // (Ex: Admitido dia 17 num mês de 30 dias = trabalhou 14 dias -> Não ganha)
        if (hireDate >= monthStart && hireDate <= monthEnd) {
           const daysWorked = (monthEnd.getDate() - hireDate.getUTCDate()) + 1;
           if (daysWorked < 15) continue;
        }

        // --- Verificação de Faltas ---
        let totalAbsenceDays = 0;

        if (absences) {
          absences.forEach(abs => {
            const absStart = new Date(abs.start_date);
            const absEnd = new Date(abs.end_date);

            // Verifica intersecção com o mês atual
            if (absStart <= monthEnd && absEnd >= monthStart) {
              // Recorta o período para caber dentro do mês
              const effectiveStart = absStart < monthStart ? monthStart : absStart;
              const effectiveEnd = absEnd > monthEnd ? monthEnd : absEnd;

              // Calcula dias (em ms convertidos para dias) + 1 inclusivo
              const diffTime = Math.abs(effectiveEnd.getTime() - effectiveStart.getTime());
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
              
              totalAbsenceDays += diffDays;
            }
          });
        }

        // Regra: Se faltas > 15 dias, perde o avo. Se <= 15, ganha.
        if (totalAbsenceDays <= 15) {
          monthsCount++;
        }
      }

      return monthsCount;

    } catch (e) {
      console.error("Erro ao calcular 13º:", e);
      return 0;
    }
  }
}
