/**
 * EP (#782, #783) — the physical layers the TP engine reads, and where they come from.
 *
 * Only sources with GLOBAL coverage and a licence that allows commercial use enter here
 * (INV-EPa; operator, 2026-09-27). No municipal LiDAR, ANADEM, Open Buildings or FABDEM.
 * Both layers are 1 arc-second (~30 m) and share the same lattice: pixel centres sit on
 * integer degrees + k/3600 (Copernicus is PixelIsPoint on the whole degree; GEDTM30 is
 * PixelIsArea with an origin 4.5 px off the degree, i.e. centres on the same lattice).
 * Both use EGM2008 heights, so `surface − ground` is a height above the ground.
 *
 * This file has no I/O: the download lives in `dem-prepare`, the read in `dem-store`.
 */

/**
 * `surface` and `ground` are Float32 on the 1″ lattice. `buildings` and `canopy` (#783) are the
 * measured obstacles, on the obstacle lattice (`obstacleGrid`, ½″): see `BUILDING_TIER` and
 * `META_CHM`. A city without one of the four does not generate (INV-EPb).
 */
export type DemLayer = 'surface' | 'ground' | 'buildings' | 'canopy'
export const DEM_LAYERS: readonly DemLayer[] = ['surface', 'ground', 'buildings', 'canopy']

/** Degrees between two pixel centres of the common lattice (1 arc-second). */
export const DEM_LATTICE_DEG = 1 / 3600

/**
 * Copernicus DEM GLO-30 Public — a Digital SURFACE Model: ground + buildings + trees. It is
 * the obstacle on the sight line (E8). Served by AWS Open Data as one COG per 1°×1° tile;
 * tiles over open ocean do not exist, and the dataset says to read them as 0 m. Tiles not
 * listed in `tileList.txt` are either ocean or not released to the public: `dem-prepare`
 * tells them apart with the ground layer (land under a missing tile is a hole, INV-EPa).
 * Docs: https://copernicus-dem-30m.s3.amazonaws.com/readme.html
 * Licence: https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model
 */
export const COPERNICUS_GLO30 = {
  id: 'copernicus-glo30',
  layer: 'surface' as DemLayer,
  /** Bucket and COG layout as published on AWS Open Data (objects dated 2022-05). */
  version: 'GLO-30-Public@aws-2022-05',
  baseUrl: 'https://copernicus-dem-30m.s3.amazonaws.com',
  tileListUrl: 'https://copernicus-dem-30m.s3.amazonaws.com/tileList.txt',
  /** Void value of the DGED product; ocean has no tile at all. */
  voidBelowM: -1000,
  /** Required attribution for products using GLO-30 (Copernicus DEM licence). */
  attribution:
    'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
} as const

/** The 1°×1° cell whose south-west corner is (southLat, westLng): S23/W044 covers −23…−22, −44…−43. */
export function copernicusTileName(southLat: number, westLng: number): string {
  const ns = southLat < 0 ? 'S' : 'N'
  const ew = westLng < 0 ? 'W' : 'E'
  const lat = String(Math.abs(southLat)).padStart(2, '0')
  const lng = String(Math.abs(westLng)).padStart(3, '0')
  return `Copernicus_DSM_COG_10_${ns}${lat}_00_${ew}${lng}_00_DEM`
}

/**
 * Columns of a GLO-30 tile. The width shrinks with latitude (DGED product handbook, "tile
 * width"): 1″ up to 50°, 1.5″ to 60°, 2″ to 70°, 3″ to 80°, 5″ to 85°, 10″ beyond; rows are 1″
 * everywhere. The band is the tile edge nearest the equator.
 */
export function copernicusTileWidth(southLat: number): number {
  const band = Math.min(Math.abs(southLat), Math.abs(southLat + 1))
  const stepArcsec = band < 50 ? 1 : band < 60 ? 1.5 : band < 70 ? 2 : band < 80 ? 3 : band < 85 ? 5 : 10
  return 3600 / stepArcsec
}

export function copernicusTileUrl(name: string): string {
  return `${COPERNICUS_GLO30.baseUrl}/${name}/${name}.tif`
}

