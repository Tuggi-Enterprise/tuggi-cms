/**
 * Fixtures of the social analytics (#1059) for the CT bench: the three API answers, built around
 * today in Brasília so the freshness banner stays quiet, with the edge cases the spec names (a group
 * under the floor, a post without theme, a reel without profile visits, a competitor whose last
 * collection failed, one without enough days for growth). Data only: the CT runner refuses to mount
 * from a module that also exports data.
 */

import { addDays, brasiliaDay, brasiliaMidnightIso, daysBetween, mondayOf } from '@/lib/social/time'

const today = brasiliaDay(new Date())
const from = addDays(today, -28)
const to = addDays(today, -1)
/** Deterministic noise, so two captures of the same commit are the same picture. */
const wave = (i: number, base: number, amp: number) => Math.max(0, Math.round(base + amp * Math.sin(i * 1.7) + (i % 5)))

const at = (day: string, hour: number) => new Date(Date.parse(brasiliaMidnightIso(day)) + hour * 3_600_000).toISOString()

const funnelDay = (day: string, i: number) => ({
  day,
  posts: i % 3 === 0 ? [{ format: i % 2 ? 'reels' : 'carousel', caption: `Roteiro de ${['Búzios', 'Paraty', 'Ouro Preto', 'Bonito'][i % 4]} em 5 paradas` }] : [],
  profile_views: wave(i, 140, 40),
  website_clicks: wave(i, 18, 6),
  ig_site_sessions: wave(i, 22, 8),
  store_clicks: wave(i, 6, 3),
  installs_ios: wave(i, 4, 2),
  installs_android: wave(i, 7, 3),
})

const days = daysBetween(from, to).map(funnelDay)
const total = (k: 'profile_views' | 'website_clicks' | 'ig_site_sessions' | 'store_clicks' | 'installs_ios' | 'installs_android') =>
  days.reduce((n, d) => n + d[k], 0)

/**
 * The account growth (#1063): `span` days ending yesterday, total walking back from 754. Day 40 is
 * a day Meta did not answer (net and the totals before it null), day 70 lost followers, and the last
 * day is not settled yet (null), as the first production backfill came.
 */
export function growthFixture(span: number) {
  const gFrom = addDays(to, -(span - 1))
  const list = daysBetween(gFrom, to).map((day, i) => {
    const unsettled = i === span - 1
    const refused = i === span - 50
    const follows = unsettled || refused ? null : i === span - 20 ? 1 : wave(i, 6, 3) + Math.floor(i / 3)
    const unfollows = unsettled || refused ? null : i === span - 20 ? 9 : wave(i, 1, 1)
    return { day, total: null as number | null, follows, unfollows, net: follows === null ? null : follows - (unfollows as number), posts: i % 4 === 0 ? 1 : i % 9 === 0 ? 2 : 0 }
  })
  list[span - 1].total = 754
  list[span - 2].total = 720
  for (let i = span - 3; i >= 0; i--) {
    const next = list[i + 1]
    list[i].total = next.total !== null && next.net !== null ? next.total - next.net : i === span - 52 ? 560 : null
  }
  return { from: gFrom, to, days: list, measured: { net: list.filter((d) => d.net !== null).length } }
}

