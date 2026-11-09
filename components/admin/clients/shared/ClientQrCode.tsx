'use client'

import type { ReactNode } from 'react'
import { QrCode, AlertTriangle, ExternalLink } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { useTranslations } from 'next-intl'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'
import { DEFAULT_PLACES_PORTAL_ORIGIN } from '@/lib/partnerships/acceptance-link'

interface ClientQrCodeProps {
  /** Client UUID, for the canvas DOM id. Without it the card is only the slug field it carries. */
  clientId?: string
  /** The partner's name in `tuggi.app/@{slug}`; without one there is no address and no QR. */
  slug?: string
  /**
   * The slug field, drawn at the top of this card (#911): changing the slug changes the QR, and the
   * two used to sit three cards apart. Only `ProfileTab` passes it.
   */
  children?: ReactNode
}

/** The partner page, the one address every partner has (BR-B2B-037 item 1). */
export const partnerPageUrl = (slug: string) => `https://www.tuggi.app/@${slug}`

/**
 * The partner's public link and QR, FOR LOOKUP ONLY (#1147).
 *
 * The partner downloads the QR and the kit in the Places portal, which is the one place that
 * issues them (operator decision of 2026-11-09). The CMS used to issue a second PNG of its own,
 * pointing at `/d/{slug}`; that is gone, and so are its download, copy and share buttons. What
 * stays is what the curator needs to check a printed piece against the record: the QR of
 * `tuggi.app/@{slug}` (BR-B2B-037 items 1 and 2) and the address in text. A `/d/{slug}` already
 * printed keeps resolving on the site; it is just no longer issued.
 *
 * Without a slug there is no `/@` address, so there is no QR either: the legacy `/download?ID=`
 * fallback is not issued any more.
 */
export function ClientQrCode({ clientId, slug, children }: ClientQrCodeProps) {
  const t = useTranslations('Clients.profile.qr')

  const trimmedSlug = (slug ?? '').trim()
  const finalUrl = trimmedSlug ? partnerPageUrl(trimmedSlug) : ''
  const hasRecord = Boolean(clientId)
  if (!hasRecord && !children) return null

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-5 lg:p-8 shadow-sm">
      <SectionHeader icon={<QrCode className="w-4 h-4 text-tuggi-blue" />} title={t('title')} />
      {children ? <div className={hasRecord ? 'mb-6' : undefined}>{children}</div> : null}
      {hasRecord ? (
        <>
          <p className="text-xs text-gray-500 mb-6 leading-relaxed">{t('subtitle')}</p>

          {!finalUrl ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <p>{t('noSlugWarning')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              <div className="flex flex-col items-center">
                {/* The frame gives back padding below `lg` so the card fits a 390px drawer; the
                    canvas keeps its 220px, because shrinking the modules is how a QR stops
                    scanning. */}
                <div className="p-3 lg:p-5 bg-white border-2 border-gray-50 rounded-3xl shadow-sm max-w-full overflow-hidden">
                  <QRCodeCanvas
                    id={`client-qr-${clientId}`}
                    // The canvas is an image: named by the address it encodes (#911, axe `role-img-alt`).
                    aria-label={finalUrl}
                    value={finalUrl}
                    size={220}
                    // Error correction H tolerates up to ~30% module damage, which the centered
                    // logo overlay needs to scan reliably.
                    level="H"
                    imageSettings={{ src: '/tuggi-icon.png', height: 44, width: 44, excavate: true }}
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
                </div>
                <a
                  href={DEFAULT_PLACES_PORTAL_ORIGIN}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-all"
                >
                  <ExternalLink className="w-4 h-4" /> {t('portalLink')}
                </a>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
