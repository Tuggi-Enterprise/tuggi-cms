'use client'

/**
 * A rough preview of the campaign as the app draws it (#1192; spec
 * `docs/design/spec-campanhas-no-app-2026-11.md`): the square image beside the text for the map
 * carousel and the Explore card, the 16:9 image above the text for the launch sheet. Width of a
 * 390 dp phone scaled down; it shows proportion and wrapping, not pixels.
 */

import type { CampaignFormat, CampaignText } from '@/lib/campaigns/app-campaigns'

interface AppCampaignPreviewProps {
  format: CampaignFormat
  text: CampaignText
  imageUrl: string | null
}

export function AppCampaignPreview({ format, text, imageUrl }: AppCampaignPreviewProps) {
  const image = imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt="" className="h-full w-full object-cover" />
  ) : (
    <div className="h-full w-full bg-gray-200" />
  )

  if (format === 'launch_modal') {
    return (
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="aspect-video overflow-hidden rounded-xl">{image}</div>
        <p className="mt-3 text-base font-bold leading-snug text-gray-900">{text.title}</p>
        {text.body && <p className="mt-1 text-sm leading-snug text-gray-600">{text.body}</p>}
        <div className="mt-3 rounded-xl bg-tuggi-blue px-3 py-2 text-center text-sm font-semibold text-white">{text.cta_label}</div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      {imageUrl && <div className="aspect-square w-16 shrink-0 overflow-hidden rounded-xl">{image}</div>}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug text-gray-900">{text.title}</p>
        {text.body && <p className="mt-1 text-xs leading-snug text-gray-600">{text.body}</p>}
        <div className="mt-2 flex justify-end">
          <span className="rounded-lg bg-tuggi-blue px-3 py-1.5 text-xs font-semibold text-white">{text.cta_label}</span>
        </div>
      </div>
    </div>
  )
}
