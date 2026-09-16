/**
 * The nine combinations × four sizes and the stable `data-testid` they render under —
 * separated from `ranking-seal-grid.tsx` because a CT component module can hold only the
 * mounted component (Playwright's Vite plugin only rewires a module whose sole export is the
 * thing being mounted; see the spec file for the failure this split fixes).
 */
import type { SealCycle, SealPosition } from '@/components/ui/RankSeal'

export const SEAL_GRID_POSITIONS: SealPosition[] = [1, 2, 3]
export const SEAL_GRID_CYCLES: SealCycle[] = ['week', 'month', 'year']
/** The scale of spec §4.1 — 20 is the CMS floor, the other three are the app's. */
export const SEAL_GRID_SIZES = [20, 32, 48, 64]

export function sealTestId(position: SealPosition, cycle: SealCycle, size: number): string {
  return `seal-${position}-${cycle}-${size}`
}

export const CONTROL_TEXT_TESTID = 'seal-grid-control-text'
