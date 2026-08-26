-- ============================================================================
-- THE MATERIAL ORDER PIPELINE — two stages between `requested` and its endings
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
--
-- WHY IT EXISTS. `/admin/materials` had three columns and they described the order, not the work:
-- `requested` covered everything from "arrived this morning" to "boxed and waiting for the
-- carrier", and `fulfilled` covered both "handed over at the counter" and "the carrier says it
-- was delivered". The operator asked on 2026-08-26 for the two stages the team actually has —
-- `in_preparation` and `dispatched` — so the board can answer what still has to be printed apart
-- from what already left.
--
-- THE GRAPH IS NOT IN THE DATABASE, AND THAT IS DELIBERATE. This CHECK says which words are
-- statuses; which move is legal from where lives in ONE place, `lib/materials/order-queue.ts`
-- (`MATERIAL_TRANSITIONS`), and reaches the write as the `WHERE` of the update
-- (`statusesThatMayBecome`, in `lib/services/material-order-service.ts`). A trigger repeating the
-- arrows here would be the second copy of the same decision — SSOT before DRY, CLAUDE.md §6.
--
-- NO ROW CHANGES. The three existing words stay legal and keep their meaning: an order sitting in
-- `requested` is still `requested`, and `fulfilled` still means the partner has the material. The
-- constraint only WIDENS, so every row already in the table satisfies it — which is why the
-- validating form is safe here and `NOT VALID` would buy nothing.
--
-- ROLLBACK. Only possible while no row uses the new words:
--
--   SELECT status, count(*) FROM partner.material_orders GROUP BY status;
--   -- and only if `in_preparation` and `dispatched` return no rows:
--   ALTER TABLE partner.material_orders DROP CONSTRAINT material_orders_status_ck;
--   ALTER TABLE partner.material_orders
--     ADD CONSTRAINT material_orders_status_ck
--     CHECK (status = ANY (ARRAY['requested', 'fulfilled', 'cancelled']));
--
-- Once an order is `in_preparation` or `dispatched` the narrow constraint cannot come back
-- without deciding what those orders become, and that is a decision, not a rollback.
-- ============================================================================

ALTER TABLE partner.material_orders
  DROP CONSTRAINT IF EXISTS material_orders_status_ck;

ALTER TABLE partner.material_orders
  ADD CONSTRAINT material_orders_status_ck CHECK (
    status = ANY (ARRAY['requested', 'in_preparation', 'dispatched', 'fulfilled', 'cancelled'])
  );

COMMENT ON COLUMN partner.material_orders.status IS
  'Where the order is on the esteira: requested, in_preparation, dispatched, fulfilled, cancelled. '
  'Which move is legal from where is NOT here — it is MATERIAL_TRANSITIONS in '
  'lib/materials/order-queue.ts, and it reaches the database as the WHERE of the update.';
