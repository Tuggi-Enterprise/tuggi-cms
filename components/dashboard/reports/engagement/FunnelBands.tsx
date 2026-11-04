'use client'

import { cn } from '@/lib/utils'
import { DIM } from '@/components/ui/dense-table'

/**
 * The sequential funnel chart (#1069, spec-cms-relatorio-conversao-2026-11 §7), the use funnel of the
 * Engagement and conversion page since #1101 (spec-cms-relatorio-engajamento-2026-11 §C5):
 * horizontal bands centred on ONE ruler, no connector between steps, the number beside each band.
 * The Excel / Power BI funnel shape, in CSS. Not `recharts`: its trapezoid draws each step's base
 * from the NEXT step, which says "account flows into used hours into purchased", and that is false
 * here, a guest buys without an account (BR-USUARIO-037 3.j).
 *
 * Presentational: every number and string arrives formatted, `max` is `readFunnel().max`. Each band
 * is `value / max` of the band column, never relative to the band above, so a later step may be
 * wider than the one above it, and that is the truth. A band with `parts` splits its own width
 * among them (account and guest of Entered), each `part.value / band.value`.
 *
 * Different from `admin/social/FunnelBars.tsx`, which is recharts and draws something else.
 */

export interface FunnelBand {
  key: string
  label: string
  /** `title` of the label, the same hint the tile carries. */
  hint: string
  /** `null` = no instrument this month: the band column stays empty at full height. */
  value: number | null
  display: string
  /** Under the number from `md:` up: the rate phrase, or the sub of the other instrument. */
  note?: string
  /** On the first line below `md:`: the bare rate, or the same sub. */
  noteShort?: string
  /** A colour fills the band; `outline` draws it hollow and dashed (the other instrument). */
  fill: string | 'outline'
  muted?: boolean
  /** A badge after the note, which then turns bold: the one highlight of a funnel. */
  badge?: string
  /** A tag after the label, with its hint: the other instrument (`GA4`). */
  tag?: { text: string; hint: string }
  /** The band split in parts that sum to `value`, a 2 px gap between them; a part of 0 draws nothing. */
  parts?: FunnelBandPart[]
}

export interface FunnelBandPart {
  key: string
  value: number
  fill: string
  title: string
}

export type FunnelBandsProps = { label: string } & (
  | {
      loading: true
      /** Skeleton rows above and below the seam; 1 and 3 by default, the use funnel. */
      heads?: number
      steps?: number
    }
  | {
      loading?: false
      max: number
      /** The other instrument, above the seam: one band, or several (#1099). */
      head: FunnelBand | FunnelBand[]
      /** The difference printed on the seam; absent when there is none to print (floor, unknown). */
      seam?: { text: string; hint: string }
      steps: FunnelBand[]
    }
)

/** The three steps below the seam of the use funnel; the skeleton keeps the same grid. */
const SKELETON_STEPS = 3

const LI = 'md:flex md:items-center md:gap-4'
const LABEL_COL = 'hidden md:block w-40 shrink-0 text-right'
const NUMBER_COL = 'hidden md:flex md:flex-col w-40 shrink-0 h-9 justify-center'
const BAND_COL = 'mt-1 md:mt-0 flex-1 min-w-0 flex justify-center h-7 md:h-9'
const PULSE = 'rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse'

function Band({ band, max }: { band: FunnelBand; max: number }) {
  const show = band.value !== null && band.value > 0 && max > 0
  const width = `${((band.value as number) / max) * 100}%`
  const parts = band.parts?.filter((p) => p.value > 0)
  return (
    <div className={BAND_COL} aria-hidden="true" data-testid={`funnel-band-col-${band.key}`}>
      {show && parts && parts.length > 0 ? (
        <div data-testid={`funnel-band-${band.key}`} className="h-full min-w-[4px] flex gap-[2px] rounded-md overflow-hidden" style={{ width }}>
          {parts.map((p) => (
            <div
              key={p.key}
              data-testid={`funnel-part-${p.key}`}
              title={p.title}
              className="h-full min-w-0"
              style={{ flex: `${p.value} 1 0%`, backgroundColor: p.fill }}
            />
          ))}
        </div>
      ) : (
        show && (
          <div
            data-testid={`funnel-band-${band.key}`}
            className={cn(
              'h-full rounded-md min-w-[4px] transition-[width] duration-300 motion-reduce:transition-none',
              band.fill === 'outline'
                ? 'border-2 border-dashed border-gray-500 dark:border-gray-400'
                : 'border border-transparent'
            )}
            style={{ width, backgroundColor: band.fill === 'outline' ? undefined : band.fill }}
          />
        )
      )}
    </div>
  )
}

