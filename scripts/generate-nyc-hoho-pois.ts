/**
 * Extract NYC hop-on hop-off tourist POIs from local OSM database.
 * Searches for ~100 key landmarks in Manhattan, Brooklyn, and Queens
 * that are typical stops on HOHO bus routes but may be missing from
 * the homolog table because they weren't captured during bulk OSM import.
 *
 * Output: data/nyc-hoho-pois.geojson (ready for import-geojson-homolog.ts)
 * Usage: npx tsx scripts/generate-nyc-hoho-pois.ts
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = path.join(process.cwd(), 'data', 'local_osm.db');
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'nyc-hoho-pois.geojson');

interface SearchTarget {
  name: string;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  nameVariants?: string[];
  tagFilter?: string; // partial match on tags_json
  exactName?: boolean; // require exact "name":"VALUE" match (default: true)
}

// All targets with bounding boxes verified against local OSM data.
// exactName defaults to true — every entry below uses exact name matching.
const TARGETS: SearchTarget[] = [
  // ── CENTRAL PARK ──
  { name: 'Central Park', latMin: 40.764, latMax: 40.800, lngMin: -73.982, lngMax: -73.948 },

  // ── TIMES SQUARE ──
  { name: 'Times Square', latMin: 40.754, latMax: 40.762, lngMin: -73.990, lngMax: -73.981,
    tagFilter: '"place"' },

  // ── EMPIRE STATE BUILDING ──
  { name: 'Empire State Building', latMin: 40.747, latMax: 40.750, lngMin: -73.988, lngMax: -73.983 },

  // ── HIGH LINE ──
  { name: 'High Line', latMin: 40.742, latMax: 40.755, lngMin: -74.010, lngMax: -74.002 },

  // ── UNITED NATIONS HEADQUARTERS ──
  { name: 'United Nations Headquarters', latMin: 40.747, latMax: 40.751, lngMin: -73.971, lngMax: -73.965 },

  // ── ROCKEFELLER CENTER (the complex, not the information board) ──
  { name: 'Rockefeller Center', latMin: 40.758, latMax: 40.762, lngMin: -73.981, lngMax: -73.976,
    nameVariants: ['Rockefeller center'] },

  // ── RADIO CITY MUSIC HALL ──
  { name: 'Radio City Music Hall', latMin: 40.759, latMax: 40.761, lngMin: -73.981, lngMax: -73.977 },

  // ── ST. PATRICK'S CATHEDRAL (OSM uses Unicode right single quotation mark U+2019) ──
  { name: 'Saint Patrick’s Cathedral', latMin: 40.757, latMax: 40.760, lngMin: -73.978, lngMax: -73.975 },

  // ── GRAND CENTRAL TERMINAL ──
  { name: 'Grand Central Terminal', latMin: 40.751, latMax: 40.754, lngMin: -73.979, lngMax: -73.975 },

  // ── CHRYSLER BUILDING ──
  { name: 'Chrysler Building', latMin: 40.750, latMax: 40.753, lngMin: -73.977, lngMax: -73.973 },

  // ── NEW YORK PUBLIC LIBRARY (main branch) ──
  { name: 'New York Public Library', latMin: 40.752, latMax: 40.754, lngMin: -73.984, lngMax: -73.980 },

  // ── BRYANT PARK ──
  { name: 'Bryant Park', latMin: 40.753, latMax: 40.755, lngMin: -73.985, lngMax: -73.982 },

  // ── FLATIRON BUILDING ──
  { name: 'Flatiron Building', latMin: 40.740, latMax: 40.742, lngMin: -73.991, lngMax: -73.988 },

  // ── MADISON SQUARE GARDEN ──
  { name: 'Madison Square Garden', latMin: 40.749, latMax: 40.752, lngMin: -73.996, lngMax: -73.991 },

  // ── MADISON SQUARE PARK ──
  { name: 'Madison Square Park', latMin: 40.741, latMax: 40.743, lngMin: -73.989, lngMax: -73.986 },

  // ── UNION SQUARE ──
  { name: 'Union Square', latMin: 40.734, latMax: 40.737, lngMin: -73.992, lngMax: -73.988 },

  // ── WASHINGTON SQUARE PARK ──
  { name: 'Washington Square Park', latMin: 40.729, latMax: 40.732, lngMin: -73.999, lngMax: -73.995 },

  // ── CHELSEA MARKET ──
  { name: 'Chelsea Market', latMin: 40.742, latMax: 40.744, lngMin: -74.008, lngMax: -74.005 },

  // ── THE VESSEL (Hudson Yards sculpture) ──
  { name: 'Vessel', latMin: 40.752, latMax: 40.755, lngMin: -74.004, lngMax: -74.001 },

  // ── THE SHED (Hudson Yards arts center) ──
  { name: 'The Shed', latMin: 40.752, latMax: 40.754, lngMin: -74.004, lngMax: -74.002,
    tagFilter: '"amenity"' },

  // ── INTREPID SEA AIR SPACE MUSEUM ──
  { name: 'Intrepid Museum', latMin: 40.763, latMax: 40.766, lngMin: -74.003, lngMax: -73.999,
    nameVariants: ['Intrepid Sea, Air & Space Museum'] },

  // ── 9/11 MEMORIAL & MUSEUM ──
  { name: '9/11 Memorial & Museum', latMin: 40.710, latMax: 40.712, lngMin: -74.015, lngMax: -74.012,
    nameVariants: ['National September 11 Memorial', 'September 11 Memorial'] },

  // ── ONE WORLD TRADE CENTER ──
  { name: 'One World Trade Center', latMin: 40.712, latMax: 40.714, lngMin: -74.015, lngMax: -74.012 },

  // ── CHARGING BULL ──
  { name: 'Charging Bull', latMin: 40.705, latMax: 40.708, lngMin: -74.014, lngMax: -74.011 },

  // ── TRINITY CHURCH ──
  { name: 'Trinity Church', latMin: 40.707, latMax: 40.709, lngMin: -74.014, lngMax: -74.011,
    tagFilter: '"place_of_worship"' },

  // ── NEW YORK STOCK EXCHANGE ──
  { name: 'New York Stock Exchange', latMin: 40.706, latMax: 40.708, lngMin: -74.013, lngMax: -74.010 },

  // ── SOUTH STREET SEAPORT ──
  { name: 'South Street Seaport', latMin: 40.705, latMax: 40.708, lngMin: -74.006, lngMax: -74.001 },

  // ── BATTERY PARK ──
  { name: 'Battery Park', latMin: 40.701, latMax: 40.705, lngMin: -74.020, lngMax: -74.014 },

  // ── CASTLE CLINTON ──
  { name: 'Castle Clinton', latMin: 40.702, latMax: 40.704, lngMin: -74.018, lngMax: -74.015 },

  // ── WOOLWORTH BUILDING ──
  { name: 'Woolworth Building', latMin: 40.712, latMax: 40.714, lngMin: -74.010, lngMax: -74.007 },

  // ── NEW YORK CITY HALL ──
  { name: 'New York City Hall', latMin: 40.712, latMax: 40.714, lngMin: -74.008, lngMax: -74.004 },

  // ── BROOKLYN BRIDGE ──
  { name: 'Brooklyn Bridge', latMin: 40.702, latMax: 40.710, lngMin: -74.002, lngMax: -73.990 },

  // ── WHITEHALL FERRY TERMINAL ──
  { name: 'Whitehall Terminal', latMin: 40.700, latMax: 40.703, lngMin: -74.016, lngMax: -74.012,
    nameVariants: ['Staten Island Ferry Whitehall Terminal', 'St. George Ferry Terminal'] },

  // ── COLUMBUS CIRCLE ──
  { name: 'Columbus Circle', latMin: 40.767, latMax: 40.769, lngMin: -73.983, lngMax: -73.980 },

  // ── LINCOLN CENTER ──
  { name: 'Lincoln Center for the Performing Arts', latMin: 40.770, latMax: 40.774, lngMin: -73.986, lngMax: -73.981,
    nameVariants: ['Lincoln Center'] },

  // ── AMERICAN MUSEUM OF NATURAL HISTORY ──
  { name: 'American Museum of Natural History', latMin: 40.780, latMax: 40.783, lngMin: -73.976, lngMax: -73.972 },

  // ── THE METROPOLITAN MUSEUM OF ART ──
  { name: 'The Metropolitan Museum of Art', latMin: 40.778, latMax: 40.780, lngMin: -73.965, lngMax: -73.961 },

  // ── GUGGENHEIM MUSEUM ──
  { name: 'Guggenheim Museum', latMin: 40.782, latMax: 40.784, lngMin: -73.961, lngMax: -73.958,
    nameVariants: ['Solomon R. Guggenheim Museum'] },

  // ── COOPER HEWITT SMITHSONIAN DESIGN MUSEUM ──
  { name: 'Cooper–Hewitt, Smithsonian Design Museum', latMin: 40.784, latMax: 40.787, lngMin: -73.959, lngMax: -73.956,
    nameVariants: ['Cooper Hewitt, Smithsonian Design Museum'] },

  // ── MUSEUM OF THE CITY OF NEW YORK ──
  { name: 'Museum of the City of New York', latMin: 40.791, latMax: 40.794, lngMin: -73.954, lngMax: -73.950 },

  // ── FRICK MADISON ──
  { name: 'Frick Madison', latMin: 40.768, latMax: 40.773, lngMin: -73.968, lngMax: -73.962,
    nameVariants: ['The Frick Collection'] },

  // ── WHITNEY MUSEUM OF AMERICAN ART ──
  { name: 'Whitney Museum of American Art', latMin: 40.739, latMax: 40.741, lngMin: -74.010, lngMax: -74.007 },

  // ── CARNEGIE HALL ──
  { name: 'Carnegie Hall', latMin: 40.764, latMax: 40.766, lngMin: -73.981, lngMax: -73.978 },

  // ── STRAWBERRY FIELDS ──
  { name: 'Strawberry Fields', latMin: 40.774, latMax: 40.776, lngMin: -73.977, lngMax: -73.973 },

  // ── APOLLO THEATER ──
  { name: 'Apollo Theater', latMin: 40.809, latMax: 40.811, lngMin: -73.952, lngMax: -73.949 },

  // ── CATHEDRAL OF SAINT JOHN THE DIVINE ──
  { name: 'Cathedral of Saint John the Divine', latMin: 40.802, latMax: 40.805, lngMin: -73.964, lngMax: -73.960 },

  // ── GENERAL GRANT NATIONAL MEMORIAL ──
  { name: 'General Grant National Memorial', latMin: 40.812, latMax: 40.815, lngMin: -73.965, lngMax: -73.961 },

  // ── RIVERSIDE CHURCH ──
  { name: 'Riverside Church', latMin: 40.808, latMax: 40.812, lngMin: -73.965, lngMax: -73.961 },

  // ── COLUMBIA UNIVERSITY ──
  { name: 'Columbia University', latMin: 40.803, latMax: 40.807, lngMin: -73.966, lngMax: -73.962,
    tagFilter: '"amenity":"university"' },

  // ── THE STUDIO MUSEUM IN HARLEM ──
  { name: 'The Studio Museum In Harlem', latMin: 40.808, latMax: 40.810, lngMin: -73.950, lngMax: -73.946 },

  // ── ABYSSINIAN BAPTIST CHURCH ──
  { name: 'Abyssinian Baptist Church', latMin: 40.814, latMax: 40.819, lngMin: -73.944, lngMax: -73.939 },

  // ── SOHO (neighborhood) ──
  { name: 'SoHo', latMin: 40.722, latMax: 40.727, lngMin: -74.002, lngMax: -73.997,
    tagFilter: '"place"' },

  // ── LITTLE ITALY ──
  { name: 'Little Italy', latMin: 40.718, latMax: 40.721, lngMin: -73.999, lngMax: -73.995,
    tagFilter: '"place"' },

  // ── CHINATOWN ──
  { name: 'Chinatown', latMin: 40.714, latMax: 40.719, lngMin: -74.006, lngMax: -73.997,
    tagFilter: '"place"' },

  // ── GREENWICH VILLAGE (neighborhood) ──
  { name: 'Greenwich Village', latMin: 40.729, latMax: 40.736, lngMin: -74.005, lngMax: -73.994,
    tagFilter: '"place"' },

  // ── MACY'S HERALD SQUARE ──
  { name: "Macy's", latMin: 40.750, latMax: 40.752, lngMin: -73.991, lngMax: -73.988,
    tagFilter: '"building"' },

  // ── WALDORF ASTORIA NEW YORK ──
  { name: 'Waldorf Astoria New York', latMin: 40.755, latMax: 40.758, lngMin: -73.975, lngMax: -73.971,
    nameVariants: ['Waldorf Astoria'] },

  // ── BROOKFIELD PLACE ──
  { name: 'Brookfield Place', latMin: 40.712, latMax: 40.715, lngMin: -74.017, lngMax: -74.014 },

  // ── CIRCLE LINE / PIER 83 ──
  { name: 'Circle Line Sightseeing Cruises', latMin: 40.762, latMax: 40.765, lngMin: -74.004, lngMax: -74.000,
    nameVariants: ['Circle Line Sightseeing', 'Pier 83'] },

  // ── WTC TRANSPORTATION HUB (OCULUS) ──
  { name: 'World Trade Center Transportation Hub', latMin: 40.711, latMax: 40.713, lngMin: -74.013, lngMax: -74.009,
    nameVariants: ['The Oculus', 'Oculus'] },

  // ─────────────────────────────────────────────────
  // BROOKLYN
  // ─────────────────────────────────────────────────

  // ── BROOKLYN BRIDGE PARK ──
  { name: 'Brooklyn Bridge Park', latMin: 40.691, latMax: 40.706, lngMin: -74.004, lngMax: -73.985 },

  // ── BROOKLYN HEIGHTS PROMENADE ──
  { name: 'Brooklyn Heights Promenade', latMin: 40.695, latMax: 40.700, lngMin: -74.001, lngMax: -73.993 },

  // ── DUMBO (neighborhood) ──
  { name: 'Dumbo', latMin: 40.701, latMax: 40.707, lngMin: -73.993, lngMax: -73.986,
    tagFilter: '"place"' },

  // ── JANE'S CAROUSEL ──
  { name: "Jane's Carousel", latMin: 40.701, latMax: 40.704, lngMin: -73.992, lngMax: -73.986 },

  // ── BARCLAYS CENTER ──
  { name: 'Barclays Center', latMin: 40.681, latMax: 40.684, lngMin: -73.977, lngMax: -73.973 },

  // ── BROOKLYN MUSEUM ──
  { name: 'Brooklyn Museum', latMin: 40.670, latMax: 40.673, lngMin: -73.966, lngMax: -73.962 },

  // ── BROOKLYN BOTANIC GARDEN ──
  { name: 'Brooklyn Botanic Garden', latMin: 40.662, latMax: 40.673, lngMin: -73.969, lngMax: -73.960 },

  // ── PROSPECT PARK ──
  { name: 'Prospect Park', latMin: 40.658, latMax: 40.678, lngMin: -73.976, lngMax: -73.960 },

  // ── GRAND ARMY PLAZA ──
  { name: 'Grand Army Plaza', latMin: 40.673, latMax: 40.676, lngMin: -73.972, lngMax: -73.968 },

  // ── NEW YORK TRANSIT MUSEUM ──
  { name: 'New York Transit Museum', latMin: 40.688, latMax: 40.692, lngMin: -73.993, lngMax: -73.987 },

  // ── WILLIAMSBURG (neighborhood) ──
  { name: 'Williamsburg', latMin: 40.712, latMax: 40.717, lngMin: -73.957, lngMax: -73.951,
    tagFilter: '"place"' },

  // ── CONEY ISLAND (neighborhood) ──
  { name: 'Coney Island', latMin: 40.574, latMax: 40.579, lngMin: -73.994, lngMax: -73.988,
    tagFilter: '"place"' },

  // ── LUNA PARK ──
  { name: 'Luna Park', latMin: 40.574, latMax: 40.577, lngMin: -73.982, lngMax: -73.978 },

  // ── NEW YORK AQUARIUM ──
  { name: 'New York Aquarium', latMin: 40.573, latMax: 40.577, lngMin: -73.978, lngMax: -73.973 },

  // ─────────────────────────────────────────────────
  // QUEENS
  // ─────────────────────────────────────────────────

  // ── FLUSHING MEADOWS CORONA PARK ──
  { name: 'Flushing Meadows Corona Park', latMin: 40.735, latMax: 40.748, lngMin: -73.855, lngMax: -73.835,
    nameVariants: ['Flushing Meadows–Corona Park'] },

  // ── UNISPHERE ──
  { name: 'Unisphere', latMin: 40.745, latMax: 40.748, lngMin: -73.847, lngMax: -73.843 },

  // ── QUEENS MUSEUM ──
  { name: 'Queens Museum', latMin: 40.744, latMax: 40.748, lngMin: -73.849, lngMax: -73.845 },

  // ── MOMA PS1 ──
  { name: 'MoMA PS1', latMin: 40.744, latMax: 40.747, lngMin: -73.949, lngMax: -73.946 },

  // ── SOCRATES SCULPTURE PARK ──
  { name: 'Socrates Sculpture Park', latMin: 40.767, latMax: 40.770, lngMin: -73.940, lngMax: -73.934 },

  // ── THE NOGUCHI MUSEUM ──
  { name: 'The Noguchi Museum', latMin: 40.766, latMax: 40.769, lngMin: -73.940, lngMax: -73.934 },

  // ── ASTORIA PARK ──
  { name: 'Astoria Park', latMin: 40.773, latMax: 40.784, lngMin: -73.930, lngMax: -73.918 },

  // ── JAMAICA BAY WILDLIFE REFUGE ──
  { name: 'Jamaica Bay Wildlife Refuge', latMin: 40.614, latMax: 40.634, lngMin: -73.838, lngMax: -73.818 },

  // ── ROCKAWAY BEACH ──
  { name: 'Rockaway Beach', latMin: 40.583, latMax: 40.591, lngMin: -73.825, lngMax: -73.782 },

  // ─────────────────────────────────────────────────
  // ADDITIONAL MANHATTAN LANDMARKS
  // ─────────────────────────────────────────────────

  // ── LOWER EAST SIDE TENEMENT MUSEUM ──
  { name: 'Lower East Side Tenement Museum', latMin: 40.717, latMax: 40.720, lngMin: -73.992, lngMax: -73.988 },

  // ── NEW MUSEUM ──
  { name: 'New Museum', latMin: 40.722, latMax: 40.724, lngMin: -73.993, lngMax: -73.990 },

  // ── MUSEUM OF JEWISH HERITAGE ──
  { name: 'Museum of Jewish Heritage', latMin: 40.704, latMax: 40.707, lngMin: -74.020, lngMax: -74.017 },

  // ── FRAUNCES TAVERN ──
  { name: 'Fraunces Tavern', latMin: 40.703, latMax: 40.705, lngMin: -74.012, lngMax: -74.008 },

  // ── AFRICAN BURIAL GROUND NATIONAL MONUMENT ──
  { name: 'African Burial Ground National Monument', latMin: 40.713, latMax: 40.716, lngMin: -74.006, lngMax: -74.002 },

  // ── FEDERAL HALL NATIONAL MEMORIAL ──
  { name: 'Federal Hall National Memorial', latMin: 40.707, latMax: 40.709, lngMin: -74.011, lngMax: -74.008 },

  // ── MUSEUM OF ARTS AND DESIGN ──
  { name: 'Museum of Arts and Design', latMin: 40.767, latMax: 40.769, lngMin: -73.983, lngMax: -73.980 },

  // ── NEUE GALERIE NEW YORK ──
  { name: 'Neue Galerie New York', latMin: 40.781, latMax: 40.783, lngMin: -73.962, lngMax: -73.959 },

  // ── ASIA SOCIETY ──
  { name: 'Asia Society', latMin: 40.768, latMax: 40.771, lngMin: -73.966, lngMax: -73.962 },

  // ── EL MUSEO DEL BARRIO ──
  { name: 'El Museo Del Barrio', latMin: 40.793, latMax: 40.796, lngMin: -73.953, lngMax: -73.950,
    nameVariants: ['El Museo del Barrio'] },

  // ── NATIONAL MUSEUM OF THE AMERICAN INDIAN ──
  { name: 'National Museum of the American Indian', latMin: 40.703, latMax: 40.706, lngMin: -74.016, lngMax: -74.012 },

  // ── IRISH HUNGER MEMORIAL ──
  { name: 'Irish Hunger Memorial', latMin: 40.714, latMax: 40.716, lngMin: -74.017, lngMax: -74.013 },

  // ── HIGH BRIDGE ──
  { name: 'High Bridge', latMin: 40.840, latMax: 40.844, lngMin: -73.933, lngMax: -73.925 },

  // ── INTREPID (Pier 86) — alias search ──
  { name: 'Pier 86', latMin: 40.762, latMax: 40.767, lngMin: -74.006, lngMax: -73.999,
    nameVariants: ['Intrepid Sea, Air & Space Museum', 'Intrepid Museum'] },

  // ── MEATPACKING DISTRICT ──
  { name: 'Meatpacking District', latMin: 40.739, latMax: 40.742, lngMin: -74.008, lngMax: -74.003,
    tagFilter: '"place"' },

  // ── EAST VILLAGE ──
  { name: 'East Village', latMin: 40.726, latMax: 40.730, lngMin: -73.990, lngMax: -73.977,
    tagFilter: '"place"' },

  // ── LOWER EAST SIDE ──
  { name: 'Lower East Side', latMin: 40.714, latMax: 40.721, lngMin: -73.994, lngMax: -73.980,
    tagFilter: '"place"' },

  // ── HARLEM (neighborhood) ──
  { name: 'Harlem', latMin: 40.806, latMax: 40.815, lngMin: -73.960, lngMax: -73.930,
    tagFilter: '"place"' },

  // ── BROOKLYN NAVY YARD ──
  { name: 'Brooklyn Navy Yard', latMin: 40.698, latMax: 40.703, lngMin: -73.982, lngMax: -73.969 },

  // ── BROOKLYN HISTORICAL SOCIETY (now Center for Brooklyn History) ──
  { name: 'Brooklyn Historical Society', latMin: 40.693, latMax: 40.697, lngMin: -73.994, lngMax: -73.990,
    nameVariants: ['Center for Brooklyn History'] },

  // ── PIER 17 (South Street Seaport) ──
  { name: 'Pier 17', latMin: 40.706, latMax: 40.708, lngMin: -74.004, lngMax: -74.000 },
];

function calcCentroid(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

interface OsmRow {
  id: string;
  osm_type: string;
  osm_id: string;
  geometry_json: string;
  tags_json: string;
}

function findPoi(db: Database.Database, target: SearchTarget): OsmRow | null {
  const pad = 0.001;
  const bboxClause = `
    min_lat >= ${target.latMin - pad}
    AND max_lat <= ${target.latMax + pad}
    AND min_lng >= ${target.lngMin - pad}
    AND max_lng <= ${target.lngMax + pad}
  `;

  const allNames = [target.name, ...(target.nameVariants ?? [])];

  for (const name of allNames) {
    const escaped = name.replace(/'/g, "''");
    let sql = `
      SELECT id, osm_type, osm_id, geometry_json, tags_json
      FROM pois
      WHERE tags_json LIKE '%"name":"${escaped}"%'
        AND ${bboxClause}
    `;
    if (target.tagFilter) sql += ` AND tags_json LIKE '%${target.tagFilter}%'`;
    sql += ' LIMIT 1';

    const row = db.prepare(sql).get() as OsmRow | undefined;
    if (row) return row;
  }

  return null;
}

function toGeoJsonFeature(row: OsmRow, targetName: string): object | null {
  let geometry: Array<{ lat: number; lng: number }>;
  try {
    geometry = JSON.parse(row.geometry_json);
  } catch {
    return null;
  }
  if (!geometry || geometry.length === 0) return null;

  const centroid = geometry.length === 1 ? geometry[0] : calcCentroid(geometry);
  const tags = JSON.parse(row.tags_json);

  // Strip undefined values
  const props: Record<string, any> = {};
  const set = (k: string, v: any) => { if (v !== undefined && v !== null) props[k] = v; };

  set('@id', tags['@id'] ?? row.osm_id);
  set('@type', tags['@type'] ?? row.osm_type);
  set('name', tags.name ?? targetName);
  set('addr:city', tags['addr:city'] ?? 'New York');
  set('addr:state', tags['addr:state'] ?? 'NY');
  props['addr:country'] = 'United States';
  set('addr:street', tags['addr:street']);
  set('addr:housenumber', tags['addr:housenumber']);
  set('addr:suburb', tags['addr:suburb'] ?? tags.neighbourhood);
  set('addr:postcode', tags['addr:postcode']);
  set('website', tags.website);
  set('phone', tags.phone);
  set('tourism', tags.tourism);
  set('historic', tags.historic);
  set('leisure', tags.leisure);
  set('natural', tags.natural);
  set('amenity', tags.amenity);
  set('building', tags.building);
  set('wikidata', tags.wikidata);
  set('wikipedia', tags.wikipedia);
  set('wheelchair', tags.wheelchair);
  set('opening_hours', tags.opening_hours);
  set('operator', tags.operator);
  set('start_date', tags.start_date);
  set('height', tags.height);

  return {
    type: 'Feature',
    properties: props,
    geometry: {
      type: 'Point',
      coordinates: [centroid.lng, centroid.lat],
    },
  };
}

async function main() {
  console.log(`Opening ${DB_PATH}...`);
  const db = new Database(DB_PATH, { readonly: true });

  const features: object[] = [];
  const found: string[] = [];
  const notFound: string[] = [];

  for (const target of TARGETS) {
    const row = findPoi(db, target);
    if (row) {
      const feature = toGeoJsonFeature(row, target.name);
      if (feature) {
        features.push(feature);
        const tags = JSON.parse(row.tags_json);
        found.push(`✓ ${target.name} → OSM ${tags['@type']}/${tags['@id']} "${tags.name}"`);
      }
    } else {
      notFound.push(`✗ ${target.name}`);
    }
  }

  db.close();

  const geojson = { type: 'FeatureCollection', features };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(geojson, null, 2));

  console.log('\n── FOUND ──');
  found.forEach(l => console.log(l));

  console.log('\n── NOT FOUND IN LOCAL OSM ──');
  notFound.forEach(l => console.log(l));

  console.log(`\nTotal: ${features.length} POIs written to ${OUTPUT_PATH}`);
  if (notFound.length > 0) {
    console.log(`${notFound.length} targets not found — check OSM name variants manually.`);
  }
}

main().catch(console.error);
