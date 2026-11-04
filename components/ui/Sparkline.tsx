import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { lineDomain } from '@/lib/social/funnel'

/**
 * A line of a few points in plain SVG (#1099, spec-cms-relatorio-engajamento-2026-11 §B4.3). No
 * `recharts`: four of these in a tile row do not pay 314 KB.
 *
 * The slots are fixed and right aligned, so the line does not change shape as history grows. A
 * `null` opens a gap (two paths, the neighbours are not joined); a measured zero draws at zero. The
 * y domain is `lineDomain`, not from zero: the question is the shape, the number is printed above.
 * Decorative: the paths are `aria-hidden` and the `<title>` carries the numbers.
 *
 * The path is drawn in a stretched `viewBox` with a stroke that does not scale; the accent disc sits
 * on the outer, unstretched SVG at the same percentage, so it stays round at any width.
 */

export interface SparklineProps {
  points: (number | null)[]
  /** The point drawn as a disc; usually the last one. */
  accentIndex?: number
  title: string
  className?: string
  testId?: string
}

/** Viewbox height; the box is `h-8` (32 px), so one unit is one pixel vertically. */
const H = 32
const PAD_Y = 5
const PAD_X = 4

/** Horizontal position of slot `i` of `n`, in percent of the width. */
export const slotX = (i: number, n: number) => (n <= 1 ? 50 : PAD_X + (i * (100 - 2 * PAD_X)) / (n - 1))

export function Sparkline({ points, accentIndex, title, className, testId }: SparklineProps) {
  const [lo, hi] = lineDomain(points)
  const y = (v: number) => H - PAD_Y - ((v - lo) / (hi - lo || 1)) * (H - 2 * PAD_Y)
  const n = points.length

  // Runs of consecutive values, one path each.
  const runs: { i: number; v: number }[][] = []
  let run: { i: number; v: number }[] = []
  points.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run)
      run = []
    } else run.push({ i, v })
  })
  if (run.length) runs.push(run)

  const accent = accentIndex !== undefined ? points[accentIndex] : null

  return (
    <svg role="img" className={className} width="100%" height="100%" data-testid={testId}>
      <title>{title}</title>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" overflow="visible">
        {runs.map((r) => (
          <path
            key={r[0].i}
            data-testid="sparkline-path"
            data-points={r.length}
            data-start={r[0].i}
            d={r.map((p, k) => `${k ? 'L' : 'M'}${slotX(p.i, n)} ${y(p.v)}`).join(' ') + (r.length === 1 ? ' h0.01' : '')}
            fill="none"
            className="stroke-gray-400"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {accent !== null && accent !== undefined && accentIndex !== undefined && (
        <circle
          data-testid="sparkline-accent"
          aria-hidden="true"
          cx={`${slotX(accentIndex, n)}%`}
          cy={y(accent)}
          r={4}
          fill={CHART_COLORS.blue}
          strokeWidth={2}
          className="stroke-white dark:stroke-gray-900"
        />
      )}
    </svg>
  )
}

export default Sparkline
