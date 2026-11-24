/**
 * Reads and writes of the Tuggi do parceiro in the CMS (#1257; contract
 * `docs/contracts/tuggi-do-parceiro.md` §5). Server only: every function runs on the service role,
 * after `withAuth({ roles: ['admin'] })` proved an active CMS admin. `partner.*` exists for the
 * service role alone (no USAGE for anon or authenticated).
 *
 * - Queue: `partner.partner_brands` with `logo_status = 'pending'`, oldest first, each logo signed
 *   from the private bucket `partner-logos` (`createSignedUrls`; `getPublicUrl` does not serve).
 * - Decision: `partner.cms_decide_partner_logo` with the CMS user as `p_actor`; `TGB71` = the file
 *   is not the pending one any more.
 * - Pilot: upsert on `client_id` that writes the two pilot columns only.
 * - Settings: the term from `drive.reward_settings_map`, the three switches from
 *   `drive.cms_get_trip_settings` (the read that already serves every switch to the CMS; only the
 *   three of this product leave this module), the packages from `partner.gift_day_packages`.
 *   The term and the switches are written by the routes that already own those writes
 *   (`/api/admin/reward-settings`, `/api/admin/trip-reminder/switches`).
 *
 * The Wi-Fi of the brand row is never selected here (BR-B2B-070 item 6.b). Logs carry the SQLSTATE
 * only, never a row.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BRAND_TERM_KEY,
  LOGO_SIGNED_URL_TTL_S,
  PARTNER_LOGO_BUCKET,
  classifyPartnerBrandError,
  pickPartnerSwitches,
  type ClientBrand,
  type GiftPackage,
  type LogoDecision,
  type PackagePrice,
  type PartnerBrandError,
  type PartnerBrandSettings,
  type PendingLogo,
  type PilotWindow,
} from '@/lib/partner-brand/brand'

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: PartnerBrandError }

/** Never larger than a handful; the cap keeps a runaway queue bounded. */
const QUEUE_LIMIT = 200

const BRAND_COLUMNS =
  'client_id, logo_path, logo_status, logo_submitted_at, logo_decided_at, logo_rejection_reason, approved_logo_path, pilot_starts_at, pilot_ends_at, gift_days'

const failed = (code: PartnerBrandError['code']): { ok: false; error: PartnerBrandError } => ({ ok: false, error: { code } })

/** Signs each path once; a path the storage refused comes back without a URL (the card says so). */
async function signLogos(db: SupabaseClient, paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))]
  const urls = new Map<string, string>()
  if (unique.length === 0) return urls
  const signed = await db.storage.from(PARTNER_LOGO_BUCKET).createSignedUrls(unique, LOGO_SIGNED_URL_TTL_S)
  if (signed.error) console.error('[partner-brand] sign failed')
  for (const s of signed.data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
  return urls
}

export async function listPendingLogos(db: SupabaseClient): Promise<Outcome<PendingLogo[]>> {
  const { data, error } = await db
    .schema('partner')
    .from('partner_brands')
    .select('client_id, logo_path, logo_submitted_at, approved_logo_path, client:clients(name)')
    .eq('logo_status', 'pending')
    .order('logo_submitted_at', { ascending: true })
    .limit(QUEUE_LIMIT)
  if (error) {
    console.error('[partner-brand] queue refused:', error.code)
    return failed('read_failed')
  }
  const rows = (data ?? []) as unknown as {
    client_id: string
    logo_path: string
    logo_submitted_at: string | null
    approved_logo_path: string | null
    client: { name: string | null } | { name: string | null }[] | null
  }[]
  const urls = await signLogos(db, rows.flatMap((r) => [r.logo_path, r.approved_logo_path]))
  return {
    ok: true,
    value: rows.map((r) => {
      const client = Array.isArray(r.client) ? r.client[0] : r.client
      return {
        client_id: r.client_id,
        client_name: client?.name ?? null,
        logo_path: r.logo_path,
        logo_submitted_at: r.logo_submitted_at,
        logo_url: urls.get(r.logo_path) ?? null,
        approved_logo_path: r.approved_logo_path,
        approved_logo_url: r.approved_logo_path ? (urls.get(r.approved_logo_path) ?? null) : null,
      }
    }),
  }
}

