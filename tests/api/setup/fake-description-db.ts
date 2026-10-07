/**
 * A stateful fake of the part of `core` that the partner place description (#888) touches:
 * `cms_place_description_facts`, `cms_apply_name_only_description` and the pt/male row of
 * `core.attraction_descriptions`. Used by the tests that exercise the REAL service
 * (`applyPartnerPlaceDescription`) end to end, so a case proves what was left in the row, not
 * which function was called.
 *
 * What it models, from the service's own documentation (the SQL lives in tuggi-hoteis-free
 * `db-tuggiApp`, not here, and nothing in these tests reaches a real database):
 *  - facts RPC: one row; `base_*` mirror the stored row;
 *  - name-only RPC: no row → writes the name (`partner_name_only`) = `written`; same name already
 *    there → `unchanged`; any other row → `blocked` and untouched;
 *  - `upsert(..., { ignoreDuplicates: true })` = INSERT ... ON CONFLICT DO NOTHING;
 *  - `update(...).eq(...)` only touches the row when EVERY filter holds, including the
 *    `generation_meta->>kind` one — that conditional is the do-not-clobber guard.
 */

export interface DescRow {
  description: string
  audio_url: string | null
  verification_status?: string
  generation_meta: { kind?: string } | null
  language?: string
  gender?: string
}

export interface DescWorld {
  name: string
  partnerClientId: string | null
  monthlyFeeCents: number | null
  contractTier: string | null
  planChoice: string | null
  exceptionAt: string | null
  /** The stored pt/male row, or null. */
  row: DescRow | null
  rpcs: { name: string; args: Record<string, unknown> }[]
  /** Every write that reached `attraction_descriptions`, in order. */
  writes: { op: 'upsert' | 'update'; values: Record<string, unknown> }[]
  /** `facts` | `name_only` | `upsert` | `update` — the step that answers with an error. */
  failAt: null | 'facts' | 'name_only' | 'upsert' | 'update'
}

export function freshDescWorld(over: Partial<DescWorld> = {}): DescWorld {
  return {
    name: 'Bar do Zé',
    partnerClientId: '33333333-3333-4333-8333-333333333333',
    monthlyFeeCents: null,
    contractTier: null,
    planChoice: null,
    exceptionAt: null,
    row: null,
    rpcs: [],
    writes: [],
    failAt: null,
    ...over,
  }
}

const err = (message: string) => ({ data: null, error: { message } })

export function descriptionTable(w: DescWorld) {
  let op: 'upsert' | 'update' | null = null
  let values: Record<string, unknown> = {}
  let ignoreDuplicates = false
  const filters: [string, unknown][] = []
  const q: any = {
    upsert: (v: Record<string, unknown>, opts?: { ignoreDuplicates?: boolean }) => {
      op = 'upsert'
      values = v
      ignoreDuplicates = opts?.ignoreDuplicates === true
      return q
    },
    update: (v: Record<string, unknown>) => {
      op = 'update'
      values = v
      return q
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value])
      return q
    },
    select: () => q,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      w.writes.push({ op: op!, values })
      if (w.failAt === op) return Promise.resolve(err(`${op} failed`)).then(resolve, reject)
      let touched = false
      if (op === 'upsert') {
        // ON CONFLICT DO NOTHING is the only mode the code may use.
        if (!ignoreDuplicates) throw new Error('upsert without ignoreDuplicates would overwrite')
        if (!w.row) {
          w.row = values as unknown as DescRow
          touched = true
        }
      } else if (w.row) {
        const kind = w.row.generation_meta?.kind
        const holds = filters.every(([column, value]) => {
          if (column === 'generation_meta->>kind') return kind === value
          if (column === 'language') return (w.row!.language ?? 'pt-br') === value
          if (column === 'gender') return (w.row!.gender ?? 'male') === value
          return true
        })
        if (holds) {
          w.row = values as unknown as DescRow
          touched = true
        }
      }
      return Promise.resolve({ data: touched ? [{ id: 'row-1' }] : [], error: null }).then(resolve, reject)
    },
  }
  return q
}

export async function descriptionRpc(w: DescWorld, name: string, args: Record<string, unknown>) {
  w.rpcs.push({ name, args })
  if (name === 'cms_place_description_facts') {
    if (w.failAt === 'facts') return err('facts failed')
    return {
      data: [
        {
          attraction_id: args.p_attraction_id,
          name: w.name,
          city: 'Búzios',
          entity_kind: 'bar',
          partner_client_id: w.partnerClientId,
          exception_at: w.exceptionAt,
          exception_by: null,
          exception_reason: w.exceptionAt ? 'cortesia combinada' : null,
          monthly_fee_cents: w.monthlyFeeCents,
          is_courtesy: false,
          courtesy_reason: null,
          plan_choice: w.planChoice,
          contract_tier: w.contractTier,
          proposal_answers: null,
          base_description: w.row?.description ?? null,
          base_has_audio: !!w.row?.audio_url,
          base_generation_kind: w.row?.generation_meta?.kind ?? null,
        },
      ],
      error: null,
    }
  }
  if (name === 'cms_apply_name_only_description') {
    if (w.failAt === 'name_only') return err('rpc failed')
    if (!w.row) {
      w.row = {
        description: w.name,
        audio_url: null,
        verification_status: 'approved',
        generation_meta: { kind: 'partner_name_only' },
      }
      return { data: 'written', error: null }
    }
    if (w.row.generation_meta?.kind === 'partner_name_only' && w.row.description === w.name) {
      return { data: 'unchanged', error: null }
    }
    return { data: 'blocked', error: null }
  }
  return { data: null, error: { message: `unexpected rpc ${name}` } }
}

/** The operator's session client, for the tests that need nothing else from it. */
export function createDescriptionOperator(w: DescWorld, extraFrom?: (table: string) => unknown): any {
  return {
    schema: () => ({
      from: (table: string) =>
        table === 'attraction_descriptions' ? descriptionTable(w) : extraFrom ? extraFrom(table) : undefined,
      rpc: (name: string, args: Record<string, unknown>) => descriptionRpc(w, name, args),
    }),
  }
}
