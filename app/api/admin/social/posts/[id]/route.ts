/**
 * `GET /api/admin/social/posts/[id]`: one post with media and targets (#1058).
 * `PUT /api/admin/social/posts/[id]`: rewrites it, refused with 409 when a network is publishing
 * or published, or when every network was canceled (final). The lock is the database's.
 *
 * Admin only, on the operator's session: the RLS of `social.*` is the second gate.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getPost, parsePostInput, socialFailure, updatePost } from '@/lib/social/repository'
import { isUuid, validatePost } from '@/lib/social/post'

type Params = { id: string }

export const GET = withAuth<Params>({ roles: ['admin'] }, async (_req, ctx, auth) => {
  const { id } = (await ctx.params) ?? { id: '' }
  if (!isUuid(id)) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 })
  try {
    const post = await getPost(auth.supabase, id)
    if (!post) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 })
    return NextResponse.json({ post })
  } catch (err) {
    return socialFailure('get', err)
  }
})

export const PUT = withAuth<Params>({ roles: ['admin'] }, async (req, ctx, auth) => {
  const { id } = (await ctx.params) ?? { id: '' }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 })
  }
  const input = parsePostInput(body, id)
  if (!input) return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 })

  const errors = validatePost(input, new Date())
  if (errors.length) return NextResponse.json({ error: { code: 'invalid', errors } }, { status: 422 })

  try {
    const result = await updatePost(auth.supabase, input)
    if (result.ok) return NextResponse.json({ id })
    if (result.reason === 'not_found') return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 })
    return NextResponse.json({ error: { code: 'locked', reason: result.reason } }, { status: 409 })
  } catch (err) {
    return socialFailure('update', err)
  }
})
