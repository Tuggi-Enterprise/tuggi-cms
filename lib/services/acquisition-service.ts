import { getSupabaseClient } from '@/lib/core/supabase-client'
import { monthBounds, STORES, type StoreKey, parseAcquisitionFunnel, type AcquisitionFunnel } from '@/lib/acquisition/funnel'
import {
  parseRankApps,
  parseRankDays,
  parseRankKeywords,
  parseStoreCountryDays,
  readAllPages,
  type PagedState,
  type RankApp,
  type RankDay,
  type RankKeyword,
  type StoreCountryDay,
  type TableBounds,
} from '@/lib/acquisition/aso'

// ============================================================================
// acquisition-service — de onde vieram os usuários novos, com conta ou convidado.
//
// Lê core.dashboard_acquisition(), que é a única porta de saída de
// core.profile_origin e core.origin_cluster (ambas com RLS e sem policy).
// O recorte por parceiro e o k-anonimato dos clusters ficam na RPC, nunca aqui:
// filtro no cliente não é controle de acesso.
//
// A origem de cada conta é a primeira posição registrada em
// drive.user_location_history, gravada quando a permissão de localização é
// concedida — não é a última posição conhecida, que muda quando o usuário
// reloga.
// ============================================================================

/** Estados de origem. Nunca somar `located` com os outros dois: as causas diferem. */
export type OriginStatus = 'located' | 'outside_boundaries' | 'without_origin'

export interface AcquisitionSummary {
  total: number
  withPartner: number
  /** coordenada resolvida em um município importado */
  located: number
  /** tem coordenada, mas o município não está em core.city_boundaries */
  outsideBoundaries: number
  /** sem coordenada nenhuma */
  withoutOrigin: number
  fromFallback: number
  distinctCities: number
  distinctCountries: number
  inClusters: number
  /** origens gravadas em até 1 h da criação da conta — a régua de confiança */
  originWithin1h: number
  daysElapsed: number
}

export interface AcquisitionDay {
  day: string
  total: number
  withPartner: number
  cumulative: number
}

export interface AcquisitionCity {
  city: string
  country: string
  status: OriginStatus
  total: number
  withPartner: number
}

/**
 * Estados de país. `unidentified` é lacuna de catálogo, não ausência de origem:
 * core.city_boundaries só tem sete países em admin_level=2 (Argentina, Brasil,
 * México, Portugal, Espanha, EUA, Uruguai). Importar os ~200 polígonos do mundo
 * resolveria o país de toda conta com coordenada.
 */
export type CountryStatus = 'identified' | 'unidentified' | 'without_origin'

export interface AcquisitionCountry {
  country: string
  status: CountryStatus
  total: number
  withPartner: number
  ios: number
  android: number
}

export interface AcquisitionPlatform {
  /** 'ios' | 'android' | '' quando o primeiro ping não registrou plataforma */
  platform: string
  total: number
  withPartner: number
}

export interface AcquisitionPartner {
  partnerId: string
  name: string
  total: number
}

export interface AcquisitionCluster {
  label: string
  labelSource: 'event_trigger_point' | 'partner' | 'none'
  total: number
  withPartner: number
  firstSeen: string
  lastSeen: string
  lat: number | null
  lng: number | null
  /** true quando o k-anonimato suprimiu a coordenada para este chamador */
  coordinateSuppressed: boolean
}

export interface AcquisitionData {
  month: string
  /** true quando a resposta veio recortada pelo escopo do chamador */
  scoped: boolean
  summary: AcquisitionSummary
  daily: AcquisitionDay[]
  cities: AcquisitionCity[]
  countries: AcquisitionCountry[]
  platforms: AcquisitionPlatform[]
  partners: AcquisitionPartner[]
  clusters: AcquisitionCluster[]
}

const n = (v: unknown) => Number(v ?? 0)

// A janela de cobertura da origem e as réguas de leitura vivem em
// lib/acquisition/split.ts, que é TS puro e coberto por testes.

export interface StoreCountriesRead {
  jobFrom: Record<StoreKey, string | null>
  bounds: Record<StoreKey, TableBounds>
  days: StoreCountryDay[]
  state: PagedState
}

export interface StoreRankSetup {
  keywords: RankKeyword[]
  apps: RankApp[]
  jobFrom: string | null
}

export interface StoreRankRead {
  days: RankDay[]
  bounds: Record<StoreKey, TableBounds>
  state: PagedState
}