/**
 * GEDTM30 v1.2.0 — a Digital TERRAIN Model (bare ground), global, 1 arc-second, fused from
 * Copernicus DEM, ALOS and ICESat-2/GEDI by OpenGeoHub. It is the base of the POI elevation,
 * of the TP and of the observer eye (E4). One global COG, read by window.
 * Zenodo: https://doi.org/10.5281/zenodo.18887460 (latest of 10.5281/zenodo.14900181).
 * Licence: CC BY 4.0 — cite the source below.
 */
export const GEDTM30 = {
  id: 'gedtm30',
  layer: 'ground' as DemLayer,
  version: 'v1.2.0',
  doi: '10.5281/zenodo.18887460',
  url: 'https://s3.opengeohub.org/global/dtm/v1.2/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v1.2.tif',
  /** GDAL no-data of the file (Float32 max). Anything this large is no-data. */
  noDataAboveM: 1e30,
  attribution:
    'GEDTM30 v1.2.0 — Ho, Y.-F., Hengl, T. et al., Global Ensemble Digital Terrain Model 30 m, OpenGeoHub (doi:10.5281/zenodo.18887460), CC BY 4.0',
} as const

// ── Measured obstacles (#783) ───────────────────────────────────────────────

/**
 * Obstacle lattice: the 1″ lattice split in `OBSTACLE_SUBDIV` per side (½″, ~15 m). Chosen so a
 * 10–20 m building gets its own cell and a city still fits in memory (Rio: 7153×4297 cells,
 * 61 MB of buildings + 31 MB of canopy); it nests in the relief lattice, corner on corner.
 */
export const OBSTACLE_SUBDIV = 2

/**
 * Buildings layer: one Uint16 per cell = `tier << 14 | height in decimetres` (max 1638.3 m).
 * The tier says where the height came from; in one cell the higher tier wins, and inside a
 * tier the taller building. `UNMEASURED` is a footprint with no height: the sight line reads
 * the surface there (surface − ground), never a number made up for it (#783).
 */
export const BUILDING_TIER = { NONE: 0, UNMEASURED: 1, GLOBFP: 2, OVERTURE: 3 } as const
export const BUILDING_DM_MAX = (1 << 14) - 1

/**
 * INV-EPa (#772): 3D-GloBFP is an estimate (XGBoost, RMSE up to 14.6 m) and its error is
 * regional. Where Overture measured the same building (the 3D-GloBFP centroid falls on an
 * Overture cell with height), the ratio Overture / 3D-GloBFP of the pairs of a tile of
 * `GLOBFP_CAL_TILE_CELLS`² obstacle cells (~1 km) rescales the 3D-GloBFP cells of that tile by
 * the median ratio — only with ≥ `GLOBFP_CAL_MIN_PAIRS` pairs of which ≥ `GLOBFP_CAL_OVER_SHARE`
 * say the estimate is taller (never up), and only for footprints no larger than the largest
 * paired one (no evidence beyond it). Measured 2026-09-28: Engenho de Dentro (Rio), 1,289 pairs,
 * 3D-GloBFP ~3× Overture (median 14.7 m against 4.7 m on houses of 2 storeys, 90 % of the pairs
 * above); Copacabana, 385 pairs, ~70 % above and the towers right — untouched.
 */
export const GLOBFP_CAL_TILE_CELLS = 64
export const GLOBFP_CAL_MIN_PAIRS = 30
export const GLOBFP_CAL_OVER_SHARE = 0.75

/**
 * Overture Maps buildings, theme `buildings`, type `building` (GeoParquet, zstd). The `height`
 * is measured where the contributing source has it (OSM `height`, Esri Community Maps, LiDAR
 * derived); `num_floors` × the floor ruler when only that is there. Pinned release: the STAC
 * item of each file gives its bbox, and the row-group bbox statistics skip the rest.
 * Release retired upstream → EP fails with the URL; bump `release` here.
 * Docs: https://docs.overturemaps.org/getting-data/ · Attribution: https://docs.overturemaps.org/attribution/
 * Licence: ODbL 1.0 (theme); each contributing dataset keeps its own attribution (below).
 */
