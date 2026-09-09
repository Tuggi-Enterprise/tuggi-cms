-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- partner.cms_client_directory — as recusas voltam INTEIRAS, e a regra volta para o TS
--
-- Corrige dois problemas da 20260909_01, os dois descobertos ao ligar o código nela.
--
-- 1. FALTAVA O `id`. A chave `refusals` trazia `attraction_id`, `decided_at`,
--    `communicated_at`, `gate` e `reason` — e nenhuma identidade. O ato
--    `Comunicar a recusa` do quadro POSTA esse id: a rota
--    `.../triage-refusal/communicate` exige `refusalId` e recusa-se a deduzir
--    qual round é o corrente, de propósito (deduzir ali carimbaria um round que
--    o operador não estava olhando quando um segundo chegou no meio). Sem o id,
--    ligar o diretório a esta função reintroduziria o defeito que o commit
--    0cb70f0 acabou de corrigir. A tabela tem 0 linhas hoje, então nenhum dado
--    denunciaria isso: só a leitura do SQL.
--
-- 2. A REGRA ESTAVA DUPLICADA. O `DISTINCT ON (attraction_id) ORDER BY
--    decided_at DESC` é, palavra por palavra, o que `currentRefusal` faz em
--    `lib/partnerships/triage.ts`. Duas implementações da mesma decisão é o
--    defeito que o CLAUDE.md §6 chama pelo nome, e a saída barata aqui não é um
--    teste de paridade — é não ter a segunda implementação. A função passa a
--    devolver TODAS as recusas dos locais dos clientes carregados, e quem
--    escolhe a que vale continua sendo `currentRefusal`, onde está provado.
--
--    O custo é linhas, e elas não existem: 0 hoje, e uma recusa por round por
--    local recusado no pior caso. É a troca certa nesta escala.
--
-- Nada mais muda: mesma assinatura, mesmo SECURITY DEFINER, mesmo search_path,
-- mesmos GRANT/REVOKE da 01 — que continuam valendo porque `CREATE OR REPLACE`
-- preserva o ACL do objeto. Nenhuma outra chave do JSON é tocada.
--
-- GATILHO §2: não mexe em identidade nem em GRANT. O corpo continua
-- SECURITY DEFINER e a leitura continua restrita a `service_role`.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ── UP ───────────────────────────────────────────────────────────────────────────────────────

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
    -- TODAS as recusas dos locais destes clientes, com o `id` de cada uma.
    -- Qual delas está em vigor é decisão de `currentRefusal`, no TS — ver o
    -- cabeçalho. `id` é o que o ato `Comunicar a recusa` posta.
    'refusals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',              x.id,
        'attraction_id',   x.attraction_id,
        'decided_at',      x.decided_at,
        'communicated_at', x.communicated_at,
        'gate',            x.gate,
        'reason',          x.reason
      ))
      FROM partner.partner_triage_refusals x
      JOIN core.attractions a ON a.id = x.attraction_id
      JOIN c ON c.id = a.partner_client_id
    ), '[]'::jsonb),
    -- O que os tetos cortaram — o mesmo `truncated` que a tela já mostra, agora
    -- decidido onde a contagem é barata.
    'truncated', (SELECT count(*) FROM s) >= submission_limit
              OR (SELECT count(*) FROM c) >= client_limit
  );
$function$;

-- ── DOWN ─────────────────────────────────────────────────────────────────────────────────────
--
-- Volta ao corpo da 20260909_01: recusa em vigor escolhida no SQL, sem `id`.
-- ⚠️ Reverter isto QUEBRA `Comunicar a recusa` no quadro assim que o diretório
--    passar a ler por esta função — a linha fica sem o id que a rota exige.
--
-- CREATE OR REPLACE FUNCTION partner.cms_client_directory(
--   submission_limit integer DEFAULT 1000,
--   client_limit integer DEFAULT 1000
-- ) ... com o bloco `refusals` original:
--
--     'refusals', COALESCE((
--       SELECT jsonb_agg(jsonb_build_object(
--         'attraction_id',   r.attraction_id,
--         'decided_at',      r.decided_at,
--         'communicated_at', r.communicated_at,
--         'gate',            r.gate,
--         'reason',          r.reason
--       ))
--       FROM (
--         SELECT DISTINCT ON (x.attraction_id) x.*
--         FROM partner.partner_triage_refusals x
--         JOIN core.attractions a ON a.id = x.attraction_id
--         JOIN c ON c.id = a.partner_client_id
--         ORDER BY x.attraction_id, x.decided_at DESC
--       ) r
--     ), '[]'::jsonb),
--
-- O corpo inteiro da versão anterior está em
-- supabase/migrations/20260909_01_client_directory_rpcs.sql, que não foi apagada.

-- ── ENDURECIMENTO, pedido pelo `security-reviewer` em 2026-09-09 ─────────────────────────────
--
-- `CREATE OR REPLACE` preserva o ACL, então estes quatro comandos são no-op hoje e é de
-- propósito: eles existem para o dia em que alguém fizer DROP + recriar. Medido em
-- `pg_default_acl`, o schema `partner` tem
-- `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO authenticated` — quer dizer que
-- uma função NOVA neste schema nasce executável por `authenticated`. O que fecha essa porta é o
-- REVOKE explícito, e repeti-lo aqui é idempotente.
--
-- O que segura a porta hoje é `partner` não conceder USAGE a `anon`/`authenticated`. Não conceda:
-- `partner.clients` já tem SELECT para os dois, e o USAGE abriria a tabela no mesmo instante.
REVOKE ALL ON FUNCTION partner.cms_client_directory(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION partner.cms_client_directory(integer, integer) FROM anon;
REVOKE ALL ON FUNCTION partner.cms_client_directory(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION partner.cms_client_directory(integer, integer) TO service_role;
