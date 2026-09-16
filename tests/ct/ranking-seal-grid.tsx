/**
 * A HARNESS FOR MEASURING THE SEAL IN A REAL BROWSER — #741, spec §9 item 7.
 *
 * Playwright CT refuses to mount JSX declared inside a `.spec` file (see `ranking-helpers.tsx`
 * for the same constraint), so the nine combinations × four sizes of `docs/design/spec-selo-de-
 * posicao-2026-09.md` §4.1 live in their own exported component. Each cell carries a stable
 * `data-testid` the spec locates directly, instead of walking DOM order — order is not part of
 * the claim being measured.
 *
 * `CONTROL_TEXT_TESTID` (`ranking-seal-grid-constants.ts`) is the canary: a plain `text-sm`
 * paragraph, the same Tailwind rem-based utility `dense-table.tsx`'s `CELL` uses. If a test sets
 * the root font-size to 1.4× and this paragraph's computed size does not grow, the manipulation
 * did nothing and every "unchanged" assertion next to it would be a false green.
 *
 * THIS MODULE EXPORTS ONLY THE COMPONENT ON PURPOSE. Playwright's CT Vite plugin only rewires a
 * module used in `mount(<X />)` into an import reference when it can statically tell `X` is the
 * thing to lazy-load; a module that also exports plain constants next to the component (the
 * first cut of this file did) makes that resolution ambiguous, and `mount()` fails at runtime
 * with "Component ... cannot be mounted" — the constants moved to `ranking-seal-grid-
 * constants.ts` instead.
 */
import { RankSeal } from '@/components/ui/RankSeal'
import {
  CONTROL_TEXT_TESTID,
  SEAL_GRID_CYCLES,
  SEAL_GRID_POSITIONS,
  SEAL_GRID_SIZES,
  sealTestId,
} from './ranking-seal-grid-constants'

export function RankSealGrid() {
  return (
    <div>
      <p className="text-sm" data-testid={CONTROL_TEXT_TESTID}>
        control
      </p>
      {SEAL_GRID_POSITIONS.map((position) =>
        SEAL_GRID_CYCLES.map((cycle) =>
          SEAL_GRID_SIZES.map((size) => (
            <div
              key={sealTestId(position, cycle, size)}
              data-testid={sealTestId(position, cycle, size)}
            >
              <RankSeal
                position={position}
                cycle={cycle}
                size={size}
                label={`${position}/${cycle}/${size}`}
              />
            </div>
          ))
        )
      )}
    </div>
  )
}