/** `covered_from` of collector jobs, by job; a job with no row is absent. */
async function jobFrom(jobs: string[]): Promise<Record<string, string | null>> {
  const { data, error } = await getSupabaseClient().schema('social').from('collector_runs').select('job, covered_from').in('job', jobs)
  if (error) throw error
  const out: Record<string, string | null> = {}
  for (const r of (data ?? []) as { job: string; covered_from: string | null }[]) out[r.job] = typeof r.covered_from === 'string' ? r.covered_from.slice(0, 10) : null
  return out
}

/** The first row ever and the last row up to `last` of one store in a table, optionally for some keywords: two one-row reads (spec §10.2). */
async function tableBounds(table: 'store_country_daily' | 'store_rank_daily', store: StoreKey, last: string, keywordIds?: string[]): Promise<TableBounds> {
  const social = getSupabaseClient().schema('social')
  const base = () => {
    const q = social.from(table).select('day').eq('store', store)
    return keywordIds ? q.in('keyword_id', keywordIds) : q
  }
  const [a, b] = await Promise.all([base().order('day', { ascending: true }).limit(1), base().lte('day', last).order('day', { ascending: false }).limit(1)])
  if (a.error) throw a.error
  if (b.error) throw b.error
  const day = (rows: unknown) => {
    const v = Array.isArray(rows) ? (rows[0] as { day?: unknown } | undefined)?.day : undefined
    return typeof v === 'string' ? v.slice(0, 10) : null
  }
  return { first: day(a.data), last: day(b.data) }
}

/** The code or message of a failed read, for the log: never the row. */
const failure = (error: unknown): string => {
  const e = error as { code?: string; message?: string } | null
  return e?.code ?? e?.message ?? 'unknown'
}

