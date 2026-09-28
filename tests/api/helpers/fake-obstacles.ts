import type { BuildingReader, BuildingSink, CanopyReader, Ring } from '../../../lib/services/dem/obstacle-prepare'
import type { DemGrid } from '../../../lib/services/dem/dem-store'
import { BUILDING_TIER, GLOBFP_3D, META_CHM, OVERTURE_BUILDINGS } from '../../../lib/services/dem/dem-sources'

/** A building source with no network: emits the given footprints, or fails. */
export function fakeBuildings(
  source: 'overture' | '3d-globfp',
  footprints: Array<{ ring: Ring; heightM: number | null }> = [],
  failures: string[] = []
): BuildingReader {
  const info = source === 'overture' ? OVERTURE_BUILDINGS : GLOBFP_3D
  const tier = source === 'overture' ? BUILDING_TIER.OVERTURE : BUILDING_TIER.GLOBFP
  return {
    source: info.id,
    version: 'test',
    attribution: info.attribution,
    async read(_area, sink: BuildingSink) {
      for (const f of footprints) sink(f.ring, f.heightM ? tier : BUILDING_TIER.UNMEASURED, f.heightM)
      return { tiles: [{ name: `${source}-file`, url: 'fake://', status: 'downloaded' }], failures }
    },
  }
}

/** A canopy source with no network: height per cell from a function; `covered` false leaves a hole. */
export function fakeCanopy(value: (r: number, c: number, g: DemGrid) => number = () => 0, covered: (r: number, c: number) => boolean = () => true): CanopyReader {
  return {
    source: META_CHM.id,
    version: 'test',
    attribution: META_CHM.attribution,
    async read(grid) {
      const values = new Uint8Array(grid.width * grid.height)
      const cov = new Uint8Array(grid.width * grid.height)
      for (let r = 0; r < grid.height; r++) for (let c = 0; c < grid.width; c++) {
        values[r * grid.width + c] = value(r, c, grid)
        cov[r * grid.width + c] = covered(r, c) ? 1 : 0
      }
      return { values, covered: cov, tiles: [{ name: 'chm-tile', url: 'fake://', status: 'downloaded' }], failures: [] }
    },
  }
}

export function fakeObstacles(buildings: BuildingReader[] = [fakeBuildings('overture'), fakeBuildings('3d-globfp')], canopy: CanopyReader = fakeCanopy()) {
  return { buildings, canopy }
}
