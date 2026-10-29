'use client'

/**
 * Upload of a social media file STRAIGHT from the browser to the bucket `social-media` (#1058),
 * with the operator's session. It does not go through an API route of the CMS: a Vercel Function
 * cuts the request body at 4.5 MB and a reels goes up to 300 MB. The bucket policies
 * (`social_media_admin_insert`) let only `core.is_caller_platform_admin()` write.
 *
 * Up to 6 MB, the standard `storage.upload`. Above it, the resumable (TUS) upload, as the Supabase
 * doc prescribes ("Resumable Uploads", read 2026-10-29): supabase-js has no TUS method, the client
 * is `tus-js-client`, the endpoint is the direct storage host, and the chunk MUST be 6 MB.
 */

import * as tus from 'tus-js-client'
import { getSupabaseClient } from '@/lib/core/supabase-client'
import { SOCIAL_BUCKET } from './post'

export const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024
const TUS_CHUNK_BYTES = 6 * 1024 * 1024

/** `https://<ref>.supabase.co` becomes `https://<ref>.storage.supabase.co` (the direct storage host). */
export function resumableEndpoint(supabaseUrl: string): string {
  const base = supabaseUrl.replace(/\/+$/, '')
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co$/i.exec(base)
  const host = match ? `https://${match[1]}.storage.supabase.co` : base
  return `${host}/storage/v1/upload/resumable`
}

export async function uploadSocialMedia(
  file: File,
  path: string,
  onProgress: (fraction: number) => void
): Promise<void> {
  const supabase = getSupabaseClient()

  if (file.size <= RESUMABLE_THRESHOLD_BYTES) {
    const { error } = await supabase.storage
      .from(SOCIAL_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' })
    if (error) throw new Error(error.message)
    onProgress(1)
    return
  }

  const { data, error } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (error || !token) throw new Error('no session')

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: resumableEndpoint(process.env.NEXT_PUBLIC_SUPABASE_URL || ''),
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${token}`, 'x-upsert': 'false' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: SOCIAL_BUCKET, objectName: path, contentType: file.type, cacheControl: '3600' },
      chunkSize: TUS_CHUNK_BYTES,
      onError: reject,
      onProgress: (sent, total) => onProgress(total ? sent / total : 0),
      onSuccess: () => resolve(),
    })
    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length) upload.resumeFromPreviousUpload(previous[0])
        upload.start()
      })
      .catch(reject)
  })
}
