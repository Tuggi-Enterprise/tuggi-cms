import { getSupabaseClient } from '@/lib/core/supabase-client'

// ============================================================================
// acquisition-service — de onde vieram as contas novas.
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
