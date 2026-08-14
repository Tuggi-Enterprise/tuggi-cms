'use client'

import React, { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_MB,
  DOCUMENT_MIME_TYPES,
  DOCUMENT_ACCEPTS_MULTIPLE,
  type PartnerDocumentKind,
} from '@/lib/partner-form/fields'
import { BUTTON_SECONDARY, FIELD_ERROR, FIELD_HELP, FIELD_LABEL } from './styles'

/**
 * Upload on an external phone surface — DS-COMPONENTE-016, item by item:
 *
 *  1. No `capture`. Present, it asks for the camera and hides the gallery and the files
 *     (MDN, `input type=file`); the alvará is usually already a PDF in the mailbox.
 *  2. The trigger is a real `<label>` over a full-width 48 px button, never the native
 *     "Choose file".
 *  3. The file goes up the moment it is chosen, so a dropped connection loses one file
 *     and not the form.
 *  4. Choices accumulate and never replace each other; `Adicionar mais páginas` appears
 *     after the first.
 *  5. Each file has its own visible state, with the percentage IN TEXT, and a failure of
 *     one does not block the others or the rest of the form.
 *  6. Thumbnail after the upload, with `Trocar` — it is how someone finds out the photo
 *     came out blurred.
 *  7. The size limit and the accepted formats appear BEFORE the choice.
 *  8. `accept` is only a hint; the authoritative refusal is the route's, and its message
 *     says what to do.
 *  9. A finished upload is announced by `role="status"`.
 */

export interface UploadedDocument {
  id: string
  kind: PartnerDocumentKind
  fileName: string
  byteSize: number
}

interface PendingUpload {
  key: string
  fileName: string
  percent: number
  failed: boolean
  previewUrl?: string
  errorMessage?: string
}

interface DocumentUploaderProps {
  kind: PartnerDocumentKind
  documents: UploadedDocument[]
  onUpload: (
    kind: PartnerDocumentKind,
    file: File,
    onProgress: (percent: number) => void
  ) => Promise<{ ok: true; document: UploadedDocument } | { ok: false; message: string }>
  onRemove: (documentId: string) => Promise<boolean>
}

export function DocumentUploader({ kind, documents, onUpload, onRemove }: DocumentUploaderProps) {
  const t = useTranslations('PartnerForm')
  const [pending, setPending] = useState<PendingUpload[]>([])
  const [announcement, setAnnouncement] = useState('')
  /**
   * Thumbnails, by document id. They come from the browser's own copy of the file
   * (`URL.createObjectURL`) and never from the server: the bucket is private, and a
   * public route that handed out URLs to uploaded documents would undo the reason it is
   * private. The trade-off is stated: reopening the link on another device shows the file
   * name and not the thumbnail.
   */
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  const inputId = `partner-document-${kind}`
  const helpId = `${inputId}-help`
  const multiple = DOCUMENT_ACCEPTS_MULTIPLE[kind]
  const hasFiles = documents.length > 0 || pending.length > 0

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return

    for (const file of Array.from(files)) {
      const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      // For a single-page document, choosing again means replacing: the previous file is
      // removed only AFTER the new one is safely up, so a failed replacement never leaves
      // the person with nothing.
      const replacing = multiple ? null : (documents[0]?.id ?? null)

      setPending((current) => [...current, { key, fileName: file.name, percent: 0, failed: false, previewUrl }])

      const result = await onUpload(kind, file, (percent) => {
        setPending((current) =>
          current.map((item) => (item.key === key ? { ...item, percent } : item))
        )
      })

      if (result.ok) {
        setPending((current) => current.filter((item) => item.key !== key))
        if (previewUrl) {
          setPreviews((current) => ({ ...current, [result.document.id]: previewUrl }))
        }
        if (replacing) await onRemove(replacing)
        setAnnouncement(t('step4.announceUploaded', { document: t(`documents.${kind}.label`) }))
      } else {
        setPending((current) =>
          current.map((item) =>
            item.key === key ? { ...item, failed: true, errorMessage: result.message } : item
          )
        )
      }
    }

    // Lets the same file be chosen again after a failure.
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <section className="mb-8">
      <h3 className={FIELD_LABEL}>{t(`documents.${kind}.label`)}</h3>
      <p id={helpId} className={FIELD_HELP}>
        {t(`documents.${kind}.help`)}
      </p>
      <p className={FIELD_HELP}>{t('step4.limits', { max: DOCUMENT_MAX_MB })}</p>

      <ul className="mt-3 space-y-2">
        {documents.map((document) => (
          <li
            key={document.id}
            className="flex items-center justify-between gap-3 rounded-md border border-input bg-white p-3"
          >
            <span className="flex min-w-0 items-center gap-2">
              {previews[document.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previews[document.id]}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded object-cover"
                />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary-800" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-base text-gray-900">{document.fileName}</span>
                <span className="block text-sm text-gray-700">
                  {formatBytes(document.byteSize)} · {t('step4.uploaded')}
                </span>
              </span>
            </span>
            <button
              type="button"
              onClick={() => onRemove(document.id)}
              className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-md border border-input text-primary-800"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">
                {t('step4.remove')} {document.fileName}
              </span>
            </button>
          </li>
        ))}

        {pending.map((item) => (
          <li key={item.key} className="rounded-md border border-input bg-white p-3">
            <span className="block truncate text-base text-gray-900">{item.fileName}</span>
            {item.failed ? (
              <>
                <p className={FIELD_ERROR}>
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.errorMessage ?? t('errors.upload_failed')}</span>
                </p>
                <p className={FIELD_HELP}>{t('states.uploadFailedBody')}</p>
              </>
            ) : (
              <div
                role="progressbar"
                aria-valuenow={item.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={item.fileName}
                className="mt-2"
              >
                {/* The percentage is text as well as a bar: a bar alone is state by
                    length only, which DS-A11Y-003 refuses. */}
                <span className="text-sm text-gray-700">
                  {t('step4.uploading', { percent: item.percent })}
                </span>
                <span className="mt-1 block h-2 w-full rounded bg-gray-200">
                  <span
                    className="block h-2 rounded bg-primary-800"
                    style={{ width: `${item.percent}%` }}
                  />
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* No `capture`: the system offers Camera / Photos / Files and the person picks. */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        multiple={multiple}
        accept={DOCUMENT_MIME_TYPES.join(',')}
        aria-describedby={helpId}
        onChange={(event) => handleFiles(event.target.files)}
      />
      <label htmlFor={inputId} className={`${BUTTON_SECONDARY} mt-3 cursor-pointer`}>
        {!hasFiles ? t('step4.choose') : multiple ? t('step4.addMore') : t('step4.replace')}
      </label>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  )
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export { DOCUMENT_MAX_BYTES }
