-- ============================================================================
-- THE OPERATOR'S EXCEPTION TO THE FREE TIER — who broke the rule, when, and why
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
--
-- WHY IT EXISTS. BR-B2B-016, item 1: on the free tier Tuggi points the direction and says the
-- NAME, and nothing beyond it; the description is what the paid tier adds. Item 9 closes the
-- other side — a free-tier place does not trigger on-demand narration production, the first named
-- exception to BR-CONTEUDO-001 mode 2. The operator decided on 2026-08-26 that the ruler may be
-- broken case by case, and in the same sentence said what breaking it must leave behind: "essa
-- decisão precisa ser salva".
--
-- WHY `core.attractions` AND NOT `core.place_details`. Both tables exist, and the second looks
-- like the obvious choice — the Places modal is where the rule shows up. But a partner's place is
-- not always a `place`: `PlaceLinkPanel` links ALREADY CATALOGUED POIs to a client
-- (`lib/partnerships/place-tool.ts` exists precisely because the two open in different editors),
-- and an `entity_kind = 'poi'` has no row in `place_details`. The column that defines commercial
-- ownership is `core.attractions.partner_client_id`, and the exception belongs beside the fact
-- that makes it necessary.
--
-- THE THREE TRAVEL TOGETHER, and the CHECK is what guarantees it. An exception with no written
-- reason is state nobody can review six months later; a reason with no date does not say whether
-- it still holds. Same reasoning as `is_courtesy` + `courtesy_reason` (BR-B2B-017, item 6), which
-- has already paid for accepting the half: `Sabor e Arte Restaurante` carries a courtesy with no
-- reason, and the board prints a false sentence about it.
--
-- NO ROW IS REWRITTEN. The three columns are born NULL across 2,234,095 records, which is the
-- "no exception" state — the policy of every curated POI and of every paying partner. Nullable
-- columns with no DEFAULT are metadata-only in Postgres: they do not rewrite the table.
--
-- ROLLBACK:
--   ALTER TABLE core.attractions DROP CONSTRAINT IF EXISTS attractions_partner_description_exception_ck;
--   ALTER TABLE core.attractions
--     DROP COLUMN IF EXISTS partner_description_exception_at,
--     DROP COLUMN IF EXISTS partner_description_exception_by,
--     DROP COLUMN IF EXISTS partner_description_exception_reason;
--   (destrutivo: apaga as exceções registradas. §3 do CLAUDE.md — quem executa é o humano.)
-- ============================================================================

ALTER TABLE core.attractions
  ADD COLUMN IF NOT EXISTS partner_description_exception_at     timestamptz,
  ADD COLUMN IF NOT EXISTS partner_description_exception_by     uuid,
  ADD COLUMN IF NOT EXISTS partner_description_exception_reason text;

COMMENT ON COLUMN core.attractions.partner_description_exception_at IS
  'When the operator allowed a structured description for a free-tier partner. NULL means no '
  'exception, which is the state of every curated POI and every paying partner. The presence of '
  'this column IS the flag — BR-B2B-016, item 1.';
COMMENT ON COLUMN core.attractions.partner_description_exception_by IS
  'auth uid of whoever decided. Same shape as approved_by/reviewed_by: no FK, resolved into words '
  'by lib/services/operator-label.ts.';
COMMENT ON COLUMN core.attractions.partner_description_exception_reason IS
  'Why the rule was broken, written by the operator. Mandatory whenever there is an exception.';

-- All three, or none. `by` is in the CHECK alongside them: an exception with no author is a
-- decision with no owner, and the route that writes it always has the CMS session in hand.
ALTER TABLE core.attractions
  DROP CONSTRAINT IF EXISTS attractions_partner_description_exception_ck;

ALTER TABLE core.attractions
  ADD CONSTRAINT attractions_partner_description_exception_ck CHECK (
    (
      partner_description_exception_at IS NULL
      AND partner_description_exception_by IS NULL
      AND partner_description_exception_reason IS NULL
    )
    OR (
      partner_description_exception_at IS NOT NULL
      AND partner_description_exception_by IS NOT NULL
      AND btrim(coalesce(partner_description_exception_reason, '')) <> ''
    )
  ) NOT VALID;

-- NOT VALID then VALIDATE, in two steps: a validating `ADD CONSTRAINT` scans 2.2 million rows
-- while holding ACCESS EXCLUSIVE, and `core.attractions` is the hottest table in the database.
-- Since the three columns were just born NULL the scan cannot fail — but it can take a while, and
-- VALIDATE takes a weak lock (SHARE UPDATE EXCLUSIVE) that blocks neither reads nor writes.
ALTER TABLE core.attractions
  VALIDATE CONSTRAINT attractions_partner_description_exception_ck;
