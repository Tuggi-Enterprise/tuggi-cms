/**
 * `POST /api/admin/app-campaigns/image` (#1192): the campaign image, into the public bucket the app
 * reads images from, under `in-app-campaigns/<uuid>.<ext>`. Answers the https public URL the form
 * writes into `image_url` (`in_app_campaigns_image_url_ck` accepts https only).
 *
 * The type is read from the file's first bytes, not from what the browser declares: JPEG, PNG or
 * WebP, up to `CAMPAIGN_IMAGE_MAX_BYTES`. A new name per upload, never `upsert`, so replacing the
 * image of a running campaign never rewrites the file the app already cached under the old URL.
 * Gate: `withAuth({ roles: ['admin'] })`, then the service role.
 */

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  CAMPAIGN_IMAGE_FOLDER,
  CAMPAIGN_IMAGE_MAX_BYTES,
  campaignErrorStatus,
  sniffImageType,
  type CampaignError,
} from '@/lib/campaigns/app-campaigns'
import { PUBLIC_IMAGE_BUCKET } from '@/lib/partnerships/place-changes'

function refuse(error: CampaignError): NextResponse {
  return NextResponse.json({ error }, { status: campaignErrorStatus(error) })
}

export const POST = withAuth({ roles: ['admin'] }, async (req) => {
  let file: FormDataEntryValue | null
  try {
    file = (await req.formData()).get('file')
  } catch {
    return refuse({ code: 'invalid_image' })
  }
  if (!file || typeof file === 'string') return refuse({ code: 'invalid_image' })
  if (file.size > CAMPAIGN_IMAGE_MAX_BYTES) return refuse({ code: 'image_too_large' })

  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffImageType(bytes)
  if (!type) return refuse({ code: 'invalid_image' })

  const path = `${CAMPAIGN_IMAGE_FOLDER}/${randomUUID()}.${type.ext}`
  const bucket = getSupabaseService().storage.from(PUBLIC_IMAGE_BUCKET)
  const { error } = await bucket.upload(path, bytes, { contentType: type.contentType, upsert: false })
  if (error) {
    console.error('[app-campaigns] image upload failed:', error.message)
    return refuse({ code: 'upload_failed' })
  }
  const url = bucket.getPublicUrl(path).data.publicUrl
  if (!url.startsWith('https://')) return refuse({ code: 'upload_failed' })
  return NextResponse.json({ url }, { status: 201 })
})
