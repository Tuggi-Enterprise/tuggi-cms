/**
 * Promotion of a partner proposal into the live `partner.clients` record — DS-COMPONENTE-018.
 *
 * This module is the decision, not the screen. The panel renders what `buildPromotionPlan`
 * returns and the route writes what `resolvePromotionWrite` allows; neither of them decides
 * anything on its own, so the rule exists once and a test can break it.
 *
 * THE THREE RULES, and they are the whole point:
 *
 *  1. a column that is EMPTY in the record receives the proposal's value, no question asked
 *     — there is nothing to lose;
 *  2. a column that is ALREADY EQUAL is not a decision — it leaves the list and becomes a
 *     count;
 *  3. a column that is FILLED AND DIFFERENT is NOT overwritten by default. It needs one
 *     explicit act per column. The record was written by the team; the proposal was written
 *     by somebody outside, and an external form does not get to erase internal work in
 *     silence.
 *
 * WHAT IS WRITABLE IS AN ALLOWLIST, NOT A DENYLIST. `PROMOTION_MAP` is the only source of
 * columns this feature can ever touch, so a column added to `partner.clients` tomorrow is not
 * promotable by accident. `PROMOTION_NEVER_WRITES` is not the enforcement — it is the list
 * the panel shows the operator, and `promotionAllowlistIsClosed` asserts the two never
 * overlap. Money, lifecycle and the public URL of the printed QR do not come from a form
 * filled in by a stranger.
 */

import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { normalizeLocation } from '@/lib/shared/location-normalize'

/** Columns of `partner.clients` this promotion may write. Nothing else is reachable. */
export type PromotableColumn =
  | 'name'
  | 'company_name'
  | 'tax_id'
  | 'tax_id_type'
  | 'industry'
  | 'address'
  | 'city'
  | 'state'
  | 'postal_code'
  | 'country'
  | 'website'
  | 'social_handle'
  | 'legal_representative_name'
  | 'legal_representative_role'
  | 'email'
  | 'phone'

/**
 * Where each answer lands. `source` says where the value comes from:
 *  · `field`    — one answer, verbatim;
 *  · `address`  — street, complement and district joined, which is why the panel shows the
 *                 result and not the parts;
 *  · `constant` — the form only exists in Brazil (CNPJ, alvará), so `country` is a fact of
 *                 the surface and not an answer;
 *  · `category` — the option id is English (`restaurant`); `industry` is free text read by
 *                 people, so it is promoted as the Portuguese label the partner saw, and the
 *                 operator may edit it in the panel.
 */
export type PromotionSource =
  | { kind: 'field'; field: keyof PartnerAnswers }
  | { kind: 'address' }
  | { kind: 'constant'; value: string }
  /** `country` e `state` no canônico de `location-normalize` — ver `proposedValue`. */
  | { kind: 'canonical_country' }
  | { kind: 'canonical_state' }
  | { kind: 'category' }

export interface PromotionTarget {
  column: PromotableColumn
  source: PromotionSource
  /**
   * The operator may adjust the value before it is written.
   *
   * EVERY FREE-TEXT ANSWER IS EDITABLE, and the three that are not say why on their own line
   * below. What the partner typed lands in a column with a width, and until #679 the only way
   * to make a 300-character `website` fit a `varchar(255)` was to not promote the proposal at
   * all: the INSERT came back `22001`, the screen said the write "may have happened", and the
   * proposal sat in the queue with no path out of it (BR-B2B-026, item 4 — the conference is
   * where the team fixes what the form brought).
   *
   * Editing here NEVER touches `partner.partner_form_submissions.answers`. What the partner
   * sent stays exactly as it was sent, and it is the auditable record of the proposal; this
   * flag governs the value that goes to `partner.clients` and nothing else.
   */
  editable?: boolean
}

/**
 * THE WIDTH OF EACH COLUMN OF `partner.clients`, and the only place this repository states it.
 *
 * Read off the versioned schema — `core.clients` in
 * `db-tuggiApp/supabase/migrations/20260719000000_baseline_remote_schema.sql`, moved to the
 * `partner` schema by `20260819150000_dominio_de_parceiro_muda_para_o_schema_partner.sql` with
 * `ALTER TABLE ... SET SCHEMA`, which carries the column types over untouched. No migration
 * since then alters any of these types.
 *
 * `null` is not "no limit measured": it is `text`, which has no width at all. `social_handle`
 * is the only one, and it is `text` in the baseline.
 *
 * THE SAME NUMBER SERVES THE SCREEN AND THE ROUTE (CLAUDE.md §6). The panel blocks the promote
 * button against this map and the route refuses the body against the same map — a second copy
 * of `255` is how the two start disagreeing, and a disagreement here is either a 503 the
 * operator cannot explain or a screen that blocks a value the database would have accepted.
 */
