/**
 * Scenic roads (route=road + scenic=yes) as one POI each.
 *
 * The tourist drives, and roads like the Großglockner-Hochalpenstraße are destinations. The elite
 * pipeline never saw them: `osmium export` emits nodes, ways and area relations only, so a route
 * relation does not reach Stage 3, and its member ways are plain `highway=*` pieces (117 of them for
 * the Großglockner alone). This builds one feature per relation, its tags plus a MultiLineString of
 * its member ways, for the elite filter (lib/shared/poi-filter#isScenicRoad) to judge.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { splitOnLineFeed } from './osm-local-data-service';

export interface OplRelation { id: number; tags: Record<string, string>; wayIds: number[] }

/** OPL escapes any non-plain character as %<hex code point>%. */
function unescapeOpl(s: string): string {
  return s.replace(/%([0-9a-fA-F]+)%/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

/** Parses one `osmium cat -f opl` relation line: `r<id> v.. T<k=v,...> M<w1@role,n2@,...>`. */
export function parseOplRelation(line: string): OplRelation | null {
  const fields = line.trim().split(' ');
  if (!fields[0]?.startsWith('r')) return null;
  const tags: Record<string, string> = {};
  const wayIds: number[] = [];
  for (const f of fields) {
    if (f.startsWith('T') && f.length > 1) {
      for (const kv of f.slice(1).split(',')) {
        const eq = kv.indexOf('=');
        if (eq > 0) tags[unescapeOpl(kv.slice(0, eq))] = unescapeOpl(kv.slice(eq + 1));
      }
    } else if (f.startsWith('M') && f.length > 1) {
      for (const m of f.slice(1).split(',')) if (m.startsWith('w')) wayIds.push(Number(m.slice(1).split('@')[0]));
    }
  }
  return { id: Number(fields[0].slice(1)), tags, wayIds };
}

export const isScenicRoadRelation = (tags: Record<string, string>) =>
  tags.type === 'route' && tags.route === 'road' && tags.scenic === 'yes' && !!tags.name;

/** One feature per route relation: its tags, and the member ways that have geometry. */
export function buildRouteFeature(rel: OplRelation, wayCoords: Map<number, number[][]>): any | null {
  const lines = rel.wayIds.map(id => wayCoords.get(id)).filter((c): c is number[][] => !!c && c.length > 1);
  if (!lines.length) return null;
  return {
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: lines },
    properties: { ...rel.tags, '@type': 'relation', '@id': rel.id },
  };
}

/** Runs osmium over the PBF and returns the scenic-road features (temp files go to workDir). */
export async function scenicRoadFeatures(inputPbf: string, workDir: string, tag: string): Promise<any[]> {
  const pbf = path.join(workDir, `scenic-${tag}.osm.pbf`);
  const opl = path.join(workDir, `scenic-${tag}.opl`);
  const seq = path.join(workDir, `scenic-${tag}.geojsonseq`);
  const run = (args: string[]) => {
    const r = spawnSync('osmium', args);
    if (r.status !== 0) throw new Error(`osmium ${args[0]} (scenic roads) failed: ${r.stderr}`);
  };
  try {
    run(['tags-filter', inputPbf, 'r/scenic=yes', '-o', pbf, '--overwrite']);
    run(['cat', pbf, '-t', 'relation', '-f', 'opl', '-o', opl, '--overwrite']);
    run(['export', pbf, '--geometry-types=linestring', '-f', 'geojsonseq', '-a', 'type,id', '-o', seq, '--overwrite']);
    const rels = fs.readFileSync(opl, 'utf8').split('\n').map(parseOplRelation)
      .filter((r): r is OplRelation => !!r && isScenicRoadRelation(r.tags));
    const wanted = new Set(rels.flatMap(r => r.wayIds));
    const wayCoords = new Map<number, number[][]>();
    for await (const line of splitOnLineFeed(fs.createReadStream(seq))) {
      const clean = line.trim().replace(/^\x1e/, '').trim();
      if (!clean) continue;
      const f = JSON.parse(clean);
      const id = Number(f.properties?.['@id']);
      if (f.properties?.['@type'] === 'way' && wanted.has(id) && f.geometry?.type === 'LineString') wayCoords.set(id, f.geometry.coordinates);
    }
    return rels.map(r => buildRouteFeature(r, wayCoords)).filter(Boolean);
  } finally {
    for (const f of [pbf, opl, seq]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
