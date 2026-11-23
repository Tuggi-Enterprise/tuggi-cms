/**
 * The CMS view of `drive.reward_settings` (#854/#855): every number of earned hours.
 *
 * The database is the owner of the VALUE, the UNIT and the range (`reward_settings_value_ck`
 * and the per-act cap inside `drive.set_reward_setting`). This module owns only what the
 * table does not carry in pt-BR: the program a key belongs to, a readable name, and the rule
 * that a program cites. The key set changes by migration (#836 replaced the seven km steps by
 * one repeating step), so names are derived from the key's SHAPE, never from a fixed list: a
 * key nobody named here still shows up, under its raw key, and still saves.
 *
 * `validateRewardValue` mirrors `reward_settings_value_ck` so the operator learns before the
 * confirmation, not after it. The database stays the judge — its refusal is shown as is.
 */

export type RewardUnit = 'minutes' | 'days' | 'months' | 'count' | 'points' | 'meters' | 'miles'

export interface RewardSetting {
  key: string
  value: number
  /** `null` only when no read returned it (a key added after this screen's last deploy). */
  unit: RewardUnit | null
  /** The `rule_id` column, when the read carries it (`drive.cms_get_trip_settings`); else `ruleOf`. */
  rule_id?: string | null
}

export interface RewardSettingsEnvelope {
  /** `max(updated_at)` of the values the app reads; `null` when the RPC did not say. */
  updated_at: string | null
  settings: RewardSetting[]
}

/** Same shape `reward_settings_key_ck` enforces. */
export const REWARD_KEY_RE = /^[a-z0-9_]+(\.[a-z0-9_:]+)+$/

const UNITS: readonly RewardUnit[] = ['minutes', 'days', 'months', 'count', 'points', 'meters', 'miles']

export function isRewardUnit(value: unknown): value is RewardUnit {
  return typeof value === 'string' && (UNITS as readonly string[]).includes(value)
}

/** The keys `drive.get_reward_settings` hides from the app; the CMS reads them by the map. */
export const SERVER_ONLY_PREFIX = 'podium.'

/** Units of the server-only keys, which `get_reward_settings` does not serve. */
const SERVER_ONLY_UNITS: Record<string, RewardUnit> = {
  'podium.max_points_per_day': 'points',
  'podium.min_trips': 'count',
}

/**
 * Joins the two reads: `get_reward_settings` (value + unit, all but `podium.*`) and
 * `reward_settings_map` (value of every key). The map wins on value — it is the whole table.
 */
export function mergeRewardReads(
  appRead: { updated_at?: unknown; settings?: unknown } | null,
  fullMap: Record<string, unknown> | null
): RewardSettingsEnvelope {
  const served =
    appRead?.settings && typeof appRead.settings === 'object'
      ? (appRead.settings as Record<string, { value?: unknown; unit?: unknown }>)
      : {}
  const keys = new Set([...Object.keys(served), ...Object.keys(fullMap ?? {})])
  const settings: RewardSetting[] = []
  for (const key of keys) {
    const raw = fullMap?.[key] ?? served[key]?.value
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(value)) continue
    const unit = served[key]?.unit
    settings.push({
      key,
      value,
      unit: isRewardUnit(unit) ? unit : (SERVER_ONLY_UNITS[key] ?? null),
    })
  }
  settings.sort((a, b) => compareRewardKeys(a.key, b.key))
  return {
    updated_at: typeof appRead?.updated_at === 'string' ? appRead.updated_at : null,
    settings,
  }
}

// ── Programs ─────────────────────────────────────────────────────────────────────────────

export type RewardProgram =
  | 'welcome'
  | 'planned_trip'
  | 'stamps'
  | 'missions'
  | 'profile'
  | 'podium'
  | 'validity'
  | 'warnings'
  | 'other'

export const PROGRAM_ORDER: readonly RewardProgram[] = [
  'welcome',
  'planned_trip',
  'stamps',
  'missions',
  'profile',
  'podium',
  'validity',
  'warnings',
  'other',
]