function Row({ band, max }: { band: FunnelBand; max: number }) {
  const labelTone = band.muted ? DIM : 'text-gray-900 dark:text-white'
  const number = 'text-sm font-mono font-bold tabular-nums text-gray-900 dark:text-white'
  return (
    <li className={LI} data-testid={`funnel-step-${band.key}`}>
      <div className="flex h-5 items-baseline justify-between gap-3 md:hidden">
        <span className={cn('text-sm font-semibold truncate', labelTone)} title={band.hint}>
          {band.label}
          {band.tag && <FunnelBadge text={band.tag.text} hint={band.tag.hint} />}
        </span>
        <span className="flex shrink-0 items-baseline gap-3">
          {band.noteShort && (
            <span className={cn('text-[11px] tabular-nums', band.badge ? 'font-semibold text-gray-900 dark:text-white' : DIM)}>
              {band.noteShort}
              {band.badge && <FunnelBadge text={band.badge} />}
            </span>
          )}
          <span className={number}>{band.display}</span>
        </span>
      </div>
      <span className={cn(LABEL_COL, 'text-sm font-semibold', labelTone)} title={band.hint}>
        {band.label}
        {band.tag && <FunnelBadge text={band.tag.text} hint={band.tag.hint} />}
      </span>
      <Band band={band} max={max} />
      <div className={NUMBER_COL}>
        <span className={cn(number, 'leading-5')}>{band.display}</span>
        {band.note && (
          <span className={cn('text-[11px] leading-4 tabular-nums', band.badge ? 'font-semibold text-gray-900 dark:text-white' : DIM)}>
            {band.note}
            {band.badge && <FunnelBadge text={band.badge} />}
          </span>
        )}
      </div>
    </li>
  )
}

/** The classes of the GA4 badge: grey border, mono. The purchase funnel reuses it (`converts_more`). */
export function FunnelBadge({ text, hint }: { text: string; hint?: string }) {
  return (
    <span data-testid={hint ? 'funnel-tag' : 'funnel-badge'} title={hint} className={cn('ml-1.5 inline-block rounded border border-gray-400 px-1.5 align-middle font-mono text-[10px] font-normal uppercase tracking-wider', DIM)}>
      {text}
    </span>
  )
}

function Seam({ seam }: { seam?: { text: string; hint: string } }) {
  return (
    <li className={cn(LI, 'my-2 h-5')} data-testid="funnel-seam">
      <span className="hidden md:block w-40 shrink-0" />
      <div className="relative h-5 flex-1 min-w-0 flex items-center justify-center">
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-gray-200 dark:border-gray-800" />
        {seam && (
          <span className={cn('relative bg-white dark:bg-gray-900 px-2 text-[11px] leading-4', DIM)} title={seam.hint}>
            {seam.text}
          </span>
        )}
      </div>
      <span className="hidden md:block w-40 shrink-0" />
    </li>
  )
}

function SkeletonRow() {
  return (
    <li className={LI}>
      <div className="flex h-5 items-center justify-between md:hidden">
        <div className={cn(PULSE, 'h-4 w-24')} />
        <div className={cn(PULSE, 'h-4 w-16')} />
      </div>
      <div className={cn(LABEL_COL, 'md:flex md:justify-end')}>
        <div className={cn(PULSE, 'h-4 w-24')} />
      </div>
      <div className={BAND_COL}>
        <div className={cn(PULSE, 'h-full w-full')} />
      </div>
      <div className={NUMBER_COL}>
        <div className={cn(PULSE, 'h-4 w-16')} />
      </div>
    </li>
  )
}

export function FunnelBands(props: FunnelBandsProps) {
  const list = 'mx-auto w-full max-w-4xl flex flex-col gap-2'
  if (props.loading) {
    return (
      <ul aria-label={props.label} aria-busy="true" className={list}>
        {Array.from({ length: props.heads ?? 1 }, (_, i) => (
          <SkeletonRow key={`h${i}`} />
        ))}
        <Seam />
        {Array.from({ length: props.steps ?? SKELETON_STEPS }, (_, i) => (
          <SkeletonRow key={i} />
        ))}
      </ul>
    )
  }
  return (
    <ul aria-label={props.label} className={list} data-testid="funnel-bands">
      {(Array.isArray(props.head) ? props.head : [props.head]).map((h) => (
        <Row key={h.key} band={h} max={props.max} />
      ))}
      <Seam seam={props.seam} />
      {props.steps.map((s) => (
        <Row key={s.key} band={s} max={props.max} />
      ))}
    </ul>
  )
}

export default FunnelBands