export const CLIENT_COLUMN_LIMITS: Readonly<Record<PromotableColumn, number | null>> = {
  name: 255,
  company_name: 255,
  tax_id: 50,
  tax_id_type: 20,
  industry: 100,
  address: 500,
  city: 100,
  state: 100,
  postal_code: 20,
  country: 100,
  website: 255,
  social_handle: null,
  legal_representative_name: 255,
  legal_representative_role: 100,
  email: 255,
  phone: 20,
}

export interface LengthViolation {
  column: PromotableColumn
  limit: number
  length: number
}

/**
 * Which of the values about to be written do not fit their column.
 *
 * It runs on the RESOLVED write and not on the plan, because what the operator typed is what
 * gets inserted — checking the proposal's original value would pass a promotion the database
 * then refuses, which is the whole defect of #679.
 */
export function lengthViolations(
  updates: Partial<Record<PromotableColumn, string>>
): LengthViolation[] {
  const violations: LengthViolation[] = []

  for (const [column, value] of Object.entries(updates) as [PromotableColumn, string][]) {
    const limit = CLIENT_COLUMN_LIMITS[column]
    if (limit == null || typeof value !== 'string') continue
    if (value.length > limit) violations.push({ column, limit, length: value.length })
  }

  return violations
}

/**
 * The map is the spec (§4.6 of `spec-parceria-telas-internas-2026-08.md`) in code. Order
 * matters: it is the order the panel lists the decisions in, and it follows the form.
 */
export const PROMOTION_MAP: readonly PromotionTarget[] = [
  { column: 'name', source: { kind: 'field', field: 'trade_name' }, editable: true },
  { column: 'company_name', source: { kind: 'field', field: 'legal_name' }, editable: true },
  // NOT editable, and it is the identity of the proposal. `tax_id` is what says this promotion
  // lands on THIS company: it is the duplicate control of BR-B2B-028, the key behind
  // `clients_tax_id_normalized_uk`, and the value the panel showed the operator when it offered
  // the existing record. A promotion that may retype it is a promotion that can be pointed at
  // another company than the one that filled the form, with the proposal still saying otherwise.
  { column: 'tax_id', source: { kind: 'field', field: 'tax_id' } },
  // A constant of the surface, not an answer: nothing to correct.
  { column: 'tax_id_type', source: { kind: 'constant', value: 'CNPJ' } },
  { column: 'industry', source: { kind: 'category' }, editable: true },
  { column: 'address', source: { kind: 'address' }, editable: true },
  { column: 'city', source: { kind: 'field', field: 'city' }, editable: true },
  // NOT editable: `state` and `country` are the CATALOGUE's canonical, produced by
  // `location-normalize` and not by the form — see `proposedValue`. Typed by hand they become a
  // second dialect of the same fact, and the measurement is on that function: an equality filter
  // on `country AND state AND city` returned zero for 11 of 16 clients the day the raw values
  // were written.
  { column: 'state', source: { kind: 'canonical_state' } },
  { column: 'postal_code', source: { kind: 'field', field: 'postal_code' }, editable: true },
  { column: 'country', source: { kind: 'canonical_country' } },
  { column: 'website', source: { kind: 'field', field: 'website' }, editable: true },
  { column: 'social_handle', source: { kind: 'field', field: 'instagram' }, editable: true },
  {
    column: 'legal_representative_name',
    source: { kind: 'field', field: 'representative_name' },
    editable: true,
  },
  {
    column: 'legal_representative_role',
    source: { kind: 'field', field: 'representative_role' },
    editable: true,
  },
  { column: 'email', source: { kind: 'field', field: 'representative_email' }, editable: true },
  { column: 'phone', source: { kind: 'field', field: 'representative_phone' }, editable: true },
]

