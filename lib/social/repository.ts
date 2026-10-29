/**
 * Reads and writes of the social agenda (#1058) on the schema `social`.
 *
 * EVERY call runs on the client `withAuth` hands over, bound to the operator's session, so the
 * RLS of `social.*` (`core.is_caller_platform_admin()`) is the second gate after `withAuth`. No
 * `service_role` here: that is what keeps this screen out of a new security review.
 *
 * `supabase-js` never rejects: every `{ error }` is read and turned into a thrown `SocialDbError`,
 * which the routes answer as 500 with the SQLSTATE in the log and nothing else.
 */

import { NextResponse } from 'next/server'
import {
  CAROUSEL_MAX,
  NETWORKS,
  POST_SELECT,
  SOCIAL_BUCKET,
  downloadLink,
  isMediaType,
  isNetwork,
  isOwnStoragePath,
  isUuid,
  lockReasonOf,
  mediaKindOf,
  titleFromCaption,
  utmCampaign,
  type LockReason,
  type MediaType,
  type Network,
  type SocialPost,
} from './post'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = any

export class SocialDbError extends Error {
  constructor(
    readonly step: string,
    readonly code: string | undefined
  ) {
    super(`social ${step} failed (${code ?? 'no code'})`)
  }
}

function check<T>(step: string, result: { data: T; error: { code?: string } | null }): T {
  if (result.error) throw new SocialDbError(step, result.error.code)
  return result.data
}

/** 500 with the SQLSTATE in the log and no row, id or text of the operator in it. */
export function socialFailure(step: string, err: unknown): NextResponse {
  const code = err instanceof SocialDbError ? err.code : undefined
  console.error(`[social] ${step} failed:`, code ?? (err instanceof Error ? err.message : 'unknown'))
  return NextResponse.json({ error: { code: 'server_error' } }, { status: 500 })
}

const social = (supabase: Client) => supabase.schema('social')

/** Orders the embeds and derives the public URL of each media from its path. */
export function shapePost(supabase: Client, row: any): SocialPost {
  const media = [...(row.post_media ?? [])].sort((a: any, b: any) => a.position - b.position)
  const targets = [...(row.post_targets ?? [])].sort((a: any, b: any) => (a.network < b.network ? 1 : -1))
  return {
    ...row,
    post_media: media.map((m: any) => ({
      ...m,
      url: supabase.storage.from(SOCIAL_BUCKET).getPublicUrl(m.storage_path).data.publicUrl,
    })),
    post_targets: targets,
  }
}

/** Posts scheduled in `[start, end)`, with media and targets, in one read. */
export async function listPosts(supabase: Client, start: string, end: string): Promise<SocialPost[]> {
  const rows = check<any[]>(
    'list',
    await social(supabase)
      .from('posts')
      .select(POST_SELECT)
      .gte('scheduled_at', start)
      .lt('scheduled_at', end)
      .order('scheduled_at', { ascending: true })
  )
  return (rows ?? []).map((row) => shapePost(supabase, row))
}

export async function getPost(supabase: Client, id: string): Promise<SocialPost | null> {
  const row = check<any>('get', await social(supabase).from('posts').select(POST_SELECT).eq('id', id).maybeSingle())
  return row ? shapePost(supabase, row) : null
}

// ── Writes ────────────────────────────────────────────────────────────────────────────────

export interface PostInput {
  id: string
  networks: Network[]
  media_type: MediaType
  caption: string
  scheduled_at: string
  media: { storage_path: string; mime_type: string }[]
}

/**
 * Reads the body of a create or update. `null` when the shape is wrong; the business refusals are
 * `validatePost`'s, run by the caller. Media paths must live in the post's own folder, so a body
 * cannot point a post at somebody else's object.
 */
export function parsePostInput(body: any, id: string): PostInput | null {
  if (!body || typeof body !== 'object' || !isUuid(id)) return null
  const networks = Array.isArray(body.networks) ? body.networks : null
  const media = Array.isArray(body.media) ? body.media : null
  if (!networks || !networks.every(isNetwork) || new Set(networks).size !== networks.length) return null
  if (!isMediaType(body.media_type) || typeof body.caption !== 'string' || typeof body.scheduled_at !== 'string') return null
  if (!media || media.length > CAROUSEL_MAX) return null
  for (const m of media) {
    if (!m || typeof m.storage_path !== 'string' || typeof m.mime_type !== 'string') return null
    if (!mediaKindOf(m.mime_type) || !isOwnStoragePath(id, m.storage_path)) return null
  }
  return {
    id,
    networks,
    media_type: body.media_type,
    caption: body.caption,
    scheduled_at: body.scheduled_at,
    media: media.map((m: any) => ({ storage_path: m.storage_path, mime_type: m.mime_type })),
  }
}

