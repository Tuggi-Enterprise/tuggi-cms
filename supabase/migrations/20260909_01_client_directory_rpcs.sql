-- ============================================================================
-- PROPOSTA — NÃO EXECUTADA. O operador humano executa no painel (CLAUDE.md §3).
--
-- POR QUE ESTA MIGRATION EXISTE, com o número medido em 2026-09-09:
--
-- `loadClientDirectory` (lib/services/partnership-service.ts) monta a tela
-- /admin/clients com 10 chamadas ao PostgREST, seis delas em série. Cinco
-- passam a lista inteira de ids de cliente em `.in(...)`, que o supabase-js
-- serializa na QUERY STRING de um GET.
--
-- O teto da URL foi MEDIDO contra este projeto (Cloudflare + PostgREST):
--   n=580 ids  -> url 22.766 chars -> HTTP 200
--   n=581 ids  -> url 22.805 chars -> HTTP 400
--   n=2000     -> HTTP 414 URI Too Long
--
-- Ou seja: a partir de ~575 clientes as consultas de contrato, conferência e
-- local passam a devolver erro. E `loadLiveContracts`, `getClientConferences`
-- e `loadPartnerPlaces` DESCARTAM o erro (`if (error || !data) return map`),
-- então a tela renderiza todo parceiro como `sem contrato`, `sem conferência`
-- e `sem local`, e o quadro joga todo mundo para as colunas iniciais — sem
-- nada na tela dizendo que a leitura falhou. Falha silenciosa, não lentidão.
--
-- Estas duas funções trocam as 10 chamadas por 2 e removem a lista de ids da
-- URL. Elas NÃO movem regra de negócio para o banco: `derivePipelineState`,
-- `buildPlaceReadiness` e `buildDirectoryView` continuam em TS, onde estão os
-- testes. O que muda é só o TRANSPORTE.
--
-- GATILHO §2: mexe em identidade e em GRANT -> passa pelo `security-reviewer`
-- antes do merge.
--
-- ATENÇÃO, medido em 2026-09-09 e é por isso que NÃO há `GRANT USAGE ON SCHEMA
-- partner`: o schema `partner` não dá USAGE a `authenticated` nem a `anon`,
-- MAS `partner.clients` já tem SELECT concedido aos dois. Dar USAGE hoje
-- abriria a tabela na hora. Por isso a função do lado `partner` só é executável
-- por `service_role`, que é a identidade que `loadClientDirectory` já usa para
-- essas cinco leituras.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────── UP ─────────

-- 1) O lado `partner` da esteira, num documento só.
--
-- Cinco leituras viram uma. Chamada com `service_role` a partir da rota, que
-- já roda sob `withAuth({ roles: ['admin'] })` — a mesma identidade que as
-- cinco leituras que ela substitui.
CREATE OR REPLACE FUNCTION partner.cms_client_directory(
  submission_limit integer DEFAULT 1000,
  client_limit integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'partner', 'core', 'pg_temp'
AS $function$
  WITH s AS (
    SELECT id, status, answers, submitted_at, updated_at, created_at, promoted_at,
           promoted_by, promoted_client_id, review_note, reviewed_at, reviewed_by,
           discard_reason
    FROM partner.partner_form_submissions
    ORDER BY submitted_at DESC NULLS LAST
    LIMIT submission_limit
  ),
  c AS (
    SELECT id, name, company_name, city, state, country, client_type, tax_id, status,
           approved_at, created_at, monthly_fee_cents, is_courtesy, courtesy_reason,
           welcome_poi_id
    FROM partner.clients
    ORDER BY created_at DESC
    LIMIT client_limit
  ),
  -- O contrato VIVO de cada cliente: o mais novo não superado. Mesma definição
  -- de `loadLiveContracts`, feita aqui com DISTINCT ON em vez de um laço no TS.
  live AS (
    SELECT DISTINCT ON (k.client_id)
           k.id, k.client_id, k.status, k.tier, k.created_at
    FROM partner.partner_contracts k
    JOIN c ON c.id = k.client_id
    WHERE k.superseded_by IS NULL
    ORDER BY k.client_id, k.created_at DESC
  )
  SELECT jsonb_build_object(
    'submissions', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.submitted_at DESC NULLS LAST) FROM s), '[]'::jsonb),
    'clients',     COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC) FROM c), '[]'::jsonb),
    'contracts',   COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'client_id',   live.client_id,
        'status',      live.status,
        'tier',        live.tier,
        -- A DATA da assinatura é o que a faixa 3 mostra e de onde `Parado há`
        -- conta; vem junto para não custar a sexta chamada.
        'signed_at',   acc.accepted_at,
        'signer_name', acc.signer_name
      ))
      FROM live
      LEFT JOIN partner.partner_contract_acceptances acc
        ON acc.contract_id = live.id AND live.status = 'signed'
    ), '[]'::jsonb),
    'conferences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'client_id',      f.client_id,
        'documents_seen', f.documents_seen,
        'reviewed_at',    f.reviewed_at,
        'reviewed_by',    f.reviewed_by
      ))
      FROM partner.client_conferences f JOIN c ON c.id = f.client_id
    ), '[]'::jsonb),
    -- A recusa EM VIGOR por local (BR-B2B-010, item 4). Hoje a tabela tem 0
    -- linhas e a chamada é a sexta ida em série; aqui ela não custa ida nenhuma.
    'refusals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'attraction_id',   r.attraction_id,
        'decided_at',      r.decided_at,
        'communicated_at', r.communicated_at,
        'gate',            r.gate,
        'reason',          r.reason
      ))
      FROM (
        SELECT DISTINCT ON (x.attraction_id) x.*
        FROM partner.partner_triage_refusals x
        JOIN core.attractions a ON a.id = x.attraction_id
        JOIN c ON c.id = a.partner_client_id
        ORDER BY x.attraction_id, x.decided_at DESC
      ) r
    ), '[]'::jsonb),
    -- O que os tetos cortaram — o mesmo `truncated` que a tela já mostra, agora
    -- decidido onde a contagem é barata.
    'truncated', (SELECT count(*) FROM s) >= submission_limit
              OR (SELECT count(*) FROM c) >= client_limit
  );
