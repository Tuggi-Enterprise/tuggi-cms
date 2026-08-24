'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { QrCode, Download, Copy, Check, AlertTriangle, Share2 } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'

interface ClientQrCodeProps {
  /** Client UUID — used for the canvas DOM id and the legacy /download?ID= fallback. */
  clientId?: string
  /** Preferred URL component — when present we route to /d/{slug}. */
  slug?: string
}

/**
 * Revenue QR Code card — generates the partner-attribution URL and
 * exposes a download/copy affordance. Used inside the ProfileTab next
 * to the slug field; reads slug + id straight from the parent client
 * state so it picks up edits before save (preview-quality), and always
 * keeps a slug-less fallback so even a freshly created client without
 * a slug yet still has a working QR.
 */
/** The capability never changes within a session, so there is nothing to subscribe to. */
const subscribeNever = () => () => {}

/**
 * `canShare` IS PROBED WITH AN ACTUAL FILE and not merely by the presence of `navigator.share`.
 * Desktop Safari and several Android browsers expose `share` for text and URLs while refusing
 * files, and a share button that throws `NotAllowedError` on tap is worse than no button.
 *
 * The answer is memoised because `getSnapshot` runs on every render and must return a stable
 * value — and because building a probe `File` per render to learn something that cannot change
 * is waste. The probe is one byte and is never sent anywhere.
 */
let shareFileSupport: boolean | null = null

function detectShareFile(): boolean {
  if (shareFileSupport !== null) return shareFileSupport
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') {
    shareFileSupport = false
    return shareFileSupport
  }
  try {
    const probe = new File([new Uint8Array([0])], 'probe.png', { type: 'image/png' })
    shareFileSupport = navigator.canShare({ files: [probe] })
  } catch {
    shareFileSupport = false
  }
  return shareFileSupport
}

export function ClientQrCode({ clientId, slug }: ClientQrCodeProps) {
  const t = useTranslations('Clients.profile.qr')
  const [copied, setCopied] = useState(false)

  const trimmedSlug = (slug ?? '').trim()
  const hasSlug = trimmedSlug.length > 0

  const finalUrl = useMemo(() => {
    if (hasSlug) return `https://www.tuggi.app/d/${trimmedSlug}`
    if (clientId) return `https://www.tuggi.app/download?ID=${clientId}`
    return ''
  }, [hasSlug, trimmedSlug, clientId])

  const canvasId = clientId ? `client-qr-${clientId}` : 'client-qr-preview'

  const handleDownload = () => {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')
    const link = document.createElement('a')
    const filename = trimmedSlug || clientId || 'client'
    link.download = `tuggi-qr-${filename}.png`
    link.href = dataUrl
    link.click()
  }

  /**
   * WHETHER THIS DEVICE HAS A SHARE SHEET THAT ACCEPTS A FILE.
   *
   * `useSyncExternalStore` and not an effect, because this is not state that changes — it is a
   * fact about the browser that differs between the server (where `navigator` does not exist)
   * and the client. The server snapshot is `false`, so the HTML never contains a button the
   * device cannot honour, and React reconciles the difference on hydration instead of the
   * component setting its own state one render late.
   */
  const canShareFile = useSyncExternalStore(subscribeNever, detectShareFile, () => false)

  /** The canvas as a PNG file, named the way the download names it. One shape, two consumers. */
  const toPngFile = (): Promise<File | null> =>
    new Promise((resolve) => {
      const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null
      if (!canvas) return resolve(null)
      canvas.toBlob((blob) => {
        if (!blob) return resolve(null)
        resolve(new File([blob], `tuggi-qr-${trimmedSlug || clientId || 'client'}.png`, { type: 'image/png' }))
      }, 'image/png')
    })

  /**
   * THE PHONE'S WAY OUT OF THIS SCREEN, and the reason it is not just another download.
   *
   * The QR is printed and stuck on a partner's counter, and the operator doing that is standing
   * in front of them with a phone. `Baixar PNG` on iOS drops the file into Downloads and ends
   * the story there; the share sheet is where `Imprimir`, `Salvar em Arquivos` and `WhatsApp`
   * all live, which is every real destination this image has.
   *
   * `AbortError` IS NOT AN ERROR. Dismissing the sheet rejects the promise with it, and every
   * user who changes their mind would otherwise see a failure they did not cause.
   */
  const handleShare = async () => {
    const file = await toPngFile()
    if (!file) return
    try {
      await navigator.share({ files: [file], title: t('title'), text: finalUrl })
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      console.error('Failed to share QR', err)
    }
  }

  const handleCopy = () => {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null
    if (!canvas) return
    canvas.toBlob(async (blob) => {
      if (!blob) return
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (err) {
        console.error('Failed to copy QR to clipboard', err)
      }
    }, 'image/png')
  }

  // Without an id AND without a slug we can't build any URL — bail out.
  if (!finalUrl) return null

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-5 lg:p-8 shadow-sm">
      <SectionHeader icon={<QrCode className="w-4 h-4 text-tuggi-blue" />} title={t('title')} />
      <p className="text-xs text-gray-500 mb-6 leading-relaxed">{t('subtitle')}</p>

      {!hasSlug && (
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <p>{t('noSlugWarning', { id: clientId ?? '' })}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
        <div className="flex flex-col items-center">
          {/* `p-5` on the frame plus a 220px canvas plus the card's own padding came to more
              than a 390px screen has once the drawer's padding is counted. The frame gives back
              the difference below `lg`; the canvas keeps its 220px, because shrinking the
              rendered modules is how a QR stops scanning. */}
          <div className="p-3 lg:p-5 bg-white border-2 border-gray-50 rounded-3xl shadow-sm max-w-full overflow-hidden">
            <QRCodeCanvas
              id={canvasId}
              value={finalUrl}
              size={220}
              // Error correction H tolerates up to ~30% module damage —
              // required for the centered logo overlay to scan reliably.
              level="H"
              imageSettings={{
                src: '/tuggi-icon.png',
                height: 44,
                width: 44,
                // Carve the QR modules out behind the logo so it doesn't
                // sit on top of dark squares.
                excavate: true,
              }}
            />
          </div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-5 text-center">
            {t('scanLabel')}
          </p>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{t('targetUrl')}</div>
            <code className="text-xs font-mono text-tuggi-blue font-semibold break-all leading-relaxed">{finalUrl}</code>
            {hasSlug && clientId && (
              <p className="text-[10px] text-gray-400 mt-2 font-mono break-all">
                {t('legacyLink', { id: clientId })}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            {/* The share sheet leads the row where it exists, because on the device that has one
                it is the shorter path to the printer. Where it does not, the download is still
                first — the order changes, the set of paths does not. */}
            {canShareFile && (
              <button
                type="button"
                onClick={handleShare}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-black transition-all shadow-md"
              >
                <Share2 className="w-4 h-4" /> {t('share')}
              </button>
            )}
            <button
              type="button"
              onClick={handleDownload}
              className={cn(
                'flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all',
                canShareFile
                  ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  : 'bg-gray-900 text-white hover:bg-black shadow-md'
              )}
            >
              <Download className="w-4 h-4" /> {t('downloadPng')}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                'min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border',
                copied ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              )}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? t('copied') : t('copyImage')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
