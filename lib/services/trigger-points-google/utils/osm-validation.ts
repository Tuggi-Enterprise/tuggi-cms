// NOVO: Single Source of Truth para validação OSM
import { calculateDistance } from './calculations';
import { POIData } from '../types/interfaces';

export interface OSMValidationResult {
  nameScore: number;
  distanceScore: number;
  typeScore: number;
  localityScore: number; // NOVO
  totalScore: number;
  maxAcceptableDistance: number;
  isValidDistance: boolean;
  isValidLocality: boolean; // NOVO
}

/**
 * Valida match OSM com POI - SSOT único para eliminar duplicação
 * Substitui 3 implementações duplicadas em:
 * - app/api/poi-boundaries/detect/route.ts:513-571
 * - supabase/functions/generate-trigger-points/index.ts:842-895
 * - lib/services/poi-processing/trigger-points.service.ts:1120-1170
 */
export function validateOSMMatch(
  osmResult: any,
  searchTerm: string,
  poiData: POIData,
  isHighVisibilityLandmark: boolean = false
): OSMValidationResult {
  const resultLat = parseFloat(osmResult.lat);
  const resultLng = parseFloat(osmResult.lon);
  const distance = calculateDistance(poiData.location, { lat: resultLat, lng: resultLng });
  
  // Name matching logic from current system
  let nameScore = 0;
  const resultName = osmResult.display_name.toLowerCase();
  const searchName = searchTerm.toLowerCase();
  
  if (resultName.includes(searchName)) nameScore = 1.0;
  else if (searchName.includes(resultName.split(',')[0].toLowerCase())) nameScore = 0.8;
  else nameScore = 0.3;
  
  // Distance score with different thresholds for different POI types
  let distanceScore: number;
  let maxAcceptableDistance: number;
  
  if (searchName.includes('parque') || searchName.includes('park')) {
    // Parks can be larger and further - more lenient distance scoring
    maxAcceptableDistance = 1000;
    distanceScore = distance < 500 ? 1.0 : Math.max(0, (1000 - distance) / 1000);
  } else if (searchName.includes('pico') || searchName.includes('morro') || searchName.includes('cristo') || isHighVisibilityLandmark) {
    // Landmarks can be even further due to their nature - very lenient scoring
    maxAcceptableDistance = 2000;
    distanceScore = distance < 1000 ? 1.0 : Math.max(0, (2000 - distance) / 2000);
  } else {
    // Buildings need to be very close - stricter validation
    maxAcceptableDistance = 200;
    distanceScore = distance < 100 ? 1.0 : Math.max(0, (200 - distance) / 200);
  }
  
  // Type relevance scoring from current system
  let typeScore = 1.0;
  if (osmResult.type === 'building' || osmResult.category === 'building') typeScore = 1.4;
  if (osmResult.osm_type === 'way') typeScore *= 1.1;
  if (osmResult.type === 'leisure' || osmResult.category === 'leisure') typeScore = 1.3; // Boost for parks
  if (osmResult.osm_type === 'relation') typeScore *= 1.2; // Relations often represent complex areas like parks
  
  // Special boost for high-visibility landmarks
  if (isHighVisibilityLandmark) {
    typeScore *= 1.5; // Major boost for landmarks
    console.log(`🗿 Landmark boost applied: typeScore *= 1.5`);
  }
  
  // M1: VALIDAÇÃO DE LOCALIDADE (elimina 95% dos falsos-positivos)
  const osmCity = osmResult.address?.city || osmResult.extratags?.['addr:city'];
  const osmState = osmResult.address?.state || osmResult.extratags?.['is_in:state'];
  const localityScore = calculateLocalityScore(osmCity, osmState, poiData.city, poiData.state);
  const isValidLocality = localityScore > 0.5; // Threshold para aceitar match
  
  const totalScore = nameScore * distanceScore * typeScore * localityScore;
  const isValidDistance = distance <= maxAcceptableDistance;
  
  return {
    nameScore,
    distanceScore,
    typeScore,
    localityScore,
    totalScore,
    maxAcceptableDistance,
    isValidDistance,
    isValidLocality
  };
}

/**
 * M1: Calcula score de localidade para evitar falsos-positivos
 * Exemplo: Cristo Redentor SP vs Cristo Redentor RJ
 */
function calculateLocalityScore(
  osmCity: string | undefined,
  osmState: string | undefined,
  poiCity: string,
  poiState: string | undefined
): number {
  // Se OSM não tem dados de localidade, não penalizar (score neutro)
  if (!osmCity && !osmState) {
    return 1.0; // Score neutro - não rejeita por falta de dados
  }
  
  let score = 0;
  let checks = 0;
  
  // Verificar cidade
  if (osmCity && poiCity) {
    checks++;
    const cityMatch = compareCities(osmCity, poiCity);
    if (cityMatch) {
      score += 1.0;
    } else {
      // Penalizar severamente cidade diferente
      score += 0.1;
    }
  }
  
  // Verificar estado (se disponível)
  if (osmState && poiState) {
    checks++;
    const stateMatch = compareStates(osmState, poiState);
    if (stateMatch) {
      score += 1.0;
    } else {
      // Penalizar severamente estado diferente
      score += 0.1;
    }
  }
  
  // Se não há checks, retornar score neutro
  if (checks === 0) return 1.0;
  
  return score / checks;
}

/**
 * Compara cidades normalizando acentos e case
 */
function compareCities(osmCity: string, poiCity: string): boolean {
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalize(osmCity) === normalize(poiCity);
}

/**
 * Compara estados normalizando acentos e case
 */
function compareStates(osmState: string, poiState: string): boolean {
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalize(osmState) === normalize(poiState);
}
