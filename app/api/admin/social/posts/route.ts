/**
 * `GET  /api/admin/social/posts?month=AAAA-MM`: the posts of one Brasília month, with media and
 *      targets, for the calendar, the list and the filter counts at once (#1058).
 * `POST /api/admin/social/posts`: schedules a new post. The id comes from the editor, which made
 *      it before the first upload (the media folder and the download link need it).
 *
 * Admin only (`withAuth`); `/api/*` is outside the proxy matcher, so this is the whole route gate.
 * The read runs on the operator's session, so the RLS of `social.*` is the second gate.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { monthBounds, parseMonthKey } from '@/lib/social/time'
import { createPost, listPosts, parsePostInput, socialFailure } from '@/lib/social/repository'
import { validatePost } from '@/lib/social/post'

export const GET = withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
  const month = parseMonthKey(req.nextUrl.searchParams.get('month'))
  if (!month) return NextResponse.json({ error: { code: 'invalid_month' } }, { status: 400 })

  const { start, end } = monthBounds(month)
  try {
    return NextResponse.json({ posts: await listPosts(auth.supabase, start, end) })
  } catch (err) {
    return socialFailure('list', err)
  }
})

export const POST = withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 })
  }
  const input = parsePostInput(body, typeof body?.id === 'string' ? body.id : '')
  if (!input) return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 })

  // The form held the line at now + 10 minutes; here only "not in the past".
  const errors = validatePost(input, new Date())
  if (errors.length) return NextResponse.json({ error: { code: 'invalid', errors } }, { status: 422 })

  try {
    await createPost(auth.supabase, input)
    return NextResponse.json({ id: input.id }, { status: 201 })
  } catch (err) {
    return socialFailure('create', err)
  }
})
