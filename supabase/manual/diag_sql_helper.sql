-- ============================================================================
-- core.diag_sql — helper READ-ONLY p/ diagnóstico (rodar 1x no SQL Editor)
-- v2: além de SELECT/WITH, agora aceita EXPLAIN (ANALYZE) de statements
--     read-only — retorna o plano em JSON. Continua bloqueando escrita.
-- Dropar no fim do diagnóstico:
--   DROP FUNCTION IF EXISTS core.diag_sql(text);
-- ============================================================================
create or replace function core.diag_sql(q text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  body text := rtrim(btrim(q), ';');
  first_word text := lower(split_part(btrim(q), ' ', 1));
begin
  -- statement único (sem ; no meio)
  if position(';' in body) > 0 then
    raise exception 'diag_sql: apenas um statement por chamada';
  end if;

  if first_word = 'explain' then
    -- remove o EXPLAIN (e opções) que veio na entrada, para reaplicar o nosso
    body := btrim(regexp_replace(body, '^\s*explain\s*(\([^)]*\))?\s*', '', 'i'));
    -- garante que o alvo é read-only antes de executar (ANALYZE roda a query)
    if lower(body) ~ '\y(insert|update|delete|truncate|drop|alter|create|grant|revoke|merge|copy|call|do)\y' then
      raise exception 'diag_sql: EXPLAIN permitido apenas sobre SELECT/WITH';
    end if;
    set local statement_timeout = '180s';   -- EXPLAIN ANALYZE da query lenta pode levar ~80s
    execute 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || body into result;
    return result;
  end if;

  -- caminho normal: só leitura, embrulhado em jsonb
  if first_word not in ('select', 'with') then
    raise exception 'diag_sql: apenas SELECT/WITH/EXPLAIN são permitidos (recebido: %)', first_word;
  end if;
  set local statement_timeout = '30s';
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', body)
    into result;
  return result;
end;
$$;

grant execute on function core.diag_sql(text) to service_role;
notify pgrst, 'reload schema';
