'use client'

import { useMemo, useState } from 'react'
import { QrCode, Download, Copy, Check, AlertTriangle } from 'lucide-react'
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
    <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
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
          <div className="p-5 bg-white border-2 border-gray-50 rounded-3xl shadow-sm">
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

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleDownload}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-black transition-all shadow-md"
            >
              <Download className="w-4 h-4" /> {t('downloadPng')}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border',
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
