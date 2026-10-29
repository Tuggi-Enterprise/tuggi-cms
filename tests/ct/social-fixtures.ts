/** Posts of the current month, one per status, for the social agenda CT (#1058). */

const day = (offset: number, hour: number) => {
  const d = new Date()
  d.setUTCDate(1 + offset)
  d.setUTCHours(hour + 3, 0, 0, 0) // Brasília is UTC-3
  return d.toISOString()
}

const media = (id: string, n: number, mime = 'image/jpeg') =>
  Array.from({ length: n }, (_, i) => ({
    id: `${id}-m${i}`,
    position: i + 1,
    storage_path: `${id}/${i + 1}-0b9c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d.${mime === 'image/jpeg' ? 'jpg' : 'mp4'}`,
    mime_type: mime,
    url: mime === 'image/jpeg' ? `https://ct-fixture.supabase.co/storage/v1/object/public/social-media/${id}/${i + 1}.jpg` : undefined,
  }))

const target = (id: string, network: string, status: string, extra: Record<string, unknown> = {}) => ({
  id: `${id}-${network}`,
  network,
  status,
  attempts: status === 'scheduled' ? 0 : 1,
  permalink: null,
  error: null,
  published_at: null,
  updated_at: day(2, 9),
  ...extra,
})

const post = (id: string, type: string, at: string, caption: string, m: unknown[], targets: unknown[]) => ({
  id,
  title: caption.split('\n')[0].slice(0, 60),
  caption,
  media_type: type,
  scheduled_at: at,
  link_url: null,
  utm_campaign: null,
  created_at: at,
  updated_at: at,
  post_media: m,
  post_targets: targets,
})

export const PUBLISHED_ID = '11111111-1111-4111-8111-111111111111'

export const POSTS = [
  post(PUBLISHED_ID, 'CAROUSEL', day(2, 9), 'Búzios em cinco praias\nEN: Búzios in five beaches', media(PUBLISHED_ID, 5), [
    target(PUBLISHED_ID, 'instagram', 'published', { permalink: 'https://www.instagram.com/p/CTFIXTURE/', published_at: day(2, 9) }),
    target(PUBLISHED_ID, 'facebook', 'failed', { error: '(#10) Application does not have permission for this action' }),
  ]),
  post('22222222-2222-4222-8222-222222222222', 'IMAGE', day(2, 18), 'Pôr do sol na Ferradura', media('22222222-2222-4222-8222-222222222222', 1), [
    target('22222222-2222-4222-8222-222222222222', 'instagram', 'publishing'),
  ]),
  post('33333333-3333-4333-8333-333333333333', 'REELS', day(9, 12), 'Arraial do Cabo de barco', media('33333333-3333-4333-8333-333333333333', 1, 'video/mp4'), [
    target('33333333-3333-4333-8333-333333333333', 'instagram', 'scheduled'),
    target('33333333-3333-4333-8333-333333333333', 'facebook', 'scheduled'),
  ]),
  post('44444444-4444-4444-8444-444444444444', 'IMAGE', day(16, 15), 'Rota do vinho cancelada', media('44444444-4444-4444-8444-444444444444', 1), [
    target('44444444-4444-4444-8444-444444444444', 'instagram', 'canceled'),
    target('44444444-4444-4444-8444-444444444444', 'facebook', 'canceled'),
  ]),
]

export const THUMB_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#00719F"/><circle cx="40" cy="40" r="18" fill="#FFD166"/></svg>'
