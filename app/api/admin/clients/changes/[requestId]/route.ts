/**
 * POST /api/admin/clients/changes/<requestId>   body `{ decision: 'approved' }` | `{ decision: 'rejected', note }`
 *
 * Approve or refuse one change of the partner portal (#922, BR-B2B-061 item 2; contract
 * `docs/contracts/portal-fotos-e-texto.md` §5.2). Admin and editor. Refusing requires a short reason,
 * which is what the partner reads. Approving a photo copies it to the public bucket before the
 * decision; approving a text removes the voiced mp3s after it (`place-change-service.ts`).
 *
 * 400 invalid body · 404 not_found · 409 not_pending | not_live · 422 note_required ·
 * 502 publish_failed | audio_cleanup_failed (approve again: every step is retry-safe) · 503 not_available.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { UUID } from '@/lib/finance/input'
import { parseDecisionBody } from '@/lib/partnerships/place-changes'
import { decidePlaceChange } from '@/lib/services/place-change-service'

type Params = { requestId: string }

export const POST = withAuth<Params>({ roles: ['admin', 'editor'] }, async (req: NextRequest, ctx, auth) => {
  const requestId = (await ctx.params)?.requestId
  if (!requestId || !UUID.test(requestId)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  const body = parseDecisionBody(await req.json().catch(() => null))
  if ('invalid' in body) return NextResponse.json({ error: body.invalid === 'note' ? 'note_required' : 'invalid_decision' }, { status: body.invalid === 'note' ? 422 : 400 })
  const r = await decidePlaceChange(requestId, body, auth.cmsUser.id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, outcome: r.data.outcome })
})