export const PROGRAM_LABEL: Record<RewardProgram, string> = {
  welcome: 'Boas-vindas',
  planned_trip: 'Viagem marcada',
  stamps: 'Stamps (convites)',
  missions: 'Missões',
  profile: 'Perfil',
  podium: 'Pódio',
  validity: 'Validade',
  warnings: 'Avisos de saldo',
  other: 'Outros',
}

/** The rule each program cites — the `rule_id` column, by program (#854 seed). */
const PROGRAM_RULE: Record<RewardProgram, string | null> = {
  welcome: 'BR-MONETIZACAO-058',
  planned_trip: 'BR-MONETIZACAO-091',
  stamps: 'BR-MONETIZACAO-085',
  missions: 'BR-MONETIZACAO-088',
  profile: 'BR-USUARIO-047',
  podium: 'BR-RANKING-011',
  validity: 'BR-MONETIZACAO-086',
  warnings: 'BR-MONETIZACAO-090',
  other: null,
}

export function programOf(key: string): RewardProgram {
  if (key.startsWith('welcome.')) return 'welcome'
  if (key.startsWith('planned_trip.')) return 'planned_trip'
  if (key === 'referral.validity_days') return 'validity'
  if (key.startsWith('referral.')) return 'stamps'
  if (key.startsWith('earned_credit.')) return 'validity'
  if (key.startsWith('wallet.') || key.startsWith('balance_warning.')) return 'warnings'
  if (key.startsWith('mission.profile_')) return 'profile'
  if (key.startsWith('mission.weekly_podium.') || key.startsWith('podium.')) return 'podium'
  if (key.startsWith('mission.')) return 'missions'
  return 'other'
}

export function ruleOf(key: string): string | null {
  if (key.startsWith('wallet.')) return 'BR-MONETIZACAO-089'
  // Both validities are BR-MONETIZACAO-086 (items 2.c and 2.d), not the program's rule.
  if (key === 'welcome.validity_days' || key === 'planned_trip.validity_days') return 'BR-MONETIZACAO-086'
  return PROGRAM_RULE[programOf(key)]
}

const NAMED: Record<string, string> = {
  'welcome.minutes': 'Horas de boas-vindas',
  'welcome.validity_days': 'Validade das boas-vindas',
  // BR-MONETIZACAO-091 2.a: one amount per length band; the band names are the app's (copy #1236).
  'planned_trip.minutes_short': 'Hora de viagem: até 3 dias',
  'planned_trip.minutes_week': 'Hora de viagem: de 4 a 7 dias',
  'planned_trip.minutes_long': 'Hora de viagem: mais de 7 dias',
  'planned_trip.lead_days': 'Dias antes da viagem: lembrete e liberação da hora',
  'planned_trip.validity_days': 'Validade da hora de viagem',
  'planned_trip.interval_months': 'Intervalo mínimo entre duas liberações',
  'referral.inviter_minutes': 'Quem convida ganha (por amigo ativado)',
  'referral.friend_total_minutes': 'O amigo convidado completa até',
  'referral.stamp_cap': 'Teto de stamps por pessoa (vida toda)',
  'referral.redeem_window_days': 'Código aceito em conta com até',
  'referral.validity_days': 'Validade das horas de convite',
  // The welcome grant reads `welcome.validity_days` since #1230; this one is the missions'.
  'earned_credit.validity_days': 'Validade das horas ganhas em missões',
  'earned_credit.expiry_warning_days': 'Avisar vencimento com antecedência de',
  'wallet.low_floor_minutes': 'Piso da carteira saudável',
  'balance_warning.push_minutes': 'Push de saldo baixo ao restar',
  'balance_warning.push_cooldown_days': 'Intervalo mínimo entre pushes de saldo',
  'balance_warning.map_banner_minutes': 'Faixa no mapa abaixo de',
  'mission.profile_field.minutes': 'Cada pergunta do perfil respondida',
  'mission.profile_complete.minutes': 'Perfil completo (todas as perguntas)',
  'mission.first_trip.minutes': 'Primeira viagem encerrada',
  'mission.cities_milestone.minutes': 'Marco de cidades: prêmio',
  'podium.max_points_per_day': 'Antiabuso: pontos por dia acima disto vão para revisão',
  'podium.min_trips': 'Antiabuso: viagens na semana para receber prêmio',
}

