/**
 * Import GeoJSON to Homolog Schema
 * 
 * Usage:
 *   npx tsx scripts/import-geojson-homolog.ts output/file-elite-XXXX.geojson "Country Name"
 */

import 'dotenv/config';
import { getSupabase } from '../lib/core/supabase-client';
import { normalizeLocation } from '../lib/shared/location-normalize';
import fs from 'node:fs';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import path from 'node:path';

const supabase = getSupabase('service');

const UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function generateUUID(osmId: any, osmType: string, name: string, lat: number, lon: number): string {
  // Matches EXACTLY the logic in supabase/functions/capture-pois/index.ts
  const dataString = `osm:${osmId}:${osmType}:${name || ''}:${lat}:${lon}`;
  
  const nsBytes = Buffer.from(UUID_NAMESPACE.replace(/-/g, ''), 'hex');
  const nameBytes = Buffer.from(dataString, 'utf8');
  const hash = createHash('sha1').update(nsBytes).update(nameBytes).digest();
  
  // Set version (5) and variant (RFC 4122)
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  
  const hex = hash.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}

function getPointFromGeometry(geometry: any): { lat: number; lon: number } | null {
  if (!geometry || !geometry.coordinates) return null;

  if (geometry.type === 'Point') {
    return { lon: geometry.coordinates[0], lat: geometry.coordinates[1] };
  }
  
  // For LineStrings, Polygons, etc., take the first point as a reference
  try {
    let coords = geometry.coordinates;
    while (Array.isArray(coords[0]) && typeof coords[0][0] !== 'number') {
      coords = coords[0];
    }
    if (Array.isArray(coords[0]) && typeof coords[0][0] === 'number') {
      return { lon: coords[0][0], lat: coords[0][1] };
    }
  } catch (e) {
    return null;
  }
  return null;
}

function geoJsonToWkt(geometry: any): string | null {
  if (!geometry) return null;
  
  try {
    if (geometry.type === 'Point') {
      return `POINT(${geometry.coordinates[0]} ${geometry.coordinates[1]})`;
    }
    if (geometry.type === 'LineString') {
      const coords = geometry.coordinates.map((c: any) => `${c[0]} ${c[1]}`).join(',');
      return `LINESTRING(${coords})`;
    }
    if (geometry.type === 'Polygon') {
      const rings = geometry.coordinates.map((ring: any) => 
        '(' + ring.map((c: any) => `${c[0]} ${c[1]}`).join(',') + ')'
      ).join(',');
      return `POLYGON(${rings})`;
    }
    if (geometry.type === 'MultiPoint') {
      const coords = geometry.coordinates.map((c: any) => `${c[0]} ${c[1]}`).join(',');
      return `MULTIPOINT(${coords})`;
    }
    if (geometry.type === 'MultiLineString') {
      const lines = geometry.coordinates.map((line: any) => 
        '(' + line.map((c: any) => `${c[0]} ${c[1]}`).join(',') + ')'
      ).join(',');
      return `MULTILINESTRING(${lines})`;
    }
    if (geometry.type === 'MultiPolygon') {
      const polys = geometry.coordinates.map((poly: any) => 
        '(' + poly.map((ring: any) => 
          '(' + ring.map((c: any) => `${c[0]} ${c[1]}`).join(',') + ')'
        ).join(',') + ')'
      ).join(',');
      return `MULTIPOLYGON(${polys})`;
    }
  } catch (e) {
    return null;
  }
  return null;
}

