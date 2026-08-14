/**
 * Uploads for the public partner form (#341) — one file per request, on choice.
 *
 * The file goes up the moment it is chosen and not when the step is submitted, so a 4G
 * drop costs one file instead of the whole form (DS-COMPONENTE-016, item 3). Files
 * accumulate; they never replace one another.
 *
 * `accept` on the input is a hint and validates nothing (MDN, `input type=file`), so the
 * authoritative refusal is here: type and size are checked before a byte reaches storage,
 * and the bucket is private — nothing in this feature ever returns a public URL.
 *
 * The bytes are read into memory once and only up to the declared limit; the size check
 * happens before the read so an oversized upload is refused, not buffered.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withPublicRoute, withRateLimit } from '@/lib/auth-middleware'
import {
  resolveInvite,
  storeDocument,
  removeDocument,
  saveDraft,
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

    // A file can arrive before the first autosave, so the draft row may not exist yet.
    let submissionId = resolved.submission?.id
    if (!submissionId) {
      const created = await saveDraft(resolved.invite.id, {})
      submissionId = created.submissionId
    }
    if (!submissionId) {
      console.error('[partner-form] no draft to attach a document to, invite', resolved.invite.id)
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
