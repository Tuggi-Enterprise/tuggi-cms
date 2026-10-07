/**
 * Municipal border mode (BR-POI-009, exception decided by the operator on 2026-10-07): a POI whose
 * stored border is an OSM administrative boundary (`boundary_source = 'osm_admin'`) gets no TP
 * spread over its area. It gets one TP on each main road that crosses the border, just inside, so
 * whoever drives in hears which municipality they entered. Small, service and private ways carry
 * none. The app plays it on entry and not on exit by its own direction lock, so the TP needs only
 * the inward bearing. An island municipality is entered by ferry: the route stops at the pier, so its
 * TP stands out at sea on the route (`ADMIN_BORDER_SEA_METHOD`, BR-POI-010).
 *
 * Pure: the caller hands in the border parts and the roads (`LocalOSMFetcher`, which already drops
 * ways closed by `access`/`military` — `config/visibility-class#isPublicWay`).
 */
import type { BoundaryData, StreetData, TriggerPoint } from '../types/interfaces';
import { calculateBearing, calculateDistance, calculateDistanceToLineSegment, isPointInPolygon } from './calculations';
import { deterministicTPId } from './deterministic';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';

type LatLng = { lat: number; lng: number };

/** The border source that turns the mode on. The nature of the border decides, never name or category. */
export const ADMIN_BORDER_SOURCE = 'osm_admin';
/** Main roads, busiest first; each `_link` ranks just under its road. Everything else is skipped. */
const MAIN_ROAD_ORDER = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
// Ferry too (operator, 2026-10-06): an island municipality is entered only by sea, and a river crossing
// (Lisboa–Almada) is an entry like a bridge. Ranked last: a road crossing wins the spacing over a ferry.
export const ADMIN_BORDER_ROAD_TYPES: readonly string[] = [...MAIN_ROAD_ORDER.flatMap(t => [t, `${t}_link`]), 'ferry'];
/** How far inside the border the TP stands, measured along the road. */
export const ADMIN_BORDER_TP_INSET_M = 150;
/** Fixed: the TP stands on a fast road and the app does not widen the radius by speed (BR-AUDIO-010). */
export const ADMIN_BORDER_TP_RADIUS_M = 150;
/** Two TPs of the same POI closer than this are one entry (dual carriageway, road and its link). */
export const ADMIN_BORDER_TP_MIN_SPACING_M = 300;
/**
 * A TP closer than this to the border, after walking the inset along the road, is on a road that
 * skirts the border instead of entering (Alenquer's EN 115 weaves across it every ~400 m).
 */
export const ADMIN_BORDER_TP_MIN_EDGE_M = ADMIN_BORDER_TP_INSET_M / 2;
/**
 * BR-POI-010, island municipality (operator, 2026-10-06: "Vila do Corvo poderia ter POIs no mar, no
 * caminho dos navios"): the OSM polygon follows the coastline and the ferry route stops at the pier,
 * just outside it (Corvo: 21 m), so the route never crosses. A ferry end outside a part and at most
 * this far from its edge is the pier of that part.
 */
export const ADMIN_BORDER_FERRY_PIER_MAX_M = 300;
/** The sea TP stands this far from the pier, out to sea along the route. */
export const ADMIN_BORDER_SEA_OFFSET_M = 300;
/** E11 keeps a sea TP only this close to the border; nothing else of the mode may stand outside. */
export const ADMIN_BORDER_SEA_MAX_EDGE_M = 1_000;
/** generationMethod that marks the sea TP; E11 (`tp-selection#applyTpPostConditions`) reads it. */
export const ADMIN_BORDER_SEA_METHOD = 'admin_border_sea' as const;
/** Ways joined end to end while walking inward; OSM splits a road at every tag change. */
const MAX_STITCH_HOPS = 20;

export function isAdminBorder(boundary?: { source?: BoundaryData['source'] | string } | null): boolean {
  return boundary?.source === ADMIN_BORDER_SOURCE;
}

function roadRank(type: string): number {
  if (type === 'ferry') return 0; // below every road, but kept
  const i = MAIN_ROAD_ORDER.indexOf(type.replace(/_link$/, ''));
  return i < 0 ? -1 : (MAIN_ROAD_ORDER.length - i) * 2 - (type.endsWith('_link') ? 1 : 0);
}