export const OVERTURE_BUILDINGS = {
  id: 'overture-buildings',
  release: '2026-09-23.1',
  stacCollectionUrl: 'https://stac.overturemaps.org/2026-09-23.1/buildings/building/collection.json',
  licence: 'ODbL-1.0',
  attribution:
    'Overture Maps Foundation, buildings theme (ODbL 1.0): © OpenStreetMap contributors (ODbL); Microsoft Global ML Building Footprints (ODbL); Google Open Buildings (CC BY 4.0); Esri Community Maps contributors (CC BY 4.0)',
} as const

/**
 * 3D-GloBFP v2 — building footprints with an estimated height per building (2020), global, from
 * Earth observation (XGBoost). One zipped shapefile per grid cell of `world_grid.shp`, field
 * `Height` in metres, WGS84. The files are split across ten Figshare articles; the MD5 Figshare
 * publishes is checked on every download.
 * Zenodo: https://doi.org/10.5281/zenodo.15487037 (readme, world_grid, data_links).
 * Licence: CC BY 4.0 — cite the article below.
 */
export const GLOBFP_3D = {
  id: '3d-globfp',
  version: 'v2 (zenodo 15487037)',
  worldGridUrl: 'https://zenodo.org/records/15487037/files/world_grid.zip?download=1',
  figshareArticles: [28879733, 28881749, 28882700, 28889813, 28890593, 28891631, 28903454, 28903853, 28904453, 28906499],
  figshareFilesUrl: (article: number) => `https://api.figshare.com/v2/articles/${article}/files?page_size=1000`,
  heightField: 'Height',
  licence: 'CC-BY-4.0',
  attribution:
    '3D-GloBFP — Che, Y., Li, X., Liu, X. et al. (2024), 3D-GloBFP: the first global three-dimensional building footprint dataset, Earth Syst. Sci. Data 16, 5357–5374, doi:10.5194/essd-16-5357-2024, CC BY 4.0',
} as const

/**
 * Meta / WRI High Resolution Canopy Height Maps v1 (`alsgedi_global_v6_float`): canopy height in
 * metres (Uint8), ~1.19 m pixels in EPSG:3857, one GeoTIFF per zoom-9 quadkey tile; the tile
 * index is `tiles.geojson`. The files are strip-organised (not tiled), so they are downloaded
 * whole and aggregated once per city to the obstacle lattice by the 90th percentile of the
 * pixels of each cell (`CANOPY_PERCENTILE`): a crown that covers a tenth of the cell stands in it.
 * Registry: https://registry.opendata.aws/dataforgood-fb-forests/ (AWS Open Data, no account).
 * Licence: CC BY 4.0 — cite Tolan et al. 2024.
 */
export const META_CHM = {
  id: 'meta-wri-chm',
  version: 'v1/alsgedi_global_v6_float',
  baseUrl: 'https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float',
  tilesIndexUrl: 'https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/tiles.geojson',
  tileUrl: (quadkey: string) => `https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/${quadkey}.tif`,
  licence: 'CC-BY-4.0',
  attribution:
    'High Resolution Canopy Height Maps by WRI and Meta — Tolan, J. et al. (2024), Very high resolution canopy height maps from RGB imagery using self-supervised vision transformer and convolutional decoder trained on aerial lidar, Remote Sensing of Environment 300, 113888, CC BY 4.0',
} as const

export const CANOPY_PERCENTILE = 0.9

/**
 * The version of the sources, written next to the engine version in the `generation_method`
 * of every TP (#782; the column already exists, no migration).
 */
export const DEM_SOURCES_VERSION = [
  `${COPERNICUS_GLO30.id}:${COPERNICUS_GLO30.version}`,
  `${GEDTM30.id}:${GEDTM30.version}`,
  `${OVERTURE_BUILDINGS.id}:${OVERTURE_BUILDINGS.release}`,
  `${GLOBFP_3D.id}:v2`,
  `${META_CHM.id}:v1`,
].join('+')

/** `local_osm_osm` → `local_osm_osm|dem=copernicus-glo30:…+gedtm30:v1.2.0`. Idempotent. */
export function stampGenerationMethod(method: string): string {
  const stamp = `|dem=${DEM_SOURCES_VERSION}`
  return method.includes('|dem=') ? method : `${method}${stamp}`
}
