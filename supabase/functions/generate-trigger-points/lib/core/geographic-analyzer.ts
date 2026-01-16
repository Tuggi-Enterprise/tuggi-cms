// Analisador geográfico completo

import { BoundaryData, GeographicContext, POIData } from '../types/interfaces.ts';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config.ts';
import { calculatePolygonArea, calculatePolygonPerimeter, calculatePolygonCenter } from '../utils/calculations.ts';

export class GeographicContextAnalyzer {
  
  /**
   * Analisa o contexto geográfico de um POI
   */
  async analyzeContext(poiData: POIData, boundary: BoundaryData): Promise<GeographicContext> {
    console.log(`🌍 Analyzing geographic context for ${poiData.name}...`);
    
    // 1. Analisar tipo de ambiente via API externa (OpenStreetMap / Overpass)
    // Para simplificar e economizar, usamos heurísticas baseadas em dados do boundary
    const urbanDensity = await this.estimateUrbanDensity(boundary);
    
    // 2. Analisar complexidade de acesso
    const accessComplexity = this.analyzeAccessComplexity(boundary, urbanDensity);
    
    // 3. Analisar barreiras naturais (água, parques, montanhas)
    const naturalBarriers = await this.detectNaturalBarriers(boundary);
    
    // 4. Analisar tipo de zona (comercial, residencial, industrial)
    const zoneType = await this.determineZoneType(boundary, poiData);

    const context: GeographicContext = {
      urbanDensity,
      terrainType: 'flat', // Default, será atualizado pelo ElevationService se disponível
      accessComplexity,
      naturalBarriers,
      zoneType
    };

    console.log(`✅ Context analysis complete: ${urbanDensity.level} density, ${zoneType} zone`);

    return context;
  }
  
  /**
   * Estima densidade urbana baseada em dados do boundary e da área
   */
  private async estimateUrbanDensity(boundary: BoundaryData): Promise<{ level: 'rural' | 'low' | 'medium' | 'dense' | 'very_dense'; score: number }> {
    // Heurística baseada em área e perímetro
    // Áreas menores com perímetros complexos tendem a ser urbanas
    // Áreas grandes tendem a ser parques ou rurais
    
    const area = calculatePolygonArea(boundary.coordinates);
    const perimeter = calculatePolygonPerimeter(boundary.coordinates);
    
    // Fator de forma (compacidade)
    // Círculo tem fator 1.0. Formas complexas (urbanas) têm fator menor.
    const compactness = (4 * Math.PI * area) / (perimeter * perimeter);
    
    let score = 0.5; // Começa como médio
    
    // Ajuste por tamanho
    if (area < 2000) { // < 2.000m² (prédio pequeno/casa)
      score += 0.3; // Provavelmente denso
    } else if (area < 10000) { // < 10.000m² (quarteirão)
      score += 0.1;
    } else if (area > 100000) { // > 100.000m² (parque grande/aeroporto)
      score -= 0.3; // Provavelmente baixa densidade
    }
    
    // Ajuste por complexidade
    if (compactness < 0.3) {
      score += 0.1; // Forma complexa = urbano
    }
    
    // Ajuste por número de pontos no boundary (mais pontos = mais detalhe = mais urbano)
    if (boundary.coordinates.length > 20) {
      score += 0.1;
    }
    
    // Clamp score
    score = Math.max(0, Math.min(1, score));
    
    let level: 'rural' | 'low' | 'medium' | 'dense' | 'very_dense';
    if (score < 0.2) level = 'rural';
    else if (score < 0.4) level = 'low';
    else if (score < 0.6) level = 'medium';
    else if (score < 0.8) level = 'dense';
    else level = 'very_dense';
    
    return { level, score };
  }
  
  /**
   * Analisa complexidade de acesso
   */
  private analyzeAccessComplexity(
    boundary: BoundaryData, 
    urbanDensity: { level: string }
  ): { level: 'easy' | 'moderate' | 'hard' | 'restricted'; factors: string[] } {
    const factors: string[] = [];
    let complexityScore = 0;
    
    // Fator 1: Tamanho do boundary
    if (calculatePolygonPerimeter(boundary.coordinates) > 1000) {
      complexityScore += 1;
      factors.push('large_perimeter');
    }
    
    // Fator 2: Densidade urbana
    if (urbanDensity.level === 'very_dense') {
      complexityScore += 2;
      factors.push('high_density');
    } else if (urbanDensity.level === 'dense') {
      complexityScore += 1;
    }
    
    // Determinar nível
    let level: 'easy' | 'moderate' | 'hard' | 'restricted' = 'easy';
    if (complexityScore >= 3) level = 'hard';
    else if (complexityScore >= 1) level = 'moderate';
    
    return { level, factors };
  }
  
  /**
   * Detecta barreiras naturais (simulado por enquanto)
   */
  private async detectNaturalBarriers(boundary: BoundaryData): Promise<string[]> {
    // Em uma implementação real, usaria Overpass API para buscar água/parques próximos
    return [];
  }
  
  /**
   * Determina tipo de zona
   */
  private async determineZoneType(boundary: BoundaryData, poiData: POIData): Promise<'commercial' | 'residential' | 'industrial' | 'park' | 'mixed'> {
    // Inferência baseada em tipos do Google Places
    if (poiData.types) {
      if (poiData.types.includes('park') || poiData.types.includes('natural_feature')) return 'park';
      if (poiData.types.includes('industrial_park') || poiData.types.includes('factory')) return 'industrial';
      if (poiData.types.includes('shopping_mall') || poiData.types.includes('store')) return 'commercial';
      if (poiData.types.includes('lodging') || poiData.types.includes('real_estate_agency')) return 'residential';
    }
    
    return 'mixed';
  }
}