export const OVERVIEW = {
  today,
  period: '4w',
  collection: { first_day: addDays(today, -40), last_day: today },
  indicators: {
    followers: 1520,
    followers_7d_delta: 38,
    followers_since: null,
    reach_sum: 24180,
    reach_posts: 11,
    engagement_median: 0.0412,
    engagement_posts: 11,
  },
  recommendations: {
    week_start: mondayOf(today),
    model: 'gemini-2.5-flash-lite',
    items: [
      {
        title: 'Repetir o carrossel de cidade na terça às 18h',
        why: 'É o formato e o horário que mais trouxeram salvos e visitas ao perfil este mês.',
        evidence: 'Os 3 carrosséis de cidade de terça tiveram 7,2% de interações por alcance em 4 semanas; a média foi 3,1%.',
      },
      {
        title: 'Trocar a imagem de bastidor por um reels curto',
        why: 'A imagem rendeu menos da metade dos outros formatos no mesmo período.',
        evidence: 'As 2 imagens de bastidor tiveram 1,4% por alcance; os reels de curiosidade tiveram 5,1%.',
      },
      {
        title: 'Postar a curiosidade da semana na quinta à noite',
        why: 'Quinta das 18h às 21h teve o maior alcance por post da conta.',
        evidence: 'Os 4 posts de quinta à noite somaram 12.400 de alcance; a média dos outros dias foi 6.100.',
      },
    ],
  },
  ranking: {
    since: from,
    rows: [
      { dimension: 'format', bucket: 'CAROUSEL_ALBUM', posts: 8, rate: 0.072 },
      { dimension: 'format', bucket: 'REELS', posts: 6, rate: 0.051 },
      { dimension: 'format', bucket: 'IMAGE', posts: 2, rate: null },
      { dimension: 'theme', bucket: 'cidade', posts: 7, rate: 0.068 },
      { dimension: 'theme', bucket: 'curiosidade', posts: 4, rate: 0.051 },
      { dimension: 'theme', bucket: 'produto', posts: 3, rate: 0.022 },
      { dimension: 'theme', bucket: 'bastidor', posts: 2, rate: null },
      { dimension: 'theme', bucket: 'pending', posts: 1, rate: null },
      { dimension: 'weekday', bucket: '2', posts: 4, rate: 0.071 },
      { dimension: 'weekday', bucket: '4', posts: 4, rate: 0.058 },
      { dimension: 'weekday', bucket: '6', posts: 3, rate: 0.033 },
      { dimension: 'weekday', bucket: '1', posts: 2, rate: null },
      { dimension: 'weekday', bucket: '7', posts: 1, rate: null },
      { dimension: 'slot', bucket: '6', posts: 6, rate: 0.066 },
      { dimension: 'slot', bucket: '4', posts: 5, rate: 0.049 },
      { dimension: 'slot', bucket: '3', posts: 3, rate: 0.031 },
      { dimension: 'slot', bucket: '7', posts: 2, rate: null },
    ],
  },
  funnel: {
    from,
    to,
    days,
    totals: {
      posts: days.reduce((n, d) => n + d.posts.length, 0),
      profile_views: total('profile_views'),
      website_clicks: total('website_clicks'),
      ig_site_sessions: total('ig_site_sessions'),
      store_clicks: total('store_clicks'),
      installs_ios: total('installs_ios'),
      installs_android: total('installs_android'),
    },
    previous: { posts: 8, profile_views: 3500, website_clicks: 520, ig_site_sessions: 700, store_clicks: 150, installs_ios: 140, installs_android: 160 },
    measured: { profile_views: 28, website_clicks: 28, ig_site_sessions: 28, store_clicks: 28, installs_ios: 28, installs_android: 28, installs: 28 },
    previous_measured: { profile_views: 28, website_clicks: 28, ig_site_sessions: 28, store_clicks: 28, installs_ios: 28, installs_android: 28, installs: 28 },
  },
  campaigns: [
    { campaign: 'bio_novembro', clicks_app_store: 41, clicks_play_store: 63, downloads_ios: null },
    { campaign: 'story_buzios_1028', clicks_app_store: 12, clicks_play_store: 9, downloads_ios: null },
    { campaign: 'apple_only_search', clicks_app_store: 0, clicks_play_store: 0, downloads_ios: null },
  ],
  clicks_by_store: true,
  apple: { configured: false, first_day: null },
  audience: {
    day: mondayOf(today),
    followers: 1520,
    city: [
      { label: 'Rio de Janeiro, Rio de Janeiro', count: 312, share: 0.2053 },
      { label: 'São Paulo, São Paulo', count: 248, share: 0.1632 },
      { label: 'Niterói, Rio de Janeiro', count: 97, share: 0.0638 },
      { label: 'Belo Horizonte, Minas Gerais', count: 61, share: 0.0401 },
      { label: 'Armação dos Búzios, Rio de Janeiro', count: 44, share: 0.0289 },
    ],
    country: [
      { label: 'BR', count: 1402, share: 0.9224 },
      { label: 'PT', count: 41, share: 0.027 },
      { label: 'AR', count: 22, share: 0.0145 },
    ],
    age: [
      { label: '18-24', count: 160, share: 0.1053 },
      { label: '25-34', count: 598, share: 0.3934 },
      { label: '35-44', count: 421, share: 0.277 },
      { label: '45-54', count: 210, share: 0.1382 },
      { label: '65+', count: 38, share: 0.025 },
    ],
    gender: [
      { label: 'F', count: 820, share: 0.5395 },
      { label: 'M', count: 640, share: 0.4211 },
      { label: 'U', count: 60, share: 0.0395 },
    ],
  },
  audience_reason: null,
  growth: growthFixture(90),
}

