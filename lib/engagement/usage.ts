/**
 * `drive.cms_get_usage_monthly` (contract banco-para-cms Parte 27 §4, #1160): guide, km, movement,
 * minutes, the first day and the use funnel of each month's cohort, typed once for the API route and the
 * screen (#1161).
 *
 * Every number may be `null`, and `null` stays `null`: it is "no data", never `0` (BR-COMUNICACAO-022
 * item 4). Until migration `20261109240000` is applied the function answers `PGRST202`; the route then
 * answers 502 and every block that reads this prints its failed read.
 */

export interface UsageFirstDay {
  entered: number | null
  /** Started a trip in the 24 h after entering; overlaps `story`. */
  guide: number | null
  /** Heard audio in the same 24 h; overlaps `guide`. */
  story: number | null
  guide_or_story: number | null
  /** `null` while app opens are not measured in the month (before November 2026). */
  explore_only: number | null
  nothing: number | null
}

export interface UsageMonth {
  month: string
  guide: { people: number | null; trips: number | null; hours: number | null } | null
  km: { per_person_median: number | null; people: number | null; coverage: number | null } | null
  /**
   * Minutes of guide time per person in the buckets the app records (BR-VIAGEM-002). The CMS prints them
   * and never classifies speed itself (BR-VIAGEM-008). `coverage` is the share of trips with buckets.
   */
  movement: {
    people: number | null
    vehicle_minutes_median: number | null
    walking_minutes_median: number | null
    stopped_minutes_median: number | null
    cycling_minutes_median: number | null
    coverage: number | null
  } | null
  first_day: UsageFirstDay
  usage_funnel: {
    entered: number | null
    guide_on: number | null
    first_story: number | null
    used_1h: number | null
    second_trip: number | null
  }
  purchase: { purchased: number | null; after_free: number | null; free_minutes_before_median: number | null }
  /** `none` before the minute ledger, `partial` in its first month (a floor), `full`; `null` after the current month. */
  ledger_coverage: 'none' | 'partial' | 'full' | null
  /**
   * Minutes of the ledger spent in the month, per person, by kind (Parte 27 §4 `consumed_minutes`): the
   * month of consumption, not the cohort. `null` with `ledger_coverage` `none`.
   */
  consumed: { total: UsageMinutes; free: UsageMinutes; paid: UsageMinutes } | null
  /** Used the guide or a story in the month and had not bought by its end, by free minutes spent. */
  used_without_buying: { people: number | null; zero: number | null; up_to_15: number | null; up_to_60: number | null; over_60: number | null }
  time_to_first_story: { people: number | null; minutes_median: number | null }
  /** The trips of the guide base and the audio in them; `null` before the trip or the audio source. */
  stories: { trips: number | null; trips_without_story: number | null; stories: number | null; per_guide_hour: number | null } | null
  /** Up to five municipalities; `null` before the trip source. */
  top_cities: {
    by_trips: { city_id: number; city: string; trips: number }[]
    /** `null` before the audio source. */
    by_trips_without_story: { city_id: number; city: string; trips_without_story: number; trips: number }[] | null
  } | null
}

export interface UsageMinutes {
  people: number | null
  median: number | null
  p75: number | null
}

export interface UsageReport {
  /** ISO days of the start of each source, `null` with no row. */
  data_since: { open: string | null; trip: string | null; audio: string | null; movement: string | null; ledger: string | null }
  months: UsageMonth[]
}

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
/** A block the function sends as `null` (a month before the source) stays `null`, not an object of nulls. */
const block = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null)
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
const minutesOf = (v: unknown): UsageMinutes => {
  const o = obj(v)
  return { people: n(o.people), median: n(o.median), p75: n(o.p75) }
}

