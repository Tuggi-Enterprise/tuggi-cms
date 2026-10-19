/**
 * GET /api/admin/story-feedback?lang=<pt|en|es|fr|it>&reason=wrong|dislike&sort=<column>&page=&limit=
 *
 * Admin-only. The stories the tourists voted down, per POI and language (#950, BR-CONTEUDO-009
 * item 5): `drive.cms_story_feedback_summary`, which is EXECUTE for service_role only, so it runs on
 * service_role and `withAuth` is the admin check. The comment is free text from the tourist: it
 * never goes to the log, and no author reaches the answer (item 7).
 *
 * The RPC filters the language and caps the rows; the "has a down" cut, the reason filter, the order
 * and the page are here (a few hundred stories at most). Until the migration is applied the function
 * does not exist: 503 `not_available`, which the screen shows as empty.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  isStoryLanguage,
  isStoryReasonFilter,
  isStorySort,
  storyFeedbackErrorStatus,
  toStoryFeedbackList,
  type StoryFeedbackSummaryRow,
} from '@/lib/story-feedback'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
/** The RPC's own ceiling (`least(..., 1000)`). */
const RPC_LIMIT = 1000

function positiveInt(raw: string | null, fallback: number, max: number): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return fallback
  return Math.min(n, max)
}

export const GET = withAuth({ roles: ['admin'] }, async (request: NextRequest) => {
  const params = request.nextUrl.searchParams
  const lang = params.get('lang')
  const reason = params.get('reason')
  const sort = params.get('sort')
  const limit = positiveInt(params.get('limit'), DEFAULT_LIMIT, MAX_LIMIT)
  const page = positiveInt(params.get('page'), 1, Number.MAX_SAFE_INTEGER)

  const { data, error } = await getSupabaseService()
    .schema('drive')
    .rpc('cms_story_feedback_summary', { p_language: isStoryLanguage(lang) ? lang : null, p_limit: RPC_LIMIT })
  if (error) {
    console.error('[story-feedback] summary refused:', error.code)
    const e = storyFeedbackErrorStatus(error.code)
    return NextResponse.json({ error: e.error, code: e.error }, { status: e.status })
  }

  const all = toStoryFeedbackList((Array.isArray(data) ? data : []) as StoryFeedbackSummaryRow[], {
    reason: isStoryReasonFilter(reason) ? reason : null,
    sort: isStorySort(sort) ? sort : 'wrong',
  })
  const pages = Math.max(1, Math.ceil(all.length / limit))
  return NextResponse.json({
    stories: all.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: all.length, pages },
  })
})
