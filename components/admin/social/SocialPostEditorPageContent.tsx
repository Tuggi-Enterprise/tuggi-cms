'use client'

/**
 * `/admin/social/new` and `/admin/social/[id]`: the editor of one post (#1058, spec section 3).
 *
 * The id of a new post is made HERE, when the form opens: the media folder in the bucket and the
 * download link need it before the first save. Each file goes up when it is dropped, straight to
 * Storage (`lib/social/upload.ts`), so Agendar is instant and a failed upload shows on its piece.
 *
 * The button stays enabled and validation runs on click (`validatePost`, the same function the
 * route runs): every field gets `aria-invalid` and its sentence, focus goes to the first one.
 *
 * Drag to reorder is out of this delivery: the arrows are the required path (WCAG 2.5.7) and they
 * are here. Status after a retry shows on reload; the screen does not poll.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowLeft, ArrowRight, Copy, ExternalLink, LoaderCircle, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/Container'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DIM } from '@/components/ui/dense-table'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { parseReturnLabel, parseReturnTo, RETURN_LABEL_PARAM, RETURN_TO_PARAM } from '@/lib/navigation/return-to'
import {
  CAPTION_MAX,
  CAROUSEL_MAX,
  FIELD_ORDER,
  NETWORKS,
  captionLength,
  downloadLink,
  fileTypeError,
  imageRatioOk,
  isCancelable,
  lockReasonOf,
  mediaKindOf,
  mediaStoragePath,
  validatePost,
  videoDurationOk,
  type MediaType,
  type Network,
  type PostError,
  type PostTarget,
  type SocialPost,
} from '@/lib/social/post'
import {
  formatDateTime,
  minScheduleInstant,
  minScheduleWallTime,
  monthKeyOf,
  parseDayKey,
  parseInputValue,
  SCHEDULE_STEP_MINUTES,
  toInputValue,
  wallTimeAt,
  wallTimeToInstant,
} from '@/lib/social/time'
import { uploadSocialMedia } from '@/lib/social/upload'
import { Monogram, StatusGlyph, useNetworkName } from './status'
import { LINK_OUTLINE, SCHEDULED_PARAM, useMediaTypeName } from './SocialAgendaPageContent'

type PieceState = 'uploading' | 'failed' | 'ready' | 'invalid'

interface Piece {
  key: string
  name: string
  mime_type: string
  preview: string
  state: PieceState
  progress: number
  storage_path?: string
  /** Sentence already composed: why this file cannot go (type, size, ratio, duration). */
  problem?: string
  file?: File
}

const TYPES: MediaType[] = ['IMAGE', 'CAROUSEL', 'REELS']
const FIELD_ID = {
  networks: 'social-network-instagram',
  media: 'social-media-input',
  caption: 'social-caption',
  scheduled_at: 'social-scheduled-at',
} as const

const uuid = () => crypto.randomUUID()

function measureImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: 0, height: 0 })
    img.src = url
  })
}

function measureVideo(url: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => resolve(video.duration)
    video.onerror = () => resolve(NaN)
    video.src = url
  })
}

/** Why a piece does not serve the chosen type, or `null`. Shown on the piece itself (spec 3.2). */
function typeProblemCode(mime: string, type: MediaType): 'image_is_video' | 'carousel_is_video' | 'reels_no_video' | null {
  const kind = mediaKindOf(mime)
  if (type === 'IMAGE' && kind === 'video') return 'image_is_video'
  if (type === 'CAROUSEL' && kind === 'video') return 'carousel_is_video'
  if (type === 'REELS' && kind === 'image') return 'reels_no_video'
  return null
}