const CAPTIONS = [
  'Búzios em 5 paradas: o roteiro que o app conta enquanto você dirige',
  'A ponte que ninguém sabe por que tem esse nome',
  'Nosso time gravando a narração de Paraty',
  'O plano Viajante, explicado em 30 segundos',
  'Ouro Preto em uma tarde',
  '',
]
const TYPES: Array<[string, string]> = [
  ['CAROUSEL_ALBUM', 'FEED'],
  ['VIDEO', 'REELS'],
  ['IMAGE', 'FEED'],
]
const THEMES = ['cidade', 'curiosidade', 'bastidor', 'produto', 'cidade', null]

export const POSTS = {
  collection: { first_day: addDays(today, -40), last_day: today },
  posts: Array.from({ length: 14 }, (_, i) => {
    const [media_type, media_product_type] = TYPES[i % 3]
    const reel = media_product_type === 'REELS'
    return {
      id: `p${i}`,
      posted_at: at(addDays(today, -2 * i - 1), 18 + (i % 3)),
      caption: CAPTIONS[i % CAPTIONS.length],
      media_type,
      media_product_type,
      theme: THEMES[i % THEMES.length],
      permalink: `https://www.instagram.com/p/fixture${i}/`,
      metrics: {
        reach: 800 + 137 * i,
        likes: 30 + 7 * i,
        comments: i % 4,
        saved: 5 + i,
        shares: i === 3 ? 0 : 2 + (i % 6),
        profile_visits: reel ? null : 6 + (i % 5),
        follows: reel ? null : i % 3,
        views: 1500 + 211 * i,
        reels_avg_watch_time_s: reel ? [12, 65, 9, 31, 48][i % 5] : null,
        reels_total_watch_time_s: reel ? [2880, 11520, 540, 1860, 40][i % 5] : null,
      },
    }
  }),
}

const account = (
  id: string,
  username: string,
  followers: number,
  extra: Partial<Record<string, unknown>> = {}
) => ({
  id,
  username,
  is_own: false,
  market: null as string | null,
  followers,
  last_day: today,
  growth_7d: { delta: Math.round(followers * 0.012), ratio: 0.012 },
  growth_30d: { delta: Math.round(followers * 0.041), ratio: 0.041 },
  growth_7d_from: null,
  growth_30d_from: null,
  engagement: 0.0123,
  mix: { carousel: 4, reels: 9, image: 2, other: 0 },
  posts_30d: 15,
  last_post: at(addDays(today, -2), 12),
  ...extra,
})

export const ACCOUNTS = {
  today,
  collection: { first_day: addDays(today, -40), last_day: today },
  accounts: [
    account('c1', 'izitravel', 51234, { market: 'EU' }),
    account('c2', 'roadtrippers', 288400, { growth_7d: { delta: -320, ratio: -0.0011 }, market: 'US' }),
    account('c3', 'melhoresdestinos', 1940000, { engagement: 0.0041, market: 'BR' }),
    account('c4', 'autioapp', 8120, { last_day: addDays(today, -3), last_post: at(addDays(today, -20), 9), market: 'US' }),
    account('c5', 'shakaguide', 3010, {
      growth_7d: null,
      growth_30d: null,
      growth_7d_from: addDays(today, 5),
      growth_30d_from: addDays(today, 28),
      engagement: null,
      posts_30d: 2,
      mix: { carousel: 0, reels: 2, image: 0, other: 0 },
    }),
    {
      ...account('own', 'tuggi_app', 1520, { engagement: 0.021, mix: { carousel: 8, reels: 6, image: 2, other: 0 }, posts_30d: 16 }),
      is_own: true,
    },
  ],
}

