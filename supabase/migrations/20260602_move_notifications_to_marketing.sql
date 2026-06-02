-- ============================================================================
-- Marketing Module — mover as tabelas de PUSH de `core` para `marketing`
-- ----------------------------------------------------------------------------
-- Move fisicamente os dados de notificações para o schema `marketing` (mesmo
-- módulo da newsletter) PRESERVANDO os dados, e cria VIEWS de compatibilidade
-- em `core` com o mesmo nome.
--
-- Por que as views? As ~5 funções de automação em `drive.*`
-- (apply_new_user_premium_trial, check_expiring_premium_users,
--  check_subscription_reminders, check_new_pois_for_waitlist,
--  check_expiring_coupon_premium_users) fazem
-- `INSERT INTO core.scheduled_notifications` com schema hard-coded. Em plpgsql
-- os nomes de tabela são resolvidos em RUNTIME, então uma view atualizável
-- `core.scheduled_notifications -> marketing.scheduled_notifications` mantém
-- todas elas funcionando SEM reescrita (zero risco às automações de receita).
-- O mesmo vale para os RPCs de template/logs do painel de push.
--
-- ⚠️  Rodar manualmente no SQL editor, DEPOIS de 20260602_create_marketing_schema.sql.
--     Idealmente dentro de uma transação (BEGIN; ... COMMIT;) para rollback fácil.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Mover as tabelas (dados preservados). Não há FKs/sequences apontando para
--    elas, então SET SCHEMA é seguro.
-- ----------------------------------------------------------------------------
ALTER TABLE core.notification_logs          SET SCHEMA marketing;
ALTER TABLE core.scheduled_notifications    SET SCHEMA marketing;
ALTER TABLE core.notification_templates     SET SCHEMA marketing;

-- ----------------------------------------------------------------------------
-- 2. Views de compatibilidade em core (simples => auto-updatable: INSERT/UPDATE/
--    DELETE/SELECT passam direto para a tabela base em marketing, e os defaults
--    da tabela base — id, created_at, status — continuam valendo).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW core.notification_logs       AS SELECT * FROM marketing.notification_logs;
CREATE OR REPLACE VIEW core.scheduled_notifications AS SELECT * FROM marketing.scheduled_notifications;
CREATE OR REPLACE VIEW core.notification_templates  AS SELECT * FROM marketing.notification_templates;

-- ----------------------------------------------------------------------------
-- 3. Grants — espelham os grants originais das tabelas.
--    (service_role usa marketing.* diretamente; as views cobrem o resto.)
-- ----------------------------------------------------------------------------
GRANT ALL    ON marketing.notification_logs          TO service_role;
GRANT ALL    ON marketing.scheduled_notifications    TO service_role;
GRANT ALL    ON marketing.notification_templates     TO service_role;

GRANT ALL    ON core.notification_logs          TO service_role;
GRANT ALL    ON core.scheduled_notifications    TO service_role;
GRANT ALL    ON core.notification_templates     TO service_role;
GRANT SELECT ON core.notification_templates     TO authenticated;

-- ----------------------------------------------------------------------------
-- Observações:
--   • Os RPCs existentes (core.get_notification_templates / get_notification_logs
--     / create|update|delete_notification_template / estimate_notification_audience
--     e seus wrappers public.*) continuam intactos: resolvem os nomes core.* em
--     runtime e caem nas views acima. Nenhuma reescrita necessária.
--   • A Edge Function firebase-push-notification é reapontada no código para ler
--     marketing.scheduled_notifications / marketing.notification_logs diretamente
--     (ver supabase/functions/firebase-push-notification/index.ts).
--   • Limpeza futura (opcional): reapontar as 5 funções drive.* para marketing.*
--     uma a uma e então remover as views de compatibilidade de core.
-- ----------------------------------------------------------------------------

COMMIT;