/**
 * What a promotion never writes, listed for the operator to read on screen.
 *
 * It is documentation of a guarantee the allowlist above already provides — and
 * `promotionAllowlistIsClosed()` is what keeps the two honest about each other. Money,
 * lifecycle and `slug` (which changes the URL of an already printed QR) stay in the client
 * record, where the team put them.
 *
 * `is_courtesy` and `courtesy_reason` are absent from this list on purpose: they are
 * unresolved elsewhere in #341, and because the writable set is an allowlist they are
 * unreachable here either way — no decision of mine is needed to keep them out.
 */
export const PROMOTION_NEVER_WRITES = [
  'commission_rate',
  'status',
  'slug',
  'billing_email',
  'iban',
  'bic_swift',
  'bank_account_number',
  'bank_routing_number',
  'bank_name',
  'is_coordinator',
  'is_platform_owner',
  'parent_client_id',
  'welcome_poi_id',
] as const

/** True when no column the panel promises never to write is reachable by the map. */
export function promotionAllowlistIsClosed(): boolean {
  const writable = new Set<string>(PROMOTION_MAP.map((target) => target.column))
  return PROMOTION_NEVER_WRITES.every((column) => !writable.has(column))
}

/**
 * `fill` — empty here, takes the proposal's value with no act;
 * `conflict` — filled and different, needs one act of its own;
 * `same` — equal, leaves the decision list and becomes a count.
 */
export type PromotionDecision = 'fill' | 'conflict' | 'same'

export interface PromotionEntry {
  column: PromotableColumn
  decision: PromotionDecision
  /** What the client record holds today. `null` on a client that does not exist yet. */
  current: string | null
  /** What the proposal offers. Never empty — an empty offer is not a decision. */
  proposed: string
  editable: boolean
}

export interface PromotionPlan {
  /** No client id on the invite: the promotion creates the record instead of updating it. */
  creating: boolean
  /** Everything that needs to be shown: the fills and the conflicts, in map order. */
  entries: PromotionEntry[]
  /** Columns already equal — the `7 campos já estão iguais` line. */
  unchanged: PromotableColumn[]
  /** Columns the proposal has nothing to say about. Neither written nor shown. */
  absent: PromotableColumn[]
}

export interface PlanContext {
  /**
   * The Portuguese label of the chosen category, as the partner read it in
   * `PartnerForm.categories.<id>`. Absent means the category was not answered.
   */
  categoryLabel?: string | null
}

/**
 * The record to compare against. A loose bag on purpose: the caller hands over the row it
 * read, `id` and `created_at` included, and only the columns of `PROMOTION_MAP` are ever
 * looked at.
 */
type ClientRecord = Record<string, unknown> | null | undefined

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

/**
 * The address of `partner.clients` is one column and the form asks three questions. Joining
 * here — and showing the result in the panel — is the only way the operator can see what
 * will actually be written before it is written.
 */
export function joinAddress(answers: PartnerAnswers): string {
  const parts = [answers.address, answers.address_complement, answers.district]
    .map((part) => text(part))
    .filter((part) => part.length > 0)
  return parts.join(', ')
}

/**
 * `country` E `state` NO PADRÃO DO CATÁLOGO, e não como o formulário os escreve.
 *
 * O formulário responde `BR` e `RJ`; `core.attractions` guarda `Brazil` e `Rio de Janeiro`, que
 * é o canônico de `lib/shared/location-normalize` — o mesmo por onde passam a ingestão do OSM, a
 * importação do Google Places e a edição manual do POI. Gravar o cru aqui fazia dos dois lados
 * dialetos diferentes do mesmo fato, e a conta disso é medida: um filtro de igualdade em
 * `country AND state AND city` entre `partner.clients` e `core.attractions` devolvia **zero para
 * 11 dos 16 clientes** em 2026-08-23, o que apagava a busca que impede a duplicata de local.
 *
 * `city` fica como veio, e é decisão e não esquecimento: `location-normalize` canoniza país e
 * estado, e não tem — nem deveria ter — um dicionário de municípios do mundo. A comparação de
 * cidade é por `slug` (`lib/partnerships/place-scope`), que resolve `barueri` contra `Barueri`
 * sem inventar um nome oficial que ninguém conferiu.
 */
function proposedValue(target: PromotionTarget, answers: PartnerAnswers, context: PlanContext): string {
  switch (target.source.kind) {
    case 'field':
      return text(answers[target.source.field])
    case 'address':
      return joinAddress(answers)
    case 'constant':
      return target.source.value
    case 'canonical_country':
      // O formulário só existe no Brasil (CNPJ, alvará), então o país é um fato da superfície e
      // não uma resposta — mas ele entra no padrão do catálogo, não como a sigla.
      return normalizeLocation('BR', text(answers.state)).country ?? 'Brazil'
    case 'canonical_state':
      return normalizeLocation('BR', text(answers.state)).state ?? text(answers.state)
    case 'category':
      return text(context.categoryLabel)
  }
}

