'use client'

/**
 * A rough preview of the campaign as the app draws it (#1192; spec
 * `docs/design/spec-campanhas-no-app-2026-11.md`): the square image beside the text for the map
 * carousel and the Explore card, the 16:9 image above the text for the launch sheet. Width of a
 * 390 dp phone scaled down; it shows proportion, wrapping and the theme's colors, not pixels.
 */

import type { CampaignFormat, CampaignText, CampaignTheme } from '@/lib/campaigns/app-campaigns'

interface ThemePreview {
  /** The map card and the whole opening sheet. */
  background: string
  /** The Explorar card's frame; the map card has no border, only its shadow. */
  exploreBackground: string
  exploreBorder: string
  title: string
  body: string
}

/**
 * #1193, copied from spec §7.1 (the app reads the same rows from `colors` in
 * `tuggi-drive-v2/src/modules/campaigns/campaignThemes.ts`, `campaignPalette`; a value that
 * changes there changes here in the same card). Only what the preview draws: background, title,
 * body and the Explorar border. The button is not a theme row: always brand blue with white ink
 * (DS-COR-002), the `bg-tuggi-blue` below.
 */
const THEME_PREVIEW: Record<CampaignTheme, ThemePreview> = {
  default: {
    background: '#F5F5F5', // colors.surface
    exploreBackground: '#FFFFFF', // colors.background
    exploreBorder: 'rgba(0, 0, 0, 0.12)', // colors.outline
    title: '#333333', // colors.text
    body: '#6B6B6B', // colors.onSurfaceVariant
  },
  black_friday: {
    background: '#0B1220', // colors.tuggiDark
    exploreBackground: '#0B1220',
    exploreBorder: '#0B1220',
    title: '#FFFFFF', // colors.onPrimary
    body: '#C5CBD3', // colors.onTuggiDarkVariant
  },
  // Option A of spec §7.4: the light blue wash, so the brand blue button still shows.
  tuggi_blue: {
    background: '#E6F6FD', // colors.tuggiBlueWash
    exploreBackground: '#E6F6FD',
    exploreBorder: 'rgba(0, 168, 232, 0.2)', // colors.borderPrimary
    title: '#333333',
    body: '#6B6B6B',
  },
}

interface AppCampaignPreviewProps {
  format: CampaignFormat
  theme: CampaignTheme
  text: CampaignText
  imageUrl: string | null
}

export function AppCampaignPreview({ format, theme, text, imageUrl }: AppCampaignPreviewProps) {
  const palette = THEME_PREVIEW[theme] ?? THEME_PREVIEW.default
  const image = imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt="" className="h-full w-full object-cover" />
  ) : (
    <div className="h-full w-full bg-gray-200" />
  )

  if (format === 'launch_modal') {
    return (
      <div data-testid="campaign-preview" className="overflow-hidden rounded-2xl p-3 shadow-sm" style={{ backgroundColor: palette.background }}>
        <div className="aspect-video overflow-hidden rounded-xl">{image}</div>
        <p className="mt-3 text-base font-bold leading-snug" style={{ color: palette.title }}>
          {text.title}
        </p>
        {text.body && (
          <p className="mt-1 text-sm leading-snug" style={{ color: palette.body }}>
            {text.body}
          </p>
        )}
        <div className="mt-3 rounded-xl bg-tuggi-blue px-3 py-2 text-center text-sm font-semibold text-white">{text.cta_label}</div>
      </div>
    )
  }

  const explore = format === 'explore_card'
  return (
    <div
      data-testid="campaign-preview"
      className="flex gap-3 overflow-hidden rounded-2xl p-3 shadow-sm"
      style={{
        backgroundColor: explore ? palette.exploreBackground : palette.background,
        border: explore ? `1px solid ${palette.exploreBorder}` : undefined,
      }}>
      {imageUrl && <div className="aspect-square w-16 shrink-0 overflow-hidden rounded-xl">{image}</div>}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug" style={{ color: palette.title }}>
          {text.title}
        </p>
        {text.body && (
          <p className="mt-1 text-xs leading-snug" style={{ color: palette.body }}>
            {text.body}
          </p>
        )}
        <div className="mt-2 flex justify-end">
          <span className="rounded-lg bg-tuggi-blue px-3 py-1.5 text-xs font-semibold text-white">{text.cta_label}</span>
        </div>
      </div>
    </div>
  )
}
