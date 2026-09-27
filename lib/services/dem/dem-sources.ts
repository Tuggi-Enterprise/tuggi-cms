/**
 * EP (#782) — the two relief layers the TP engine reads, and where they come from.
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

export type DemLayer = 'surface' | 'ground'
export const DEM_LAYERS: readonly DemLayer[] = ['surface', 'ground']

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

/**
 * The version of the relief sources, written next to the engine version in the
 * `generation_method` of every TP (#782; the column already exists, no migration).
 */
export const DEM_SOURCES_VERSION = `${COPERNICUS_GLO30.id}:${COPERNICUS_GLO30.version}+${GEDTM30.id}:${GEDTM30.version}`

/** `local_osm_osm` → `local_osm_osm|dem=copernicus-glo30:…+gedtm30:v1.2.0`. Idempotent. */
export function stampGenerationMethod(method: string): string {
  const stamp = `|dem=${DEM_SOURCES_VERSION}`
  return method.includes('|dem=') ? method : `${method}${stamp}`
}