/** Directions a vehicle may travel along the way's geometry: +1 forward, -1 backward. */
function travelDirections(s: StreetData): Array<1 | -1> {
  const tags = (s as StreetData & { tags?: Record<string, unknown> }).tags ?? {};
  const oneway = String(tags.oneway ?? '');
  if (oneway === '-1' || oneway === 'reverse') return [-1];
  if (oneway === 'no') return [1, -1];
  // OSM: motorway, motorway_link and roundabouts are one-way by implication.
  if (['yes', 'true', '1'].includes(oneway) || s.type === 'motorway' || s.type === 'motorway_link' || tags.junction === 'roundabout') return [1];
  return [1, -1];
}

const nodeKey = (p: LatLng) => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;

/** Crossing of segment AB with segment CD, as the parameter along AB, on a local plane. */
function segmentCrossing(a: LatLng, b: LatLng, c: LatLng, d: LatLng): number | null {
  const k = Math.cos((a.lat * Math.PI) / 180);
  const rx = (b.lng - a.lng) * k, ry = b.lat - a.lat;
  const sx = (d.lng - c.lng) * k, sy = d.lat - c.lat;
  const den = rx * sy - ry * sx;
  if (den === 0) return null;
  const qx = (c.lng - a.lng) * k, qy = c.lat - a.lat;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

interface Entry { street: StreetData; point: LatLng; bearing: number; score: number; sea?: boolean }

/**
 * One TP per main road entering the border, ~`ADMIN_BORDER_TP_INSET_M` inside along the road,
 * deduplicated to `ADMIN_BORDER_TP_MIN_SPACING_M` (busiest road first; on a dual carriageway the
 * inbound one). Every polygon part counts: a municipality with islands or exclaves exists.
 */
export function adminBorderTriggerPoints(poiId: string, parts: LatLng[][], streets: StreetData[]): TriggerPoint[] {
  const rings = parts.filter(r => r.length >= 3);
  const inside = (p: LatLng) => rings.some(r => isPointInPolygon(p, r));
  const edgeM = (p: LatLng) => Math.min(...rings.map(r =>
    r.reduce((m, a, i) => Math.min(m, calculateDistanceToLineSegment(p, a, r[(i + 1) % r.length])), Infinity)));
  const roads = streets.filter(s => roadRank(s.type) >= 0 && (s.coordinates?.length ?? 0) >= 2);

  const byNode = new Map<string, StreetData[]>();
  for (const s of roads) {
    for (const end of [s.coordinates[0], s.coordinates[s.coordinates.length - 1]]) {
      const list = byNode.get(nodeKey(end)) ?? [];
      list.push(s);
      byNode.set(nodeKey(end), list);
    }
  }

  /** Walks `distM` along the road from `start` (on segment `seg`), joining ways end to end. */
  const walk = (street: StreetData, seg: number, start: LatLng, dir: 1 | -1, distM: number) => {
    let way = street, coords = way.coordinates, cur = start, i = dir === 1 ? seg + 1 : seg, remaining = distM;
    let bearing = calculateBearing(start, coords[i]);
    const visited = new Set<StreetData>([way]);
    for (let hops = 0; ; hops++) {
      for (; i >= 0 && i < coords.length; i += dir) {
        const next = coords[i];
        const d = calculateDistance(cur, next);
        if (d > 0) bearing = calculateBearing(cur, next);
        if (d >= remaining && d > 0) {
          const r = remaining / d;
          return { point: { lat: cur.lat + (next.lat - cur.lat) * r, lng: cur.lng + (next.lng - cur.lng) * r }, bearing };
        }
        remaining -= d;
        cur = next;
      }
      const options = (byNode.get(nodeKey(cur)) ?? []).filter(w => !visited.has(w));
      const nextWay = options.find(w => w.type === way.type) ?? options.sort((x, y) => roadRank(y.type) - roadRank(x.type))[0];
      if (!nextWay || hops >= MAX_STITCH_HOPS) return { point: cur, bearing }; // the road ends short of the inset
      visited.add(nextWay);
      way = nextWay;
      coords = way.coordinates;
      const forward = nodeKey(coords[0]) === nodeKey(cur);
      dir = forward ? 1 : -1;
      i = forward ? 1 : coords.length - 2;
    }
  };

  const entries: Entry[] = [];
  for (const s of roads) {
    const c = s.coordinates;
    const travel = travelDirections(s);
    for (let k = 0; k < c.length - 1; k++) {
      const aIn = inside(c[k]), bIn = inside(c[k + 1]);
      if (aIn === bIn) continue;
      // The crossing nearest the inside vertex: the road enters there.
      let t: number | null = null;
      for (const r of rings) {
        for (let e = 0; e < r.length; e++) {
          const x = segmentCrossing(c[k], c[k + 1], r[e], r[(e + 1) % r.length]);
          if (x !== null && (t === null || (bIn ? x > t : x < t))) t = x;
        }
      }
      const tt = t ?? (bIn ? 1 : 0);
      const crossing = { lat: c[k].lat + (c[k + 1].lat - c[k].lat) * tt, lng: c[k].lng + (c[k + 1].lng - c[k].lng) * tt };
      const dir: 1 | -1 = bIn ? 1 : -1;
      const tp = walk(s, k, crossing, dir, ADMIN_BORDER_TP_INSET_M);
      // The road leaves again before the inset, or runs along the border: nobody has entered.
      // A ferry ends at the pier, on the coast: its end is the arrival, so the edge rule does not apply.
      if (!inside(tp.point) || (s.type !== 'ferry' && edgeM(tp.point) < ADMIN_BORDER_TP_MIN_EDGE_M)) continue;
      entries.push({ street: s, point: tp.point, bearing: tp.bearing, score: roadRank(s.type) * 2 + (travel.includes(dir) ? 1 : 0) });
    }
  }

  // Sea TP (BR-POI-010): a ferry that never enters a part but ends at its pier gets the TP out at
  // sea, on the route, facing the pier. A route that does enter took the crossing path above.
  for (const s of roads) {
    if (s.type !== 'ferry') continue;
    const c = s.coordinates;
    const ends = [
      { end: c[0], seg: 0, dir: 1 as const },
      { end: c[c.length - 1], seg: c.length - 2, dir: -1 as const },
    ];
    for (const { end, seg, dir } of ends) {
      // A ferry split in OSM continues on the next way: only the route's real end is a pier.
      if ((byNode.get(nodeKey(end)) ?? []).some(w => w !== s && w.type === 'ferry')) continue;
      const pierOf = rings.some(r => !c.some(p => isPointInPolygon(p, r))
        && r.reduce((m, a, i) => Math.min(m, calculateDistanceToLineSegment(end, a, r[(i + 1) % r.length])), Infinity) <= ADMIN_BORDER_FERRY_PIER_MAX_M);
      if (!pierOf) continue;
      const tp = walk(s, seg, end, dir, ADMIN_BORDER_SEA_OFFSET_M);
      // Walked out to sea; the ship comes the other way.
      entries.push({ street: s, point: tp.point, bearing: (tp.bearing + 180) % 360, score: roadRank(s.type) * 2 + 1, sea: true });
    }
  }

  const kept: Entry[] = [];
  for (const e of entries.sort((x, y) => y.score - x.score)) {
    if (kept.every(k => calculateDistance(k.point, e.point) >= ADMIN_BORDER_TP_MIN_SPACING_M)) kept.push(e);
  }

  const now = new Date().toISOString();
  return kept.map(e => ({
    id: deterministicTPId(poiId, `${e.sea ? ADMIN_BORDER_SEA_METHOD : 'admin_border'}_${e.street.id}`, e.point.lat, e.point.lng),
    location: e.point,
    radius: ADMIN_BORDER_TP_RADIUS_M,
    expectedBearing: e.bearing,
    bearingThreshold: TRIGGER_POINTS_CONSTANTS.triggerPoint.defaultBearingThreshold,
    type: 'primary' as const,
    priority: 1,
    confidence: 0.9,
    quality: 0.9,
    street: e.street,
    // Edge distance, as every TP of the engine: inside the border it is 0 (the DB cap measures the same).
    distance: e.sea ? edgeM(e.point) : 0,
    generationMethod: e.sea ? ADMIN_BORDER_SEA_METHOD : ('local_osm' as const),
    createdAt: now,
    updatedAt: now,
  }));
}