/**
 * Compares what the proposal offers with what the record holds and classifies every column.
 *
 * Nothing here writes and nothing here decides for the operator: a `conflict` is reported as
 * a conflict, never resolved. The comparison is on the trimmed text because a trailing space
 * is not a divergence anybody wants to be asked about.
 */
export function buildPromotionPlan(
  answers: PartnerAnswers,
  client: ClientRecord,
  context: PlanContext = {}
): PromotionPlan {
  const creating = !client
  const entries: PromotionEntry[] = []
  const unchanged: PromotableColumn[] = []
  const absent: PromotableColumn[] = []

  for (const target of PROMOTION_MAP) {
    const proposed = proposedValue(target, answers, context)
    if (!proposed) {
      absent.push(target.column)
      continue
    }

    const current = client ? text(client[target.column]) : ''

    if (current && current === proposed) {
      unchanged.push(target.column)
      continue
    }

    entries.push({
      column: target.column,
      decision: current ? 'conflict' : 'fill',
      current: current || null,
      proposed,
      editable: target.editable === true,
    })
  }

  return { creating, entries, unchanged, absent }
}

export interface PromotionRequest {
  /**
   * The columns the operator ticked. Only a `conflict` needs to be here; a `fill` is written
   * either way, and a column that is not in the plan is not written at all.
   */
  approved: readonly string[]
  /**
   * Values typed in the panel. Honoured only where the plan says the entry is editable, so a
   * body naming `state`, `country` or `tax_id` changes nothing — the decision of what may be
   * retyped is `PROMOTION_MAP`'s, on the server, and never the caller's.
   */
  overrides?: Record<string, string>
}

export interface PromotionWrite {
  /** Exactly what goes to `partner.clients`. Keys are columns of the plan and nothing else. */
  updates: Partial<Record<PromotableColumn, string>>
  written: PromotableColumn[]
  /** Conflicts the operator did not tick. Reported so the copy can count what it kept. */
  kept: PromotableColumn[]
}

/**
 * Turns a plan plus the operator's acts into the row to write.
 *
 * THE LINE THAT MATTERS is the `conflict` branch: a divergent column is written only when
 * the operator named it. Removing that condition makes the write silently overwrite work the
 * team did, which is the defect DS-COMPONENTE-018 exists to prevent — and it is the mutation
 * `tests/api/partner-proposal-admin.test.ts` performs.
 *
 * The approved list is intersected with the plan, never trusted on its own: a body naming
 * `commission_rate` cannot reach a column, because only columns the plan produced are read.
 */
export function resolvePromotionWrite(
  plan: PromotionPlan,
  request: PromotionRequest
): PromotionWrite {
  const approved = new Set<string>(request.approved ?? [])
  const overrides = request.overrides ?? {}
  const updates: Partial<Record<PromotableColumn, string>> = {}
  const written: PromotableColumn[] = []
  const kept: PromotableColumn[] = []

  for (const entry of plan.entries) {
    if (entry.decision === 'conflict' && !approved.has(entry.column)) {
      kept.push(entry.column)
      continue
    }

    const override = entry.editable ? text(overrides[entry.column]) : ''
    const value = override || entry.proposed
    updates[entry.column] = value
    written.push(entry.column)
  }

  return { updates, written, kept }
}

/**
 * The three counts the confirmation button says out loud: `Gravar 7 campos em X — 5 que
 * estavam vazios e 2 que você mandou substituir`. Derived from the same plan the panel
 * rendered, so the number on the button cannot disagree with the list above it.
 */
export function summarizePromotion(
  plan: PromotionPlan,
  request: PromotionRequest
): { total: number; filled: number; replaced: number; kept: number } {
  const write = resolvePromotionWrite(plan, request)
  const decisionOf = new Map<string, PromotionDecision>(
    plan.entries.map((entry) => [entry.column, entry.decision])
  )

  let filled = 0
  let replaced = 0
  for (const column of write.written) {
    if (decisionOf.get(column) === 'conflict') replaced += 1
    else filled += 1
  }

  return { total: write.written.length, filled, replaced, kept: write.kept.length }
}