/**
 * The first production collection as the operator saw it (2026-10-29): profile views only on the
 * last day (9), a bio-link 0 on that day and nothing before, installs only on the last three days.
 * Partial coverage everywhere, which is what broke the strips and printed a 28-day "0".
 */
const sparseDays = daysBetween(from, to).map((day, i, all) => {
  const tail = all.length - 1 - i
  return {
    day,
    posts: i % 2 === 0 ? [{ format: 'carousel', caption: 'Roteiro de Paraty' }] : [],
    profile_views: tail === 0 ? 9 : null,
    website_clicks: tail === 0 ? 0 : null,
    ig_site_sessions: tail <= 2 ? 0 : null,
    store_clicks: null,
    installs_ios: tail <= 2 ? [3, 1, 0][2 - tail] : null,
    installs_android: tail <= 2 ? [1, 2, 3][2 - tail] : null,
  }
})

export const OVERVIEW_SPARSE = {
  ...OVERVIEW,
  funnel: {
    from,
    to,
    days: sparseDays,
    totals: { posts: 14, profile_views: 9, website_clicks: 0, ig_site_sessions: 0, store_clicks: null, installs_ios: 4, installs_android: 6 },
    measured: { profile_views: 1, website_clicks: 1, ig_site_sessions: 3, store_clicks: 0, installs_ios: 3, installs_android: 3, installs: 3 },
    previous: { posts: 2, profile_views: null, website_clicks: null, ig_site_sessions: null, store_clicks: null, installs_ios: null, installs_android: null },
    previous_measured: { profile_views: 0, website_clicks: 0, ig_site_sessions: 0, store_clicks: 0, installs_ios: 0, installs_android: 0, installs: 0 },
  },
}

/** Our stories (#1062, R2.6): one live, one from two days ago, one without navigation and without link. */
export const STORIES = {
  collection: { last_run_at: new Date(Date.now() - 20 * 60_000).toISOString() },
  stories: [
    { id: 's1', posted_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), media_type: 'VIDEO', permalink: 'https://www.instagram.com/stories/tuggi_app/s1/', collected_at: null, reach: 150, views: 210, replies: 2, tap_forward: 14, tap_back: 1, tap_exit: 6, swipe_forward: 0, exit_rate: 0.04 },
    { id: 's2', posted_at: at(addDays(today, -2), 10), media_type: 'IMAGE', permalink: 'https://www.instagram.com/stories/tuggi_app/s2/', collected_at: null, reach: 98, views: 130, replies: 0, tap_forward: 40, tap_back: 3, tap_exit: 21, swipe_forward: 5, exit_rate: 0.2143 },
    { id: 's3', posted_at: at(addDays(today, -5), 19), media_type: 'IMAGE', permalink: null, collected_at: null, reach: 0, views: null, replies: null, tap_forward: null, tap_back: null, tap_exit: null, swipe_forward: null, exit_rate: null },
  ],
}

export const STORIES_NEVER = { collection: { last_run_at: null }, stories: [] }

const week0 = addDays(mondayOf(today), -7)