/** The brand row of one client, or an empty one when nothing was saved yet. */
export async function loadClientBrand(db: SupabaseClient, clientId: string): Promise<Outcome<ClientBrand>> {
  const { data, error } = await db.schema('partner').from('partner_brands').select(BRAND_COLUMNS).eq('client_id', clientId).maybeSingle()
  if (error) {
    console.error('[partner-brand] brand read refused:', error.code)
    return failed('read_failed')
  }
  const row = (data ?? null) as Omit<ClientBrand, 'logo_url' | 'approved_logo_url'> | null
  if (!row) {
    return {
      ok: true,
      value: {
        client_id: clientId,
        logo_path: null,
        logo_status: null,
        logo_submitted_at: null,
        logo_decided_at: null,
        logo_rejection_reason: null,
        logo_url: null,
        approved_logo_path: null,
        approved_logo_url: null,
        pilot_starts_at: null,
        pilot_ends_at: null,
        gift_days: null,
      },
    }
  }
  const urls = await signLogos(db, [row.logo_path, row.approved_logo_path])
  return {
    ok: true,
    value: {
      ...row,
      logo_url: row.logo_path ? (urls.get(row.logo_path) ?? null) : null,
      approved_logo_url: row.approved_logo_path ? (urls.get(row.approved_logo_path) ?? null) : null,
    },
  }
}

export async function decideLogo(db: SupabaseClient, decision: LogoDecision, actor: string): Promise<Outcome<Record<string, unknown>>> {
  const { data, error } = await db.schema('partner').rpc('cms_decide_partner_logo', {
    p_client_id: decision.client_id,
    p_logo_path: decision.logo_path,
    p_approve: decision.approve,
    p_reason: decision.reason,
    p_actor: actor,
  })
  if (error) {
    console.error('[partner-brand] decision refused:', error.code)
    return { ok: false, error: classifyPartnerBrandError(error) }
  }
  return { ok: true, value: (data ?? {}) as Record<string, unknown> }
}

/** Insert or update of the two pilot columns only; the rest of the row is the portal's. */
export async function savePilot(db: SupabaseClient, clientId: string, pilot: PilotWindow): Promise<Outcome<PilotWindow>> {
  const { data, error } = await db
    .schema('partner')
    .from('partner_brands')
    .upsert({ client_id: clientId, ...pilot }, { onConflict: 'client_id' })
    .select('pilot_starts_at, pilot_ends_at')
    .maybeSingle()
  if (error || !data) {
    console.error('[partner-brand] pilot write refused:', error?.code ?? 'no row')
    return { ok: false, error: error ? classifyPartnerBrandError(error) : { code: 'write_failed' } }
  }
  return { ok: true, value: data as PilotWindow }
}

export async function readBrandSettings(db: SupabaseClient): Promise<Outcome<PartnerBrandSettings>> {
  const [map, trip, packages] = await Promise.all([
    db.schema('drive').rpc('reward_settings_map'),
    db.schema('drive').rpc('cms_get_trip_settings'),
    db.schema('partner').from('gift_day_packages').select('days, price_cents, price_currency').order('days', { ascending: true }),
  ])
  if (map.error || trip.error || packages.error) {
    console.error('[partner-brand] settings read refused:', map.error?.code ?? '-', trip.error?.code ?? '-', packages.error?.code ?? '-')
    return failed('read_failed')
  }
  const raw = (map.data as Record<string, unknown> | null)?.[BRAND_TERM_KEY]
  const term = typeof raw === 'number' ? raw : raw === undefined || raw === null ? Number.NaN : Number(raw)
  return {
    ok: true,
    value: {
      term_days: Number.isFinite(term) ? term : null,
      switches: pickPartnerSwitches((trip.data as { switches?: unknown } | null)?.switches),
      packages: (packages.data ?? []) as GiftPackage[],
    },
  }
}

export async function savePackagePrice(db: SupabaseClient, price: PackagePrice): Promise<Outcome<GiftPackage>> {
  const { data, error } = await db
    .schema('partner')
    .from('gift_day_packages')
    .update({ price_cents: price.price_cents, price_currency: price.price_currency })
    .eq('days', price.days)
    .select('days, price_cents, price_currency')
    .maybeSingle()
  if (error) {
    console.error('[partner-brand] price write refused:', error.code)
    return { ok: false, error: classifyPartnerBrandError(error) }
  }
  // The effect is the proof: no row back means no package of that length.
  if (!data) return failed('package_not_found')
  return { ok: true, value: data as GiftPackage }
}
