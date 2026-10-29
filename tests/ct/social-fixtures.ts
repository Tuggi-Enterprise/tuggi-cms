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
  installs_ios: wave(i, 4, 2),
  installs_android: wave(i, 7, 3),
})

const days = daysBetween(from, to).map(funnelDay)
const total = (k: 'profile_views' | 'website_clicks' | 'ig_site_sessions' | 'installs_ios' | 'installs_android') =>
  days.reduce((n, d) => n + d[k], 0)

export const OVERVIEW = {
  today,
  period: '4w',
  collection: { first_day: addDays(today, -40), last_day: today },
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
      installs_ios: total('installs_ios'),
      installs_android: total('installs_android'),
    },
    previous: { posts: 8, profile_views: 3500, website_clicks: 520, ig_site_sessions: 700, installs_ios: 140, installs_android: 160 },
    measured: { profile_views: 28, website_clicks: 28, ig_site_sessions: 28, installs_ios: 28, installs_android: 28, installs: 28 },
    previous_measured: { profile_views: 28, website_clicks: 28, ig_site_sessions: 28, installs_ios: 28, installs_android: 28, installs: 28 },
  },
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
    account('c1', 'izitravel', 51234),
    account('c2', 'roadtrippers', 288400, { growth_7d: { delta: -320, ratio: -0.0011 } }),
    account('c3', 'melhoresdestinos', 1940000, { engagement: 0.0041 }),
    account('c4', 'autioapp', 8120, { last_day: addDays(today, -3), last_post: at(addDays(today, -20), 9) }),
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
    totals: { posts: 14, profile_views: 9, website_clicks: 0, ig_site_sessions: 0, installs_ios: 4, installs_android: 6 },
    measured: { profile_views: 1, website_clicks: 1, ig_site_sessions: 3, installs_ios: 3, installs_android: 3, installs: 3 },
    previous: { posts: 2, profile_views: null, website_clicks: null, ig_site_sessions: null, installs_ios: null, installs_android: null },
    previous_measured: { profile_views: 0, website_clicks: 0, ig_site_sessions: 0, installs_ios: 0, installs_android: 0, installs: 0 },
  },
}