export const acquisitionService = {
  /** Um mês de aquisição. `month` no formato YYYY-MM-DD (primeiro dia). */
  async get(
    month: string,
    ownerId?: string
  ): Promise<{ success: boolean; data?: AcquisitionData; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .schema('core')
        .rpc('dashboard_acquisition', { p_month: month, p_owner_id: ownerId || null })

      if (error) throw error
      const raw = (data || {}) as any
      const s = raw.summary || {}

      return {
        success: true,
        data: {
          month: raw.month,
          scoped: Boolean(raw.scoped),
          summary: {
            total: n(s.total),
            withPartner: n(s.with_partner),
            located: n(s.located),
            outsideBoundaries: n(s.outside_boundaries),
            withoutOrigin: n(s.without_origin),
            fromFallback: n(s.from_fallback),
            distinctCities: n(s.distinct_cities),
            distinctCountries: n(s.distinct_countries),
            inClusters: n(s.in_clusters),
            originWithin1h: n(s.origin_within_1h),
            daysElapsed: n(s.days_elapsed),
          },
          daily: (raw.daily || []).map((d: any) => ({
            day: d.day,
            total: n(d.total),
            withPartner: n(d.with_partner),
            cumulative: n(d.cumulative),
          })),
          cities: (raw.cities || []).map((c: any) => ({
            city: c.city || '',
            country: c.country || '',
            status: c.status as OriginStatus,
            total: n(c.total),
            withPartner: n(c.with_partner),
          })),
          countries: (raw.countries || []).map((c: any) => ({
            country: c.country || '',
            status: c.status as CountryStatus,
            total: n(c.total),
            withPartner: n(c.with_partner),
            ios: n(c.ios),
            android: n(c.android),
          })),
          platforms: (raw.platforms || []).map((p: any) => ({
            platform: p.platform || '',
            total: n(p.total),
            withPartner: n(p.with_partner),
          })),
          partners: (raw.partners || []).map((p: any) => ({
            partnerId: p.partner_id,
            name: p.name || '',
            total: n(p.total),
          })),
          clusters: (raw.clusters || []).map((c: any) => ({
            label: c.label || '',
            labelSource: c.label_source,
            total: n(c.total),
            withPartner: n(c.with_partner),
            firstSeen: c.first_seen,
            lastSeen: c.last_seen,
            lat: c.lat ?? null,
            lng: c.lng ?? null,
            coordinateSuppressed: Boolean(c.coordinate_suppressed),
          })),
        },
      }
    } catch (error: any) {
      console.error('Error fetching acquisition:', error?.message || error)
      return { success: false, error: error?.message || 'Unknown error' }
    }
  },

  /**
   * The acquisition funnel of a month (#1171): stores, website and search, from
   * `social.acquisition_funnel` (contract banco-para-cms Parte 28). Admin only, by the RLS of `social.*`;
   * the reading of `null` lives in `lib/acquisition/funnel.ts`.
   */
  async getFunnel(month: string): Promise<{ success: boolean; data?: AcquisitionFunnel; error?: string }> {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.schema('social').rpc('acquisition_funnel', { p_month: month })
    if (error) {
      console.error('Error fetching acquisition funnel:', error.code ?? error.message)
      return { success: false, error: error.message }
    }
    return { success: true, data: parseAcquisitionFunnel(data) }
  },

  /**
   * Stores by country of a month (#1309): every row of `social.store_country_daily` in the month, paged,
   * plus the bounds of each store in the table and the `covered_from` of its job (contract banco-para-cms
   * Parte 31). `state` is `incomplete` when a page failed after the first: the screen draws nothing then.
   */
  async getStoreCountries(month: string): Promise<{ success: boolean; data?: StoreCountriesRead; error?: string }> {
    const supabase = getSupabaseClient()
    const social = supabase.schema('social')
    const { first, last } = monthBounds(month)
    try {
      const [jobs, bounds, paged] = await Promise.all([
        jobFrom(['apple_store', 'play']),
        Promise.all(STORES.map((store) => tableBounds('store_country_daily', store, last))),
        readAllPages((from, to) =>
          social
            .from('store_country_daily')
            .select('day, store, country, impressions, page_views, downloads', { count: 'exact' })
            .gte('day', first)
            .lte('day', last)
            .order('day')
            .order('store')
            .order('country')
            .range(from, to)
        ),
      ])
      if (paged.state === 'failed') throw new Error('store_country_daily failed')
      return {
        success: true,
        data: {
          jobFrom: { app_store: jobs.apple_store ?? null, play_store: jobs.play ?? null },
          bounds: { app_store: bounds[0], play_store: bounds[1] },
          days: parseStoreCountryDays(paged.rows),
          state: paged.state,
        },
      }
    } catch (error: unknown) {
      console.error('Error fetching store countries:', failure(error))
      return { success: false, error: failure(error) }
    }
  },

  /** The search tracker's lists (#1309): keywords, apps and the `covered_from` of the `store_rank` job. */
  async getStoreRankSetup(): Promise<{ success: boolean; data?: StoreRankSetup; error?: string }> {
    const social = getSupabaseClient().schema('social')
    try {
      const [keywords, apps, jobs] = await Promise.all([
        social.from('store_rank_keywords').select('id, keyword, country, active'),
        social.from('store_rank_apps').select('id, store, name, is_own'),
        jobFrom(['store_rank']),
      ])
      if (keywords.error) throw keywords.error
      if (apps.error) throw apps.error
      return { success: true, data: { keywords: parseRankKeywords(keywords.data), apps: parseRankApps(apps.data), jobFrom: jobs.store_rank ?? null } }
    } catch (error: unknown) {
      console.error('Error fetching store rank setup:', failure(error))
      return { success: false, error: failure(error) }
    }
  },

  /**
   * The search position of a month for the keywords of one country (#1309): `social.store_rank_daily`
   * filtered by month and keyword ids on the server, paged to the end, plus each store's bounds for
   * those keywords. The month passes the 1,000-row cap of PostgREST (spec §10).
   */
  async getStoreRank(month: string, keywordIds: string[]): Promise<{ success: boolean; data?: StoreRankRead; error?: string }> {
    if (keywordIds.length === 0) {
      const empty = { first: null, last: null }
      return { success: true, data: { days: [], bounds: { app_store: empty, play_store: empty }, state: 'complete' } }
    }
    const social = getSupabaseClient().schema('social')
    const { first, last } = monthBounds(month)
    try {
      const [bounds, paged] = await Promise.all([
        Promise.all(STORES.map((store) => tableBounds('store_rank_daily', store, last, keywordIds))),
        readAllPages((from, to) =>
          social
            .from('store_rank_daily')
            .select('day, store, keyword_id, app_id, position, results_read', { count: 'exact' })
            .gte('day', first)
            .lte('day', last)
            .in('keyword_id', keywordIds)
            .order('day')
            .order('store')
            .order('keyword_id')
            .order('app_id')
            .range(from, to)
        ),
      ])
      if (paged.state === 'failed') throw new Error('store_rank_daily failed')
      return { success: true, data: { days: parseRankDays(paged.rows), bounds: { app_store: bounds[0], play_store: bounds[1] }, state: paged.state } }
    } catch (error: unknown) {
      console.error('Error fetching store rank:', failure(error))
      return { success: false, error: failure(error) }
    }
  },

  /** Meses com dados, do mais recente para o mais antigo. Popula o filtro. */
  async getMonths(): Promise<{ success: boolean; data?: string[]; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.schema('core').rpc('dashboard_acquisition_months')
      if (error) throw error
      return { success: true, data: (data || []) as string[] }
    } catch (error: any) {
      console.error('Error fetching acquisition months:', error?.message || error)
      return { success: false, error: error?.message || 'Unknown error' }
    }
  },
}

export default acquisitionService