/**
 * A help line shown under a parameter, where a value has a consequence the number does not tell.
 * `welcome.validity_days`: the eve warning exists only for a grant that lives up to the short
 * grant ceiling of BR-COMUNICACAO-019 3.h.2 (that ceiling is the rule's, not a key).
 */
const HINTS: Record<string, string> = {
  'welcome.validity_days': 'Acima de 5 dias, as boas-vindas perdem o aviso da véspera.',
  'planned_trip.minutes_short': 'Vale também para a viagem sem duração informada.',
  'planned_trip.interval_months': '0 é sem intervalo: toda viagem ganha a sua hora.',
}

export function hintOf(key: string): string | null {
  return HINTS[key] ?? null
}

const BAND_RANK: Record<string, number> = { short: 1, week: 2, long: 3 }
const BAND_KEY_RE = /^planned_trip\.minutes_(short|week|long)$/

/**
 * Reading order of the keys: alphabetical, except the three trip length bands, which read from the
 * shortest trip to the longest (BR-MONETIZACAO-091 2.a) instead of long, short, week.
 */
export function compareRewardKeys(a: string, b: string): number {
  const readable = (key: string) => key.replace(BAND_KEY_RE, (_, band: string) => `planned_trip.minutes_${BAND_RANK[band]}`)
  return readable(a).localeCompare(readable(b))
}

const SUFFIX: Record<string, string> = {
  minutes: 'prêmio',
  threshold: 'limiar',
  threshold_mi: 'limiar (contas em milhas)',
}

/** A readable name; the raw key when the shape is unknown, so nothing is hidden. */
export function labelOf(key: string): string {
  if (NAMED[key]) return NAMED[key]
  const parts = key.split('.')
  const last = parts[parts.length - 1]
  const suffix = SUFFIX[last]
  if (!suffix) return key

  const podium = /^mission\.weekly_podium\.(global|friends):(\d+)\.minutes$/.exec(key)
  if (podium) {
    return `Pódio semanal ${podium[1] === 'global' ? 'Global' : 'Amigos'}, ${podium[2]}º lugar`
  }
  const km = /^mission\.km_milestone\.(?:step_(\d+)|every)\./.exec(key)
  if (km) {
    const step = km[1] ? `Marco de distância ${km[1]}` : 'Marco de distância (a cada)'
    return last === 'threshold' ? `${step}: limiar (contas em km)` : `${step}: ${suffix}`
  }
  const cities = /^mission\.cities_milestone\.(?:cities_(\d+)|every)\./.exec(key)
  if (cities) {
    return cities[1]
      ? `Marco de cidades ${cities[1]}: ${suffix}`
      : `Marco de cidades (a cada): ${suffix}`
  }
  const streak = /^mission\.streak_(\d+)\./.exec(key)
  if (streak) return `Sequência de dias: ${last === 'threshold' ? 'dias exigidos' : suffix}`
  return key
}

export const UNIT_LABEL: Record<RewardUnit, string> = {
  minutes: 'min',
  days: 'dias',
  months: 'meses',
  count: 'quantidade',
  points: 'pontos',
  meters: 'metros',
  miles: 'milhas',
}

// ── Validation (mirror of `reward_settings_value_ck`) ────────────────────────────────────

export type RewardValueProblem = 'not_a_number' | 'not_positive' | 'negative' | 'not_integer' | 'not_multiple_of_5'

/** The one key `reward_settings_value_ck` lets be 0, meaning no interval (#1237 D3, BR-MONETIZACAO-091 2.d). */
const ZERO_ALLOWED_KEYS: ReadonlySet<string> = new Set(['planned_trip.interval_months'])