function postRow(input: PostInput) {
  return {
    title: titleFromCaption(input.caption, input.id),
    caption: input.caption,
    media_type: input.media_type,
    scheduled_at: new Date(input.scheduled_at).toISOString(),
    link_url: downloadLink(input.id),
    utm_campaign: utmCampaign(input.id),
  }
}

const mediaRows = (input: PostInput) =>
  input.media.map((m, index) => ({ post_id: input.id, position: index + 1, storage_path: m.storage_path, mime_type: m.mime_type }))

/**
 * Creates the post, its media and one `scheduled` target per network. PostgREST gives no
 * transaction across tables, so a failure after the post row deletes it (the cascade takes the
 * rest): a half post would be picked by the cron with no media.
 */
export async function createPost(supabase: Client, input: PostInput): Promise<void> {
  check('create post', await social(supabase).from('posts').insert({ id: input.id, ...postRow(input) }))
  try {
    check('create media', await social(supabase).from('post_media').insert(mediaRows(input)))
    check(
      'create targets',
      await social(supabase)
        .from('post_targets')
        .insert(input.networks.map((network) => ({ post_id: input.id, network })))
    )
  } catch (err) {
    const undo = await social(supabase).from('posts').delete().eq('id', input.id)
    if (undo.error) console.error('[social] create undo failed:', undo.error.code)
    throw err
  }
}

export type UpdateResult = { ok: true } | { ok: false; reason: 'not_found' | LockReason }

/**
 * Rewrites a post that no network has taken yet. The lock is read from the database here, not from
 * what the browser saw: a target in `publishing` or `published` refuses, and so does a post
 * canceled on every network (final; a new post is how it comes back).
 *
 * Targets are only touched where they are still `scheduled` or `failed`, so a claim of the cron
 * that lands between the read and the write is never overwritten. Saving puts a failed network
 * back in `scheduled`: the operator changed the post, and the new version is what goes out.
 */
export async function updatePost(supabase: Client, input: PostInput): Promise<UpdateResult> {
  const targets = check<any[]>(
    'update read',
    await social(supabase).from('post_targets').select('network, status').eq('post_id', input.id)
  )
  const exists = check<any>('update exists', await social(supabase).from('posts').select('id').eq('id', input.id).maybeSingle())
  if (!exists) return { ok: false, reason: 'not_found' }
  const lock = lockReasonOf(targets ?? [])
  if (lock) return { ok: false, reason: lock }

  check('update post', await social(supabase).from('posts').update(postRow(input)).eq('id', input.id))
  check('update media clear', await social(supabase).from('post_media').delete().eq('post_id', input.id))
  check('update media', await social(supabase).from('post_media').insert(mediaRows(input)))

  const open = ['scheduled', 'failed']
  const dropped = NETWORKS.filter((n) => input.networks.indexOf(n) < 0)
  if (dropped.length) {
    check(
      'update targets drop',
      await social(supabase).from('post_targets').delete().eq('post_id', input.id).in('network', dropped).in('status', open)
    )
  }
  const have = (targets ?? []).map((t: any) => t.network)
  const kept = input.networks.filter((n) => have.indexOf(n) >= 0)
  if (kept.length) {
    check(
      'update targets reset',
      await social(supabase)
        .from('post_targets')
        .update({ status: 'scheduled', error: null })
        .eq('post_id', input.id)
        .in('network', kept)
        .in('status', open)
    )
  }
  const added = input.networks.filter((n) => have.indexOf(n) < 0)
  if (added.length) {
    check(
      'update targets add',
      await social(supabase)
        .from('post_targets')
        .insert(added.map((network) => ({ post_id: input.id, network })))
    )
  }
  return { ok: true }
}

/** Cancels every network still `scheduled` or `failed`; published and publishing stay as they are. */
export async function cancelPost(supabase: Client, id: string): Promise<number> {
  const rows = check<any[]>(
    'cancel',
    await social(supabase)
      .from('post_targets')
      .update({ status: 'canceled' })
      .eq('post_id', id)
      .in('status', ['scheduled', 'failed'])
      .select('id')
  )
  return (rows ?? []).length
}

/**
 * Puts a failed network back in `scheduled`. `scheduled_at` lives on the post and is already past,
 * so the next cron tick claims it; the date is not touched. Only a `failed` target moves.
 */
export async function retryTarget(supabase: Client, targetId: string): Promise<boolean> {
  const rows = check<any[]>(
    'retry',
    await social(supabase)
      .from('post_targets')
      .update({ status: 'scheduled', error: null })
      .eq('id', targetId)
      .eq('status', 'failed')
      .select('id')
  )
  return (rows ?? []).length > 0
}
