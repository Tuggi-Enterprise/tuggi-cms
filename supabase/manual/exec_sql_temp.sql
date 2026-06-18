-- ============================================================
-- TEMPORARY write-exec RPC for the country/state normalisation run.
-- Service-role only. DROP it after the normalisation is done.
-- Cole no Supabase SQL Editor (painel) e rode.
-- ============================================================

create or replace function core.exec_sql(q text)
returns bigint
language plpgsql
security definer
set search_path = core, pg_temp
set statement_timeout = '180s'   -- vence o statement_timeout=8s do authenticator/PostgREST
set lock_timeout = '30s'         -- updates grandes podem esperar lock sob carga de import
as $$
declare
  affected bigint;
begin
  execute q;
  get diagnostics affected = row_count;
  return affected;   -- nº de linhas afetadas pelo statement
end;
$$;

-- Trava: ninguém além do service_role pode chamar.
revoke all on function core.exec_sql(text) from public;
revoke all on function core.exec_sql(text) from anon;
revoke all on function core.exec_sql(text) from authenticated;

-- Expor no PostgREST (schema core) para o service_role chamar via REST.
grant execute on function core.exec_sql(text) to service_role;

notify pgrst, 'reload schema';

-- ============================================================
-- DEPOIS DE TUDO PRONTO, remover a função:
--   drop function core.exec_sql(text);
--   notify pgrst, 'reload schema';
-- ============================================================
