/**
 * Market references of the Engagement page (#1161, spec Parte E §E4): the one place their numbers live.
 * The chart draws the dashed line from here and the copy prints the source and the year from here, so a
 * new edition of a report changes one line. These are market practice, not rules of ours: the `produto`
 * is told so it can record them. No target of our own yet (spec §E1 item 8).
 */

export interface Benchmark {
  /** A share, 0 to 1. */
  value: number
  source: string
  year: number
  url: string
}

export type BenchmarkKey = 'retention_d1' | 'retention_d30' | 'dau_mau'

const BUSINESS_OF_APPS = { source: 'Business of Apps, Travel App Report', year: 2025, url: 'https://www.businessofapps.com/?p=97743' }

export const BENCHMARKS: Readonly<Record<BenchmarkKey, Benchmark>> = {
  /** Travel apps: share of installs that open the app again the next day. */
  retention_d1: { value: 0.18, ...BUSINESS_OF_APPS },
  /** Travel apps: share of installs active on day 30. */
  retention_d30: { value: 0.028, ...BUSINESS_OF_APPS },
  /** Travel apps: average daily active over monthly active ("stickiness"), CleverTap benchmark of July 2023. */
  dau_mau: {
    value: 0.18,
    source: 'CleverTap, travel app benchmark',
    year: 2023,
    url: 'https://clevertap.com/news/press-release/only-42-of-newly-signed-up-travel-app-users-transact-in-the-first-month-clevertap-benchmark-report/',
  },
}

export function benchmark(key: BenchmarkKey): Benchmark {
  return BENCHMARKS[key]
}
