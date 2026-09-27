/**
 * Classe de visibilidade do POI — BR-AUDIO-010 (o TP dispara onde o POI está).
 *
 * Motor agnóstico (épico #772): a classe sai de atributo FÍSICO — altura, proeminência
 * sobre o terreno, área e forma do boundary. Nenhum nome de POI vira ramo. Tag OSM entra
 * só como TABELA DE DADO (altura padrão quando falta a real; tag de mirante), nunca como `if`.
 *
 * PROVISÓRIO: todo número deste arquivo é da auditoria do motor (2026-09-27) e ainda não
 * tem regra `BR-*` própria — o `produto` registra (#775). Até lá, este é o único lugar deles.
 */
import { GeoPoint } from '../types/interfaces';

export enum VisibilityClass {
  /** pontual e baixo (<5 m): busto, placa, chafariz */
  POINT_LOW = 'point_low',
  /** estrutura de 5 a 30 m */
  STRUCTURE = 'structure',
  /** área grande e baixa: parque, praça, praia */
  AREA = 'area',
  /** boundary alongado: orla, calçadão, ponte */
  LINEAR = 'linear',
  /** alto (≥30 m) ou proeminente sobre o terreno: visível de longe */
  LANDMARK_HIGH = 'landmark_high',
  /** mirante — o turista vai até ele, não o vê de longe */
  VIEWPOINT = 'viewpoint',
}

// ── Limiares da classificação (provisórios, #775) ──────────────────────────────
export const STRUCTURE_MIN_HEIGHT_M = 5;
export const LANDMARK_MIN_HEIGHT_M = 30;
/** Proeminência sobre a base regional. Abaixo disto é ruído do SRTM urbano. */
export const LANDMARK_MIN_PROMINENCE_M = 100;
export const AREA_MIN_M2 = 10_000;
/** Razão eixo maior / eixo menor do boundary. */
export const LINEAR_MIN_ELONGATION = 4;
/** Comprimento mínimo do eixo maior para contar como linear (evita prédio estreito). */
export const LINEAR_MIN_LENGTH_M = 150;

// ── Tetos ──────────────────────────────────────────────────────────────────────
/** Teto absoluto de sanidade TP↔POI: barra lixo, não decide produto. */
export const SANITY_MAX_TP_DISTANCE_M = 15_000;
/** Horizonte de marco alto em terreno plano: quem visita chega de ≤2 km. */
export const URBAN_LANDMARK_HORIZON_M = 2_000;
/** Faixa "de borda": TP até aqui conta como colado ao POI (não entra no limite de TPs distantes). */
export const EDGE_BAND_M = 100;

export interface ClassLimits {
  /** distância máxima do TP à BORDA do POI */
  maxEdgeDistanceM: number;
  /** teto do radius_meters do TP */
  maxRadiusM: number;
  /** nº máximo de TPs na faixa de borda (≤ EDGE_BAND_M) */
  maxTPs: number;
  /** nº máximo de TPs além da faixa de borda */
  maxFarTPs: number;
}

export const CLASS_LIMITS: Record<VisibilityClass, ClassLimits> = {
  [VisibilityClass.POINT_LOW]: { maxEdgeDistanceM: 60, maxRadiusM: 30, maxTPs: 4, maxFarTPs: 0 },
  [VisibilityClass.STRUCTURE]: { maxEdgeDistanceM: 100, maxRadiusM: 40, maxTPs: 6, maxFarTPs: 0 },
  [VisibilityClass.AREA]: { maxEdgeDistanceM: 60, maxRadiusM: 50, maxTPs: 16, maxFarTPs: 0 },
  [VisibilityClass.LINEAR]: { maxEdgeDistanceM: 60, maxRadiusM: 50, maxTPs: 16, maxFarTPs: 0 },
  [VisibilityClass.LANDMARK_HIGH]: { maxEdgeDistanceM: URBAN_LANDMARK_HORIZON_M, maxRadiusM: 100, maxTPs: 8, maxFarTPs: 4 },
  [VisibilityClass.VIEWPOINT]: { maxEdgeDistanceM: 60, maxRadiusM: 30, maxTPs: 4, maxFarTPs: 0 },
};

/**
 * Distância máxima à borda para a classe. Marco em terreno elevado (proeminência real)
 * vai até o teto de sanidade; o resto usa o teto da tabela.
 */
export function maxEdgeDistanceFor(cls: VisibilityClass, prominenceM = 0): number {
  if (cls === VisibilityClass.LANDMARK_HIGH && prominenceM >= LANDMARK_MIN_PROMINENCE_M) {
    return SANITY_MAX_TP_DISTANCE_M;
  }
  return CLASS_LIMITS[cls].maxEdgeDistanceM;
}

// ── Tabelas de dado (tag OSM) ────────────────────────────────────────────────
type TagRow = { key: string; value: string; heightM: number };