/** The competitors' ten best posts of the last closed week (#1062, R2.1). */
export const COMPETITOR_POSTS = {
  today,
  week_start: week0,
  week_end: addDays(week0, 6),
  partial: false,
  weeks: [1, 2, 3, 4].map((k) => addDays(mondayOf(today), -7 * k)).concat(mondayOf(today)),
  tracked: 5,
  rows: Array.from({ length: 10 }, (_, i) => ({
    username: ['izitravel', 'roadtrippers', 'melhoresdestinos', 'autioapp', 'shakaguide'][i % 5],
    posted_at: at(addDays(week0, i % 7), 11 + (i % 6)),
    permalink: `https://www.instagram.com/p/rival${i}/`,
    media_type: ['VIDEO', 'CAROUSEL_ALBUM', 'IMAGE'][i % 3],
    media_product_type: ['REELS', 'FEED', 'FEED'][i % 3],
    theme: i % 4 === 0 ? 'pending' : ['cidade', 'curiosidade', 'produto'][i % 3],
    caption_first_line: `Roteiro de ${['Roma', 'Lisboa', 'Gramado', 'Paraty', 'Bonito'][i % 5]} em ${3 + i} paradas`,
    hashtags: i === 0 ? ['viagem', 'roadtrip', 'roma', 'italia', 'dicasdeviagem', 'europa', 'audioguia'] : ['viagem', 'roteiro'],
    likes: 4200 - 300 * i,
    comments: 120 - 9 * i,
    followers_on_day: 51234,
    rate: (4320 - 309 * i) / 51234,
    // #1064 M4: the first post is 3.1 times its account's median, the second 2.9, the fifth's account has 4 posts.
    outlier: i === 0,
    account_median: i === 4 ? 0.01 : i === 0 ? (4320 / 51234) / 3.1 : (4011 / 51234) / 2.9,
    account_posts: i === 4 ? 4 : 40,
  })),
  outlier_rule: { factor: 3, min_posts: 5 },
}

/**
 * #1064 M2: a competitor's growth, the daily total of `account_daily` from its first collection. One
 * day without a total (index 6) leaves a gap and two days without net; no gains and losses ever.
 */
export function competitorGrowth(span = 14) {
  const gFrom = addDays(today, -(span - 1))
  const totals = Array.from({ length: span }, (_, i) => (i === 6 ? null : 51000 + i * 18 + (i % 3) * 7))
  const list = daysBetween(gFrom, today).map((day, i) => ({
    day,
    total: totals[i],
    follows: null,
    unfollows: null,
    net: i > 0 && totals[i] !== null && totals[i - 1] !== null ? (totals[i] as number) - (totals[i - 1] as number) : null,
    posts: i % 3 === 0 ? 1 : 0,
  }))
  return {
    from: gFrom,
    to: today,
    days: list,
    measured: { net: list.filter((d) => d.net !== null).length },
    kind: 'competitor',
    account: { id: 'c3', username: 'melhoresdestinos' },
  }
}

const MARKET_FORMATS = ['IMAGE', 'CAROUSEL_ALBUM', 'REELS']
const MARKET_THEMES = ['cidade', 'curiosidade', 'produto', 'bastidor', 'outro', 'pending']
const MARKET_WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7']

/**
 * #1064 M3: Brasil with one account and Estados Unidos with two, Europa with none (the whole column
 * is the unknown mark). Reels win in Brasil and carousels in the US; a group of 2 posts is under the
 * floor; one US group has no followers to divide by.
 */
export const MARKETS = {
  today,
  window_days: 90,
  since: addDays(today, -90),
  markets: { BR: { accounts: 1 }, US: { accounts: 2 }, EU: { accounts: 0 } },
  unassigned: 1,
  rows: (
    [
      ['format', MARKET_FORMATS],
      ['theme', MARKET_THEMES],
      ['weekday', MARKET_WEEKDAYS],
    ] as const
  ).flatMap(([dimension, buckets]) =>
    buckets.flatMap((bucket, i) =>
      (['BR', 'US', 'EU'] as const).map((market) => {
        if (market === 'EU') return { dimension, bucket, market, posts: 0, rate: null, reason: 'no_account' }
        const seed = (i + 1) * (market === 'BR' ? 3 : 2)
        if (dimension === 'format' && bucket === 'IMAGE' && market === 'BR') return { dimension, bucket, market, posts: 2, rate: null, reason: 'few_posts' }
        if (dimension === 'theme' && bucket === 'bastidor') return { dimension, bucket, market, posts: 0, rate: null, reason: 'no_posts' }
        if (dimension === 'weekday' && bucket === '7' && market === 'US') return { dimension, bucket, market, posts: 4, rate: null, reason: 'no_followers' }
        const lead = dimension === 'format' && ((market === 'BR' && bucket === 'REELS') || (market === 'US' && bucket === 'CAROUSEL_ALBUM'))
        return { dimension, bucket, market, posts: 3 + seed, rate: (lead ? 0.031 : 0.008) + seed * 0.0007, reason: null }
      })
    )
  ),
}
