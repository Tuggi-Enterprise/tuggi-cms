/**
 * Helpers de determinismo pro motor de Trigger Points.
 *
 * Princípio: re-gerar o mesmo POI deveria produzir o MESMO output (IDs, sample
 * points). Sem isso, diff entre versions do motor é impossível e debug "por que
 * esse POI mudou?" fica difícil em produção.
 *
 * Antes: `${Date.now()}_${Math.random().toString(36).slice(2,9)}`
 *  → mesmo POI gera IDs diferentes a cada call.
 *
 * Agora: hash determinístico de propriedades intrínsecas do TP.
 *  → mesmo POI + mesmas propriedades = mesmo ID.
 *
 * O modo `replace_all` (DELETE + INSERT no RPC) continua idempotente porque
 * deletamos todos os TPs antigos antes de inserir os novos — IDs estáveis
 * NÃO causam conflitos com TPs antigos.
 */

import { createHash } from 'crypto';

/**
 * Gera ID determinístico pra um TP a partir de propriedades intrínsecas.
 *
 * Inputs estáveis:
 *  - attractionId: chave do POI
 *  - kind: tipo semântico do TP ('frontal_up', 'frontal_down', 'geofence', 'primary', etc)
 *  - lat, lng: coordenadas (arredondadas a 6 decimais = ~0.1m de precisão)
 *
 * Output: string `<kind>_<8 hex chars>` (8 chars = ~4 bilhões de combinações,
 * suficiente pra colisões serem astronomicamente improváveis em 1 POI).
 */
export function deterministicTPId(
  attractionId: string,
  kind: string,
  lat: number,
  lng: number
): string {
  const payload = `${attractionId}|${kind}|${lat.toFixed(6)}|${lng.toFixed(6)}`;
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 8);
  return `${kind}_${hash}`;
}

/**
 * PRNG determinístico seedado em string (uso: sample points reproducíveis).
 * Mulberry32 — simples, rápido, qualidade suficiente pra sampling geométrico.
 *
 * Uso:
 *   const rng = seededRng(attractionId);
 *   const r = rng();  // [0, 1)
 */
export function seededRng(seed: string): () => number {
  // Hash string → uint32 seed
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  }
  let state = h >>> 0;
  return function mulberry32(): number {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