/** A city row with a name and every count a number; anything else is dropped, never printed as 0. */
function cities<T extends string>(v: unknown, keys: readonly T[]): ({ city_id: number; city: string } & Record<T, number>)[] {
  if (!Array.isArray(v)) return []
  const out: ({ city_id: number; city: string } & Record<T, number>)[] = []
  for (const raw of v) {
    const o = obj(raw)
    const id = n(o.city_id)
    const counts = keys.map((k) => n(o[k]))
    if (id === null || typeof o.city !== 'string' || counts.some((c) => c === null)) continue
    out.push({ city_id: id, city: o.city, ...Object.fromEntries(keys.map((k, i) => [k, counts[i]])) } as { city_id: number; city: string } & Record<T, number>)
  }
  return out
}

/** The jsonb of the function. A missing key is `null`, never `0`. */
export function parseUsageReport(raw: unknown): UsageReport {
  const r = obj(raw)
  const since = obj(r.data_since)
  const months = Array.isArray(r.months) ? r.months : []
  return {
    data_since: { open: day(since.open), trip: day(since.trip), audio: day(since.audio), movement: day(since.movement), ledger: day(since.ledger) },
    months: months
      .map((m): UsageMonth => {
        const o = obj(m)
        const g = block(o.guide)
        const km = block(o.km)
        const mv = block(o.movement)
        const fd = obj(o.first_day)
        const uf = obj(o.usage_funnel)
        const pu = obj(o.purchase)
        const tf = obj(o.time_to_first_story)
        const cm = obj(o.consumed_minutes)
        const lc = cm.ledger_coverage
        const uwb = obj(o.used_without_buying)
        const st = block(o.stories)
        const tc = block(o.top_cities)
        return {
          month: typeof o.month === 'string' ? o.month.slice(0, 7) : '',
          guide: g && { people: n(g.people), trips: n(g.trips), hours: n(g.hours) },
          km: km && { per_person_median: n(km.per_person_median), people: n(km.people), coverage: n(km.coverage) },
          movement: mv && {
            people: n(mv.people),
            vehicle_minutes_median: n(mv.vehicle_minutes_median),
            walking_minutes_median: n(mv.walking_minutes_median),
            stopped_minutes_median: n(mv.stopped_minutes_median),
            cycling_minutes_median: n(mv.cycling_minutes_median),
            coverage: n(mv.coverage),
          },
          first_day: {
            entered: n(fd.entered),
            guide: n(fd.guide),
            story: n(fd.story),
            guide_or_story: n(fd.guide_or_story),
            explore_only: n(fd.explore_only),
            nothing: n(fd.nothing),
          },
          usage_funnel: {
            entered: n(uf.entered),
            guide_on: n(uf.guide_on),
            first_story: n(uf.first_story),
            used_1h: n(uf.used_1h),
            second_trip: n(uf.second_trip),
          },
          purchase: { purchased: n(pu.purchased), after_free: n(pu.after_free), free_minutes_before_median: n(pu.free_minutes_before_median) },
          time_to_first_story: { people: n(tf.people), minutes_median: n(tf.minutes_median) },
          ledger_coverage: lc === 'none' || lc === 'partial' || lc === 'full' ? lc : null,
          consumed: block(cm.total) ? { total: minutesOf(cm.total), free: minutesOf(cm.free), paid: minutesOf(cm.paid) } : null,
          used_without_buying: { people: n(uwb.people), zero: n(uwb.zero), up_to_15: n(uwb.up_to_15), up_to_60: n(uwb.up_to_60), over_60: n(uwb.over_60) },
          stories: st && { trips: n(st.trips), trips_without_story: n(st.trips_without_story), stories: n(st.stories), per_guide_hour: n(st.per_guide_hour) },
          top_cities: tc && {
            by_trips: cities(tc.by_trips, ['trips'] as const),
            by_trips_without_story: Array.isArray(tc.by_trips_without_story) ? cities(tc.by_trips_without_story, ['trips_without_story', 'trips'] as const) : null,
          },
        }
      })
      .filter((m) => /^\d{4}-\d{2}$/.test(m.month)),
  }
}
