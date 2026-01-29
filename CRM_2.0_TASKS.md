# 🚀 Implementação CRM 2.0 & Enriquecimento de Dados

Este documento rastreia o progresso da implementação do novo módulo CRM com gamificação e integração Tiny ERP.

## ✅ Fase 1: Estrutura & Dados (Concluído)
- [x] **Modelagem de Dados**: Criar colunas de LTV, XP, Tags e Engagement no Supabase (`update_crm_structure.sql`).
- [x] **Migração (Backfill)**: Importar clientes da tabela antiga para o novo Pipeline CRM (`crm_backfill.sql`).
- [x] **Verificação**: Confirmar que todos os clientes aparecem no Kanban.

## ✅ Fase 2: Integração Tiny ERP (Concluído)
- [x] **Service Layer**: Criar `tinyService.ts` para comunicação com API do Tiny.
- [x] **Proxy Reverso**: Configurar Vite (`vite.config.ts`) para evitar CORS durante desenvolvimento.
- [x] **Segurança**: Configurar variáveis de ambiente (`VITE_TINY_TOKEN`).
- [x] **UI de Sincronização**: Adicionar botão "Sincronizar Tiny" no card do cliente.
- [x] **Display de Métricas**: Exibir LTV, XP e Score Visual no Modal de Detalhes.

## 🚧 Fase 3: Refinamento & Automação (Próximos Passos)
- [ ] **Testes de Integração**: Validar se o LTV está sendo puxado corretamente de clientes reais do Tiny.
- [ ] **Gamificação Ativa**: Implementar regras automáticas de XP baseadas em compras (atualmente é estático/manual).
- [ ] **Automação de Sync**: Criar trigger ou job para atualizar LTV periodicamente sem clique manual.
- [ ] **Filtros Avançados**: Permitir filtrar o Kanban por Tags (ex: "VIP", "TINY_INTEGRATED").

## 📋 Backlog Futuro
- [ ] Envio de mensagens WhatsApp direto do Card.
- [ ] Dashboard de Vendas x Metas por Vendedor.