async function main() {
  const filePath = process.argv[2];
  const countryParam = process.argv[3];
  const stateParam = process.argv[4];
  
  if (!filePath) {
    console.error('❌ Please provide the GeoJSON file path');
    console.error('   Usage: npx tsx scripts/import-geojson-homolog.ts <path> [country] [state]');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`📖 Streaming GeoJSON: ${filePath}`);

  const BATCH_SIZE = 100;
  let imported = 0;
  let errors = 0;
  let fileDuplicates = 0;
  let batchNum = 0;

  // Stream line-by-line: refine writes one Feature per line inside a FeatureCollection,
  // so we never load the whole file (avoids ERR_STRING_TOO_LONG / heap OOM on big inputs).
  async function processBatch(batch: any[]) {
    const poisMap = new Map<string, any>();
    const coordsMap = new Map<string, any>();

    for (const feature of batch) {
      const props = feature.properties;
      const geom = feature.geometry;
      
      const point = getPointFromGeometry(geom);
      if (!point) continue;

      const osmId = props['@id'];
      const osmType = props['@type'];
      const name = props.name;
      const lon = point.lon;
      const lat = point.lat;

      const uuid = generateUUID(osmId, osmType, name, lat, lon);
      
      if (poisMap.has(uuid)) {
        fileDuplicates++;
        continue;
      }

      const boundaryGeom = geoJsonToWkt(geom);

      // Canonicalise country/state at the door (SSOT) before staging.
      const loc = normalizeLocation(
        countryParam || props['addr:country'] || 'Thailand',
        stateParam || props['addr:state'] || null,
      )

      // Map properties to homolog.pois schema
      const poi = {
        uuid_id: uuid,
        name: name || 'Unnamed',
        osm_id: osmId,
        osm_type: osmType,
        lat: lat,
        lon: lon,
        osm_properties: props,
        category: props.tourism || props.historic || props.leisure || props.natural || props.amenity || props.aerialway,
        city: props['addr:city'],
        state: loc.state,
        country: loc.country,
        postal_code: props['addr:postcode'],
        street_name: props['addr:street'],
        house_number: props['addr:housenumber'],
        neighborhood: props['addr:suburb'] || props['addr:neighbourhood'],
        website: props.website || props['contact:website'],
        contact_phone: props.phone || props['contact:phone'],
        contact_email: props.email || props['contact:email'],
        wikidata: props.wikidata,
        wikipedia: props.wikipedia,
        brand: props.brand,
        brand_wikidata: props['brand:wikidata'],
        brand_wikipedia: props['brand:wikipedia'],
        operator_name: props.operator,
        amenity: props.amenity,
        building: props.building,
        leisure: props.leisure,
        man_made: props.man_made,
        wheelchair_accessible: props.wheelchair === 'yes' ? true : (props.wheelchair === 'no' ? false : null),
        internet_access: props.internet_access,
        rooms: props.rooms ? parseInt(props.rooms) : null,
        smoking: props.smoking,
        opening_hours: props.opening_hours,
        historic_period: props.historic_period,
        heritage_status: props.heritage || props.listed_status || props['heritage:operator'],
        unesco_status: props.unesco,
        start_date: props.start_date,
        fee: props.fee,
        alt_name: props.alt_name,
        is_historic: !!props.historic,
        is_touristic: !!props.tourism,
        elevation: props.ele ? parseFloat(props.ele) : null,
        building_levels: props['building_levels'] || props['building:levels'] ? parseInt(props['building_levels'] || props['building:levels']) : null,
        denomination: props.denomination,
        source_type: 'osm_pbf_refined',
        processing_status: 'pending'
      };

      const coord = {
        poi_uuid_id: uuid,
        latitude: lat,
        longitude: lon,
        show_in_map: true,
        boundary_geometry: boundaryGeom
      };

      poisMap.set(uuid, poi);
      coordsMap.set(uuid, coord);
    }

    const poisData = Array.from(poisMap.values());
    const coordsData = Array.from(coordsMap.values());

    if (poisData.length === 0) return;

    try {
      // 1. Upsert POIs
      const { error: poiError } = await supabase
        .schema('homolog')
        .from('pois')
        .upsert(poisData, { onConflict: 'uuid_id' });

      if (poiError) throw poiError;

      // 2. Upsert Coordinates
      const { error: coordError } = await supabase
        .schema('homolog')
        .from('coordinates')
        .upsert(coordsData, { onConflict: 'poi_uuid_id' });

      if (coordError) throw coordError;

      imported += poisData.length;
      process.stdout.write(`\r✅ Imported: ${imported} (Duplicates skipped: ${fileDuplicates})`);
    } catch (err) {
      console.error(`\n❌ Error in batch ${batchNum}:`, err);
      errors += batch.length;
    }
  }

  // Driver: stream the file, accumulate batches of BATCH_SIZE features, flush each.
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  let batch: any[] = [];
  for await (let line of rl) {
    line = line.trim();
    if (!line || line.startsWith('{"type":"FeatureCollection"') || line === ']}') continue;
    if (line.endsWith(',')) line = line.slice(0, -1);
    if (!line.startsWith('{')) continue;
    let feature: any;
    try { feature = JSON.parse(line); } catch { continue; }
    batch.push(feature);
    if (batch.length >= BATCH_SIZE) { batchNum++; await processBatch(batch); batch = []; }
  }
  if (batch.length > 0) { batchNum++; await processBatch(batch); }

  console.log(`\n\n🏁 Import finished!`);
  console.log(`✅ Success: ${imported}`);
  console.log(`⏭️  Duplicates in file: ${fileDuplicates}`);
  console.log(`❌ Failed: ${errors}`);
}

main().catch(console.error);