/** Parses what the operator typed; accepts the pt-BR decimal comma. */
export function parseRewardValue(input: string): number {
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.')
  if (normalized === '' || !/^-?\d+(\.\d+)?$/.test(normalized)) return Number.NaN
  return Number(normalized)
}

export function validateRewardValue(value: number, unit: RewardUnit | null, key?: string): RewardValueProblem | null {
  if (!Number.isFinite(value)) return 'not_a_number'
  if (key !== undefined && ZERO_ALLOWED_KEYS.has(key)) {
    if (value < 0) return 'negative'
  } else if (value <= 0) return 'not_positive'
  // Unknown unit: only the database knows. Positive is the floor every unit shares.
  if (unit === null) return null
  if (unit !== 'points' && !Number.isInteger(value)) return 'not_integer'
  if (unit === 'minutes' && value % 5 !== 0) return 'not_multiple_of_5'
  return null
}

export const PROBLEM_TEXT: Record<RewardValueProblem, string> = {
  not_a_number: 'Digite um número.',
  not_positive: 'O valor precisa ser maior que zero.',
  negative: 'O valor não pode ser negativo.',
  not_integer: 'Use um número inteiro.',
  not_multiple_of_5: 'Minutos vão de 5 em 5.',
}

// ── Server refusal ──────────────────────────────────────────────────────────────────────

export type RewardSettingErrorCode =
  | 'forbidden'
  | 'unknown_key'
  | 'above_cap'
  | 'invalid_value'
  | 'invalid_body'
  | 'unknown'

export interface RewardSettingError {
  code: RewardSettingErrorCode
  sqlstate?: string
  capMinutes?: number
}

/**
 * `drive.set_reward_setting` raises `42501` (gate), `22023` (unknown key, or minutes above
 * `drive.manual_grant_cap_minutes()`), and the UPDATE trips `23514` on
 * `reward_settings_value_ck`. The two `22023` are told apart by their message.
 */
export function classifyRewardSettingError(
  error: { code?: string | null; message?: string | null } | null | undefined
): RewardSettingError {
  const sqlstate = error?.code ?? undefined
  const message = error?.message ?? ''
  switch (sqlstate) {
    case '42501':
      return { code: 'forbidden', sqlstate }
    case '23514':
    case '23502':
      return { code: 'invalid_value', sqlstate }
    case '22023': {
      if (/unknown reward setting/i.test(message)) return { code: 'unknown_key', sqlstate }
      const cap = /cap of (\d+) minutes/i.exec(message)
      if (cap) return { code: 'above_cap', sqlstate, capMinutes: Number.parseInt(cap[1], 10) }
      return { code: 'invalid_value', sqlstate }
    }
    default:
      return { code: 'unknown', sqlstate }
  }
}

export function rewardSettingErrorStatus(error: RewardSettingError): number {
  switch (error.code) {
    case 'forbidden':
      return 403
    case 'unknown_key':
      return 404
    case 'above_cap':
    case 'invalid_value':
    case 'invalid_body':
      return 400
    default:
      return 500
  }
}

export function rewardSettingErrorText(error: RewardSettingError | null | undefined): string {
  switch (error?.code) {
    case 'forbidden':
      return 'Só um administrador ativo do CMS pode alterar estes valores.'
    case 'unknown_key':
      return 'Este parâmetro não existe mais no banco. Recarregue a página.'
    case 'above_cap':
      return error.capMinutes
        ? `Acima do teto por concessão: no máximo ${error.capMinutes} min (BR-MONETIZACAO-063).`
        : 'Acima do teto de minutos por concessão (BR-MONETIZACAO-063).'
    case 'invalid_value':
    case 'invalid_body':
      return 'O banco recusou o valor: precisa ser maior que zero, inteiro (exceto pontos) e, em minutos, de 5 em 5.'
    default:
      return `Não foi possível salvar${error?.sqlstate ? ` (código ${error.sqlstate})` : ''}. Tente de novo.`
  }
}