$function$;

REVOKE ALL ON FUNCTION partner.cms_client_directory(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION partner.cms_client_directory(integer, integer) FROM anon;
REVOKE ALL ON FUNCTION partner.cms_client_directory(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION partner.cms_client_directory(integer, integer) TO service_role;


-- 2) Os locais de parceiro, com a identidade do OPERADOR.
--
-- Substitui as QUATRO idas em série de `placeService.listByPartnerClient`
-- (attractions -> attraction_coordinate -> attraction_trigger_points ->
-- attraction_descriptions) e mata de uma vez o `CHILD_ROW_CAP = 2000` de
-- `anyChildRow`, que a ~985 clientes começa a disparar UMA consulta POR LOCAL
-- não visto (medido: 2,7 descrições com áudio e 2,2 TPs ativos por local,
-- 0,75 local por cliente).
--
-- Não recebe lista de ids: o filtro é `partner_client_id IS NOT NULL`, servido
-- pelo índice parcial `idx_attractions_partner_client_id` que já existe. Sem
-- lista, sem teto de URL.
--
-- `entity_kind` NÃO é filtrado, de propósito — o vínculo é o vínculo. Mesma
-- decisão que `listByPartnerClient` já documenta.
--
-- Plano medido em 2026-09-09 com 39 locais: 1,87 ms, 471 buffers
-- (12 buffers por local; linear no número de locais).
CREATE OR REPLACE FUNCTION core.cms_partner_places()
RETURNS TABLE (
  attraction_id     uuid,
  partner_client_id uuid,
  name              text,
  city              text,
  state             text,
  entity_kind       text,
  approved          boolean,
  is_active         boolean,
  latitude          double precision,
  longitude         double precision,
  show_in_map       boolean,
  boundary_type     text,
  boundary_area_m2  double precision,
  has_active_trigger_point boolean,
  has_audio_description    boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'core', 'pg_temp'
AS $function$
  SELECT
    a.id,
    a.partner_client_id,
    a.name,
    a.city,
    a.state,
    a.entity_kind,
    a.approved,
    a.is_active,
    k.latitude,
    k.longitude,
    k.show_in_map,
    k.boundary_type,
    k.boundary_area_m2,
    EXISTS (SELECT 1 FROM core.attraction_trigger_points t
             WHERE t.attraction_id = a.id AND t.is_active),
    EXISTS (SELECT 1 FROM core.attraction_descriptions d
             WHERE d.attraction_id = a.id AND d.audio_url IS NOT NULL)
  FROM core.attractions a
  LEFT JOIN core.attraction_coordinate k ON k.attraction_id = a.id
  -- O MESMO portão da policy `CMS admins can read attractions`, escrito aqui
  -- porque SECURITY DEFINER pula RLS. Sem esta linha a função responde para
  -- qualquer `authenticated`.
  WHERE a.partner_client_id IS NOT NULL
    AND core.is_active_cms_admin()
  ORDER BY a.created_at;
$function$;

REVOKE ALL ON FUNCTION core.cms_partner_places() FROM PUBLIC;
REVOKE ALL ON FUNCTION core.cms_partner_places() FROM anon;
GRANT EXECUTE ON FUNCTION core.cms_partner_places() TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_partner_places() TO service_role;


-- ─────────────────────────────────────────────────────────────── DOWN ───────
-- Nenhuma das duas existia antes; o rollback é remover as duas. Não há tabela,
-- coluna nem dado envolvido, então o DROP aqui não é destrutivo no sentido do
-- §3 — mas continua sendo o humano quem executa.
--
--   DROP FUNCTION IF EXISTS core.cms_partner_places();
--   DROP FUNCTION IF EXISTS partner.cms_client_directory(integer, integer);
--
-- Conferido em 2026-09-09: `pg_get_functiondef` não devolve nada para nenhum
-- dos dois nomes — não há versão anterior no banco para preservar.
