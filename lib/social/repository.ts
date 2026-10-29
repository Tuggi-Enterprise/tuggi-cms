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
import { POST_SELECT, SOCIAL_BUCKET, type SocialPost } from './post'

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