export function SocialPostEditorPageContent({ postId }: { postId: string | null }) {
  const t = useTranslations('Pages.Social')
  const tActions = useTranslations('Common.actions')
  const tStatus = useTranslations('Common.status')
  const networkName = useNetworkName()
  const typeName = useMediaTypeName()
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'pt'
  const router = useRouter()
  const search = useSearchParams()

  const isNew = postId === null
  const [id] = useState(() => postId ?? uuid())
  const returnTo = parseReturnTo(search.get(RETURN_TO_PARAM)) ?? `/${locale}/admin/social`
  const returnLabel = parseReturnLabel(search.get(RETURN_LABEL_PARAM), returnTo) ?? t('title')

  const [post, setPost] = useState<SocialPost | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed' | 'not_found'>(isNew ? 'ready' : 'loading')

  const [networks, setNetworks] = useState<Network[]>(['instagram', 'facebook'])
  const [mediaType, setMediaType] = useState<MediaType>('IMAGE')
  const [caption, setCaption] = useState('')
  const [schedule, setSchedule] = useState(() => {
    const day = parseDayKey(search.get('date'))
    return day ? toInputValue({ ...day, hour: 12, minute: 0 }) : ''
  })
  const [pieces, setPieces] = useState<Piece[]>([])
  const [mediaOverflow, setMediaOverflow] = useState(0)

  const [errors, setErrors] = useState<PostError[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (isNew) return
    setLoadState('loading')
    try {
      const response = await fetch(`/api/admin/social/posts/${id}`, { cache: 'no-store' })
      if (response.status === 404) return setLoadState('not_found')
      if (!response.ok) throw new Error(String(response.status))
      const { post: loaded } = (await response.json()) as { post: SocialPost }
      setPost(loaded)
      setNetworks(loaded.post_targets.map((x) => x.network))
      setMediaType(loaded.media_type)
      setCaption(loaded.caption)
      setSchedule(toInputValue(wallTimeAt(new Date(loaded.scheduled_at))))
      setPieces(
        loaded.post_media.map((m) => ({
          key: m.storage_path,
          name: m.storage_path.split('/').pop() ?? m.storage_path,
          mime_type: m.mime_type,
          preview: m.url ?? '',
          state: 'ready' as const,
          progress: 1,
          storage_path: m.storage_path,
        }))
      )
      setLoadState('ready')
    } catch {
      setLoadState('failed')
    }
  }, [id, isNew])

  useEffect(() => {
    void load()
  }, [load])

  const lock = post ? lockReasonOf(post.post_targets) : null
  const locked = lock !== null

  // ── Media ─────────────────────────────────────────────────────────────────────────────

  const startUpload = useCallback(
    (piece: Piece, position: number) => {
      if (!piece.file) return
      const path = mediaStoragePath(id, position, uuid(), piece.mime_type)
      const update = (patch: Partial<Piece>) =>
        setPieces((all) => all.map((p) => (p.key === piece.key ? { ...p, ...patch } : p)))
      update({ state: 'uploading', progress: 0 })
      uploadSocialMedia(piece.file, path, (progress) => update({ progress }))
        .then(() => update({ state: 'ready', progress: 1, storage_path: path }))
        .catch(() => update({ state: 'failed' }))
    },
    [id]
  )

  const addFiles = async (list: FileList | null) => {
    if (!list || locked) return
    let files = Array.from(list)
    const room = mediaType === 'CAROUSEL' ? CAROUSEL_MAX - pieces.length : files.length
    setMediaOverflow(Math.max(0, files.length - Math.max(room, 0)))
    files = files.slice(0, Math.max(room, 0))

    const created: Piece[] = []
    for (const file of files) {
      const preview = URL.createObjectURL(file)
      const base: Piece = { key: uuid(), name: file.name, mime_type: file.type, preview, state: 'invalid', progress: 0, file }
      const typeError = fileTypeError(file)
      if (typeError) {
        created.push({
          ...base,
          problem:
            typeError.code === 'file_too_big'
              ? t('errors.file_too_big', { name: file.name, max: typeError.max ?? '' })
              : t('errors.file_type', { name: file.name }),
        })
        continue
      }
      if (mediaKindOf(file.type) === 'image') {
        const { width, height } = await measureImage(preview)
        if (!imageRatioOk(width, height)) {
          created.push({ ...base, problem: t('errors.image_ratio', { name: file.name }) })
          continue
        }
      } else if (!videoDurationOk(await measureVideo(preview))) {
        created.push({ ...base, problem: t('errors.video_duration', { name: file.name }) })
        continue
      }
      created.push({ ...base, state: 'uploading' })
    }
    const offset = pieces.length
    setPieces((all) => [...all, ...created])
    created.forEach((piece, index) => {
      if (piece.state === 'uploading') startUpload(piece, offset + index + 1)
    })
  }

  const move = (index: number, delta: number) =>
    setPieces((all) => {
      const next = [...all]
      const [item] = next.splice(index, 1)
      next.splice(index + delta, 0, item)
      return next
    })
  const remove = (index: number) => setPieces((all) => all.filter((_, i) => i !== index))

  // ── Submit ────────────────────────────────────────────────────────────────────────────

  const scheduledIso = useMemo(() => {
    const wall = parseInputValue(schedule)
    return wall ? wallTimeToInstant(wall).toISOString() : null
  }, [schedule])

  const errorOf = (field: PostError['field']) => errors.find((e) => e.field === field)
  const sentence = (e: PostError) => t(`errors.${e.code}`, e.values ?? {})

  const submit = async () => {
    setRefusal(null)
    setNotice(null)
    const ready = pieces.filter((p) => p.state === 'ready' && p.storage_path)
    const found = validatePost(
      {
        networks,
        media_type: mediaType,
        caption,
        scheduled_at: scheduledIso,
        media: pieces.filter((p) => p.state !== 'invalid').map((p) => ({ mime_type: p.mime_type })),
      },
      minScheduleInstant(new Date())
    )
    const badPiece = pieces.findIndex((p) => p.state !== 'ready' || typeProblemCode(p.mime_type, mediaType))
    if (badPiece >= 0 && !found.some((e) => e.field === 'media')) found.push({ field: 'media', code: 'media_pending' })
    found.sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field))
    setErrors(found)
    if (found.length) {
      const first = found[0]
      const target = first.field === 'media' && badPiece >= 0 ? `social-piece-${badPiece}` : FIELD_ID[first.field]
      document.getElementById(target)?.focus()
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(isNew ? '/api/admin/social/posts' : `/api/admin/social/posts/${id}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          networks,
          media_type: mediaType,
          caption,
          scheduled_at: scheduledIso,
          media: ready.map((p) => ({ storage_path: p.storage_path, mime_type: p.mime_type })),
        }),
      })
      if (response.status === 409) {
        const body = await response.json().catch(() => null)
        const reason = body?.error?.reason
        setRefusal(reason ? t(`locked.${reason}`) : t('toast.save_failed'))
        void load()
        return
      }
      if (response.status === 422) {
        const body = await response.json().catch(() => null)
        setErrors((body?.error?.errors as PostError[]) ?? [])
        setRefusal(t('errors.fix_first'))
        return
      }
      if (!response.ok) throw new Error(String(response.status))
      if (isNew && scheduledIso) {
        const month = monthKeyOf(wallTimeAt(new Date(scheduledIso)))
        router.push(`/${locale}/admin/social?${new URLSearchParams({ month, [SCHEDULED_PARAM]: scheduledIso }).toString()}`)
        return
      }
      setNotice(t('toast.saved'))
      setTimeout(() => setNotice(null), 2000)
      void load()
    } catch {
      setRefusal(t('toast.save_failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const cancelPost = async () => {
    setRefusal(null)
    try {
      const response = await fetch(`/api/admin/social/posts/${id}/cancel`, { method: 'POST' })
      if (!response.ok && response.status !== 409) throw new Error(String(response.status))
      setNotice(t('toast.canceled'))
      void load()
    } catch {
      setRefusal(t('toast.save_failed'))
    }
  }

  const retry = async (target: PostTarget) => {
    setRefusal(null)
    try {
      const response = await fetch(`/api/admin/social/targets/${target.id}/retry`, { method: 'POST' })
      if (!response.ok) throw new Error(String(response.status))
      setPost((p) =>
        p ? { ...p, post_targets: p.post_targets.map((x) => (x.id === target.id ? { ...x, status: 'scheduled', error: null } : x)) } : p
      )
      setNotice(t('toast.retry_queued'))
    } catch {
      setRefusal(t('toast.save_failed'))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────────────

  const header = (
    <header className="mb-6">
      <Link href={returnTo} className="mb-2 inline-flex items-center gap-1 text-sm text-primary-800 hover:underline dark:text-tuggi-blue">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {returnLabel}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t(isNew ? 'form.title_new' : 'form.title_edit')}</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{t('tz_note')}</p>
    </header>
  )

  if (loadState !== 'ready') {
    return (
      <Frame>
        {header}
        {loadState === 'loading' ? (
          <p className={`text-sm ${DIM}`}>{tStatus('loading')}</p>
        ) : (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <span>{loadState === 'not_found' ? t('not_found') : t('load_failed')}</span>
            {loadState === 'failed' ? (
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t('retry')}
              </Button>
            ) : null}
          </div>
        )}
      </Frame>
    )
  }

  const captionCount = captionLength(caption)
  const captionOver = captionCount - CAPTION_MAX
  const minValue = toInputValue(minScheduleWallTime(new Date()))
  const link = downloadLink(id)
  const lockedField = locked ? 'bg-gray-50 dark:bg-gray-950' : ''
  const cancelable = post ? post.post_targets.some(isCancelable) : false

  return (
    <Frame>
      {header}
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="space-y-6"
        >
          {lock ? <p className={`text-xs ${DIM}`}>{t(`locked.${lock}`)}</p> : null}

          <fieldset aria-describedby={errorOf('networks') ? 'social-networks-error' : undefined}>
            <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{t('form.networks_label')}</legend>
            <div className="flex flex-wrap gap-4">
              {NETWORKS.map((network) => (
                <label key={network} className="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                  <Checkbox
                    id={`social-network-${network}`}
                    checked={networks.indexOf(network) >= 0}
                    disabled={locked}
                    aria-invalid={errorOf('networks') ? true : undefined}
                    onCheckedChange={(checked) =>
                      setNetworks((all) =>
                        checked ? NETWORKS.filter((n) => n === network || all.indexOf(n) >= 0) : all.filter((n) => n !== network)
                      )
                    }
                  />
                  <Monogram network={network} />
                  {networkName(network)}
                </label>
              ))}
            </div>
            <p className={`mt-1 text-xs ${DIM}`}>{t('form.networks_hint')}</p>
            <FieldError id="social-networks-error" error={errorOf('networks')} sentence={sentence} />
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{t('form.type_label')}</legend>
            <div className="flex flex-wrap gap-4">
              {TYPES.map((type) => (
                <label key={type} className="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                  <input
                    type="radio"
                    name="social-media-type"
                    value={type}
                    checked={mediaType === type}
                    disabled={locked}
                    onChange={() => setMediaType(type)}
                  />
                  {typeName(type)}
                </label>
              ))}
            </div>
            <p className={`mt-1 text-xs ${DIM}`}>
              {mediaType === 'IMAGE'
                ? t('form.type_image_hint')
                : mediaType === 'CAROUSEL'
                  ? t('form.type_carousel_hint', { max: CAROUSEL_MAX })
                  : t('form.type_reels_hint')}
            </p>
          </fieldset>

          <section aria-labelledby="social-media-label">
            <p id="social-media-label" className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('media.label')}
            </p>
            {!locked ? (
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  void addFiles(event.dataTransfer.files)
                }}
                className={`rounded-xl border-2 border-dashed p-6 text-center ${errorOf('media') ? 'border-red-700' : 'border-gray-200 dark:border-gray-700'}`}
              >
                <label className="flex cursor-pointer flex-col items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <Upload className="h-5 w-5 text-gray-500" aria-hidden />
                  <span>{t('media.drop')}</span>
                  <input
                    id={FIELD_ID.media}
                    type="file"
                    multiple={mediaType === 'CAROUSEL'}
                    accept={mediaType === 'REELS' ? 'video/mp4,video/quicktime' : 'image/jpeg'}
                    className="sr-only"
                    aria-invalid={errorOf('media') ? true : undefined}
                    aria-describedby="social-media-specs social-media-error"
                    onChange={(event) => {
                      void addFiles(event.currentTarget.files)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
                <p id="social-media-specs" className={`mt-2 text-xs ${DIM}`}>
                  {t('media.specs')}
                  {mediaType === 'CAROUSEL' ? <> · {t('media.count', { count: pieces.length, max: CAROUSEL_MAX })}</> : null}
                </p>
              </div>
            ) : null}

            {pieces.length > 0 ? (
              <ol className="mt-3 flex flex-wrap gap-2">
                {pieces.map((piece, index) => (
                  <PieceTile
                    key={piece.key}
                    piece={piece}
                    index={index}
                    count={pieces.length}
                    locked={locked}
                    typeProblem={(() => {
                      const code = typeProblemCode(piece.mime_type, mediaType)
                      return code ? t(`errors.${code}`) : null
                    })()}
                    onMove={(delta) => move(index, delta)}
                    onRemove={() => remove(index)}
                    onRetry={() => startUpload(piece, index + 1)}
                  />
                ))}
              </ol>
            ) : null}
            {mediaType === 'CAROUSEL' ? <p className={`mt-2 text-xs ${DIM}`}>{t('media.order_hint')}</p> : null}
            {mediaOverflow > 0 ? (
              <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                {t('errors.carousel_too_many', { max: CAROUSEL_MAX, over: mediaOverflow })}
              </p>
            ) : null}
            {errorOf('media') ? (
              <p id="social-media-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
                {sentence(errorOf('media')!)}
              </p>
            ) : null}
          </section>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label htmlFor={FIELD_ID.caption}>{t('caption.label')}</Label>
              <span className={`text-xs tabular-nums ${captionOver > 0 ? 'text-red-700 dark:text-red-400' : DIM}`} aria-live="polite">
                {captionOver > 0
                  ? t('caption.counter_over', { over: captionOver })
                  : t('caption.counter', { count: captionCount, max: CAPTION_MAX })}
              </span>
            </div>
            <Textarea
              id={FIELD_ID.caption}
              value={caption}
              readOnly={locked}
              aria-readonly={locked || undefined}
              aria-invalid={errorOf('caption') ? true : undefined}
              aria-describedby="social-caption-hint social-caption-error"
              placeholder={t('caption.placeholder')}
              onChange={(event) => setCaption(event.target.value)}
              className={`min-h-[320px] rounded-xl border-gray-200 focus:ring-tuggi-blue ${lockedField}`}
            />
            <p id="social-caption-hint" className={`mt-1 text-xs ${DIM}`}>
              {t('caption.hint')}
            </p>
            <FieldError id="social-caption-error" error={errorOf('caption')} sentence={sentence} />
          </div>

          <div>
            <Label htmlFor={FIELD_ID.scheduled_at}>{t('schedule.label')}</Label>
            <Input
              id={FIELD_ID.scheduled_at}
              type="datetime-local"
              step={SCHEDULE_STEP_MINUTES * 60}
              min={minValue}
              value={schedule}
              readOnly={locked}
              aria-readonly={locked || undefined}
              aria-invalid={errorOf('scheduled_at') ? true : undefined}
              aria-describedby="social-schedule-hint social-schedule-error"
              onChange={(event) => setSchedule(event.target.value)}
              className={`mt-1 max-w-xs ${lockedField}`}
            />
            <p id="social-schedule-hint" className={`mt-1 text-xs ${DIM}`}>
              {t('schedule.hint')}
            </p>
            <FieldError id="social-schedule-error" error={errorOf('scheduled_at')} sentence={sentence} />
          </div>

          {refusal ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {refusal}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {!locked ? (
              <Button type="submit" variant="cta" disabled={submitting}>
                {submitting ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                {submitting ? t('actions.scheduling') : isNew ? t('actions.schedule') : tActions('save')}
              </Button>
            ) : null}
            <Link href={returnTo} className={LINK_OUTLINE}>
              {tActions('back')}
            </Link>
            <span role="status" className="text-xs text-green-700 dark:text-green-400">
              {notice}
            </span>
            {!isNew && cancelable ? (
              <Button type="button" variant="outline" className="ml-auto" onClick={() => void cancelPost()}>
                {t('actions.cancel_post')}
              </Button>
            ) : null}
          </div>
        </form>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <LinkPanel link={link} />
          {post ? <PublicationPanel targets={post.post_targets} onRetry={(target) => void retry(target)} /> : null}
        </aside>
      </div>
    </Frame>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="py-8">{children}</Container>
    </div>
  )
}

function FieldError({ id, error, sentence }: { id: string; error?: PostError; sentence: (e: PostError) => string }) {
  if (!error) return null
  return (
    <p id={id} className="mt-1 text-xs text-red-700 dark:text-red-400">
      {sentence(error)}
    </p>
  )
}

function PieceTile({
  piece,
  index,
  count,
  locked,
  typeProblem,
  onMove,
  onRemove,
  onRetry,
}: {
  piece: Piece
  index: number
  count: number
  locked: boolean
  typeProblem: string | null
  onMove: (delta: number) => void
  onRemove: () => void
  onRetry: () => void
}) {
  const t = useTranslations('Pages.Social')
  const problem = piece.problem ?? (piece.state === 'failed' ? t('media.upload_failed', { name: piece.name }) : typeProblem)
  const bad = Boolean(problem)
  const isVideo = mediaKindOf(piece.mime_type) === 'video'
  const tileButton =
    'inline-flex h-6 w-6 items-center justify-center rounded bg-white/90 text-gray-800 hover:bg-white disabled:opacity-40 dark:bg-gray-900/90 dark:text-gray-100'

  return (
    <li className="w-24">
      <div
        id={`social-piece-${index}`}
        tabIndex={-1}
        aria-label={t('media.item_aria', { index: index + 1, count })}
        aria-describedby={problem ? `social-piece-${index}-problem` : undefined}
        className={`relative h-24 w-24 overflow-hidden rounded-lg border ${bad ? 'border-red-700' : 'border-gray-200 dark:border-gray-700'} ${
          piece.state === 'uploading' ? 'opacity-60' : ''
        }`}
      >
        {piece.preview ? (
          isVideo ? (
            <video src={piece.preview} preload="metadata" muted className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={piece.preview} alt="" className="h-full w-full object-cover" />
          )
        ) : null}
        <span className="absolute left-1 top-1 rounded bg-white/90 px-1 text-[11px] font-semibold text-gray-900">
          {index + 1}
          {index === 0 ? ` · ${t('media.cover')}` : ''}
        </span>
        {!locked ? (
          <span className="absolute inset-x-1 bottom-1 flex justify-between">
            {piece.state === 'failed' ? (
              <button type="button" className={`${tileButton} w-auto px-1 text-[11px]`} onClick={onRetry}>
                {t('actions.retry')}
              </button>
            ) : (
              <>
                <button type="button" className={tileButton} aria-label={t('media.move_up')} disabled={index === 0} onClick={() => onMove(-1)}>
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className={tileButton}
                  aria-label={t('media.move_down')}
                  disabled={index === count - 1}
                  onClick={() => onMove(1)}
                >
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              </>
            )}
            <button type="button" className={tileButton} aria-label={t('media.remove_aria', { index: index + 1 })} onClick={onRemove}>
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        ) : null}
        {piece.state === 'uploading' ? (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-gray-200" aria-hidden>
            <span className="block h-1 bg-primary-800" style={{ width: `${Math.round(piece.progress * 100)}%` }} />
          </span>
        ) : null}
      </div>
      {piece.state === 'uploading' ? (
        <p className={`mt-1 truncate text-[11px] ${DIM}`}>{t('media.uploading', { name: piece.name })}</p>
      ) : null}
      {problem ? (
        <p id={`social-piece-${index}-problem`} className="mt-1 text-xs text-red-700 dark:text-red-400">
          {problem}
        </p>
      ) : null}
    </li>
  )
}

function LinkPanel({ link }: { link: string }) {
  const t = useTranslations('Pages.Social')
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied('copied')
    } catch {
      setCopied('failed')
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied('idle'), 2000)
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <Label htmlFor="social-link">{t('link.label')}</Label>
      <div className="mt-1 flex gap-2">
        <Input id="social-link" readOnly value={link} className="text-xs" onFocus={(event) => event.currentTarget.select()} />
        <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => void copy()}>
          <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
          {copied === 'copied' ? t('link.copied') : t('link.copy')}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {copied === 'copied' ? t('link.copied') : ''}
      </p>
      {copied === 'failed' ? <p className="mt-1 text-xs text-red-700 dark:text-red-400">{t('link.copy_failed')}</p> : null}
      <p className={`mt-2 text-xs ${DIM}`}>{t('link.hint')}</p>
    </section>
  )
}

function PublicationPanel({ targets, onRetry }: { targets: PostTarget[]; onRetry: (target: PostTarget) => void }) {
  const t = useTranslations('Pages.Social')
  const networkName = useNetworkName()
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      {targets.map((target, index) => {
        const when = target.status === 'published' && target.published_at ? target.published_at : target.updated_at
        return (
          <div key={target.id} className={`flex items-start gap-3 py-2 ${index > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''}`}>
            <Monogram network={target.network} />
            <div className="min-w-0 flex-1 space-y-1">
              <StatusGlyph status={target.status} withWord />
              <p className={`text-xs ${DIM}`}>{formatDateTime(when)}</p>
              {target.status === 'published' ? (
                target.permalink ? (
                  <a
                    href={target.permalink}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1 text-xs text-primary-800 hover:underline dark:text-tuggi-blue"
                  >
                    {t('actions.open_in', { network: networkName(target.network) })}
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                ) : (
                  <p className="text-xs">{UNKNOWN_VALUE}</p>
                )
              ) : null}
              {target.status === 'failed' ? (
                <>
                  <p className="break-words text-xs text-red-700 dark:text-red-400">
                    {target.error ? t('status.failed_detail', { error: target.error }) : t('status.failed_no_error')}
                  </p>
                  <p className={`text-xs ${DIM}`}>{t('status.failed_hint')}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={t('actions.retry_aria', { network: networkName(target.network) })}
                    onClick={() => onRetry(target)}
                  >
                    {t('actions.retry')}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        )
      })}
    </section>
  )
}
