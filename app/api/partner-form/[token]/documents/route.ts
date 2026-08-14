/**
 * Uploads for the public partner form (#341) — one file per request, on choice.
 *
 * The file goes up the moment it is chosen and not when the step is submitted, so a 4G
 * drop costs one file instead of the whole form (DS-COMPONENTE-016, item 3). Files
 * accumulate; they never replace one another.
 *
 * `accept` on the input is a hint and validates nothing (MDN, `input type=file`), so the
 * authoritative refusal of the TYPE is here, and the bucket is private — nothing in this
 * feature ever returns a public URL.
 *
 * The SIZE is not this route's to guard alone, and pretending otherwise is what made the
 * old 10 MB limit unreachable: Vercel caps a function's request body at 4.5 MB and answers
 * `413 FUNCTION_PAYLOAD_TOO_LARGE` before this file runs (`/docs/functions/limitations`,
 * *Request body size*). `await req.formData()` below also materialises the whole body
 * before `file.size` can be read, so this check is a last word and not a shield. What
 * makes the person see a useful message is the client refusing at `DOCUMENT_MAX_BYTES`
 * (4 MB, under the platform ceiling) — this 413 is the backstop for a caller that skips
 * the form.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withPublicRoute, withRateLimit } from '@/lib/auth-middleware'
import {
  resolveInvite,
  storeDocument,
  removeDocument,
} from '@/lib/services/partner-proposal-service'
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_FILES,
  DOCUMENT_MIME_TYPES,
  PARTNER_DOCUMENT_KINDS,
  type PartnerDocumentKind,
} from '@/lib/partner-form/fields'

const PUBLIC_REASON =
  'Partner uploads the documents of BR-B2B-022 without a CMS login; the invite token is the credential'

const UPLOAD_PER_MINUTE = 20
const MINUTE = 60_000

interface TokenParams {
  token: string
  [key: string]: string | string[] | undefined
}

async function tokenOf(ctx: { params?: Promise<TokenParams> }): Promise<string> {
  const params = ctx.params ? await ctx.params : undefined
  return typeof params?.token === 'string' ? params.token : ''
}

function isDocumentKind(value: unknown): value is PartnerDocumentKind {
  return typeof value === 'string' && (PARTNER_DOCUMENT_KINDS as readonly string[]).includes(value)
}

export const POST = withRateLimit(UPLOAD_PER_MINUTE, MINUTE)(
  withPublicRoute<TokenParams>({ reason: PUBLIC_REASON }, async (req: NextRequest, ctx) => {
    const resolved = await resolveInvite(await tokenOf(ctx))
    if (resolved.state !== 'valid' || !resolved.invite) {
      return NextResponse.json({ state: resolved.state }, { status: resolved.state === 'invalid' ? 404 : 410 })
    }

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const kind = form.get('kind')
    const file = form.get('file')

    if (!isDocumentKind(kind)) {
      return NextResponse.json({ error: 'unknown_document_kind' }, { status: 400 })
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file_missing' }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'file_empty' }, { status: 400 })
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      return NextResponse.json(
        { error: 'file_too_large', byteSize: file.size, maxBytes: DOCUMENT_MAX_BYTES },
        { status: 413 }
      )
    }
    if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
      return NextResponse.json({ error: 'file_type_refused', mimeType: file.type }, { status: 415 })
    }
    if ((resolved.documents ?? []).length >= DOCUMENT_MAX_FILES) {
      return NextResponse.json({ error: 'too_many_files', maxFiles: DOCUMENT_MAX_FILES }, { status: 409 })
    }

    // No "create the draft first" branch: the proposal exists from the moment the invite
    // is minted (`core.tg_partner_form_invite_attach`), so a file chosen before the first
    // autosave already has somewhere to hang. An open invite with no proposal behind it
    // is a read that failed, and inventing a row here would be the second place that
    // decides what a proposal is.
    const submissionId = resolved.submission?.id
    if (!submissionId) {
      console.error('[partner-form] no proposal to attach a document to, invite', resolved.invite.id)
      return NextResponse.json({ error: 'upload_failed' }, { status: 503 })
    }

    const stored = await storeDocument(submissionId, {
      kind,
      fileName: file.name,
      mimeType: file.type,
      bytes: await file.arrayBuffer(),
    })

    if (!stored.ok) {
      console.error('[partner-form] upload failed for invite', resolved.invite.id, 'kind', kind)
      return NextResponse.json({ error: 'upload_failed' }, { status: 503 })
    }

    return NextResponse.json({ id: stored.documentId, kind, fileName: file.name, byteSize: file.size })
  })
)

/** Removes a file the person picked by mistake — the `Remover` of DS-COMPONENTE-016. */
export const DELETE = withRateLimit(UPLOAD_PER_MINUTE, MINUTE)(
  withPublicRoute<TokenParams>({ reason: PUBLIC_REASON }, async (req: NextRequest, ctx) => {
    const resolved = await resolveInvite(await tokenOf(ctx))
    if (resolved.state !== 'valid' || !resolved.invite || !resolved.submission) {
      return NextResponse.json({ state: resolved.state }, { status: resolved.state === 'invalid' ? 404 : 410 })
    }

    const documentId = new URL(req.url).searchParams.get('id') ?? ''
    if (!documentId) return NextResponse.json({ error: 'document_missing' }, { status: 400 })

    const removed = await removeDocument(resolved.submission.id, documentId)
    if (!removed) return NextResponse.json({ error: 'document_not_found' }, { status: 404 })

    return NextResponse.json({ removed: true })
  })
)