/** Altura padrão quando o OSM não traz `height` nem `building:levels`. */
export const DEFAULT_HEIGHT_BY_TAG: TagRow[] = [
  { key: 'memorial', value: 'bust', heightM: 2.5 },
  { key: 'historic', value: 'memorial', heightM: 2.5 },
  { key: 'memorial', value: 'statue', heightM: 6 },
  { key: 'artwork_type', value: 'statue', heightM: 6 },
  { key: 'historic', value: 'monument', heightM: 12 },
  { key: 'man_made', value: 'obelisk', heightM: 12 },
  { key: 'memorial', value: 'obelisk', heightM: 12 },
  { key: 'building', value: 'chapel', heightM: 10 },
  { key: 'building', value: 'church', heightM: 25 },
  { key: 'building', value: 'cathedral', heightM: 25 },
  { key: 'building', value: 'basilica', heightM: 25 },
  { key: 'man_made', value: 'lighthouse', heightM: 20 },
  { key: 'man_made', value: 'tower', heightM: 30 },
  { key: 'tourism', value: 'viewpoint', heightM: 0 },
];

/** Altura por andar, para `building:levels`. */
export const BUILDING_LEVEL_HEIGHT_M = 4;

/** Tags que marcam um mirante. */
export const VIEWPOINT_TAGS: Array<{ key: string; value: string }> = [
  { key: 'tourism', value: 'viewpoint' },
];

function hasTag(tags: Record<string, unknown> | undefined, key: string, value: string): boolean {
  return String(tags?.[key] ?? '').toLowerCase() === value;
}

function parseMeters(raw: unknown): number | null {
  const m = String(raw ?? '').match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Altura física do POI: `height` real > `building:levels` × BUILDING_LEVEL_HEIGHT_M >
 * DEFAULT_HEIGHT_BY_TAG (maior valor entre as tags que casam) > a altura já conhecida.
 */
export function resolveHeightM(
  tags: Record<string, unknown> | undefined,
  knownHeightM?: number
): { heightM: number; source: 'height' | 'levels' | 'known' | 'tag_default' | 'none' } {
  const real = parseMeters(tags?.height);
  if (real) return { heightM: real, source: 'height' };
  const levels = parseMeters(tags?.['building:levels']);
  if (levels) return { heightM: levels * BUILDING_LEVEL_HEIGHT_M, source: 'levels' };
  if (knownHeightM && knownHeightM > 0) return { heightM: knownHeightM, source: 'known' };
  const rows = DEFAULT_HEIGHT_BY_TAG.filter(r => hasTag(tags, r.key, r.value));
  if (rows.length) return { heightM: Math.max(...rows.map(r => r.heightM)), source: 'tag_default' };
  return { heightM: 0, source: 'none' };
}

/**
 * Alongamento do boundary: razão entre os desvios dos eixos principais (PCA) e o
 * comprimento do eixo maior, em metros, numa projeção local.
 */
export function boundaryShape(coords: GeoPoint[] | undefined): { elongation: number; lengthM: number } {
  if (!coords || coords.length < 3) return { elongation: 1, lengthM: 0 };
  const lat0 = coords.reduce((s, p) => s + p.lat, 0) / coords.length;
  const lng0 = coords.reduce((s, p) => s + p.lng, 0) / coords.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const pts = coords.map(p => ({ x: (p.lng - lng0) * kx, y: (p.lat - lat0) * ky }));
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y; }
  sxx /= pts.length; syy /= pts.length; sxy /= pts.length;
  const tr = sxx + syy;
  const disc = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(tr / 2 - disc, 1e-9);
  // eixo maior: extensão das projeções no autovetor principal
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const proj = pts.map(p => p.x * ux + p.y * uy);
  return { elongation: Math.sqrt(l1 / l2), lengthM: Math.max(...proj) - Math.min(...proj) };
}

export interface PhysicalAttributes {
  heightM: number;
  /** proeminência sobre a base regional (m); 0 quando desconhecida */
  prominenceM: number;
  areaM2: number;
  boundary?: GeoPoint[];
  tags?: Record<string, unknown>;
}

/** Classificador único e puro. A ordem é a precedência. */
export function classifyVisibility(a: PhysicalAttributes): VisibilityClass {
  if (VIEWPOINT_TAGS.some(t => hasTag(a.tags, t.key, t.value))) return VisibilityClass.VIEWPOINT;
  if (a.heightM >= LANDMARK_MIN_HEIGHT_M || a.prominenceM >= LANDMARK_MIN_PROMINENCE_M) {
    return VisibilityClass.LANDMARK_HIGH;
  }
  const shape = boundaryShape(a.boundary);
  if (shape.elongation >= LINEAR_MIN_ELONGATION && shape.lengthM >= LINEAR_MIN_LENGTH_M) {
    return VisibilityClass.LINEAR;
  }
  if (a.areaM2 >= AREA_MIN_M2) return VisibilityClass.AREA;
  if (a.heightM >= STRUCTURE_MIN_HEIGHT_M) return VisibilityClass.STRUCTURE;
  return VisibilityClass.POINT_LOW;
}
