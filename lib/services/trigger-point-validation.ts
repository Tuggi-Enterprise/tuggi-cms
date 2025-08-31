export interface ValidationResult {
  isValid: boolean;
  score: number;
  issues: string[];
  recommendations: string[];
}

export class TriggerPointValidationService {
  /**
   * Valida trigger points após geração
   */
  static validateTriggerPoints(
    triggerPoints: any[],
    boundary: any,
    poi: { lat: number; lng: number; name: string }
  ): ValidationResult {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // 1. Validar se pontos estão dentro ou próximos do boundary
    const pointsOutsideBoundary = triggerPoints.filter(tp => {
      // Implementar point-in-polygon ou distância máxima
      return false; // Placeholder
    });

    if (pointsOutsideBoundary.length > 0) {
      issues.push(`${pointsOutsideBoundary.length} trigger points fora do boundary`);
      score -= 20;
    }

    // 2. Validar distâncias mínimas
    const minDistance = 30; // metros
    let tooClose = 0;
    
    for (let i = 0; i < triggerPoints.length; i++) {
      for (let j = i + 1; j < triggerPoints.length; j++) {
        const distance = this.calculateDistance(
          triggerPoints[i].lat, triggerPoints[i].lng,
          triggerPoints[j].lat, triggerPoints[j].lng
        );
        
        if (distance < minDistance) {
          tooClose++;
        }
      }
    }

    if (tooClose > 0) {
      issues.push(`${tooClose} pares de trigger points muito próximos (<${minDistance}m)`);
      score -= Math.min(tooClose * 5, 30);
    }

    // 3. Validar cobertura direcional
    const directions = this.analyzeDirectionalCoverage(triggerPoints, poi);
    if (directions.coverage < 0.7) {
      issues.push(`Cobertura direcional baixa (${Math.round(directions.coverage * 100)}%)`);
      recommendations.push('Adicionar trigger points em direções não cobertas');
      score -= 15;
    }

    // 4. Validar acessibilidade (pontos em ruas/caminhos)
    const inaccessiblePoints = triggerPoints.filter(tp => 
      tp.generation_method === 'estimated' && tp.confidence < 0.5
    );

    if (inaccessiblePoints.length > triggerPoints.length * 0.3) {
      issues.push('Muitos pontos em locais potencialmente inacessíveis');
      recommendations.push('Revisar pontos com baixa confiança');
      score -= 10;
    }

    return {
      isValid: score >= 70,
      score: Math.max(0, score),
      issues,
      recommendations
    };
  }

  private static calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lng2-lng1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  private static analyzeDirectionalCoverage(
    triggerPoints: any[],
    poi: { lat: number; lng: number }
  ): { coverage: number; gaps: number[] } {
    const directions: number[] = [];
    
    triggerPoints.forEach(tp => {
      const bearing = this.calculateBearing(poi.lat, poi.lng, tp.lat, tp.lng);
      directions.push(bearing);
    });

    // Dividir em 8 setores (45° cada)
    const sectors = new Array(8).fill(false);
    
    directions.forEach(bearing => {
      const sector = Math.floor(((bearing + 22.5) % 360) / 45);
      sectors[sector] = true;
    });

    const coveredSectors = sectors.filter(Boolean).length;
    const coverage = coveredSectors / 8;
    
    const gaps = sectors
      .map((covered, index) => covered ? null : index * 45)
      .filter(gap => gap !== null) as number[];

    return { coverage, gaps };
  }

  private static calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δλ = (lng2-lng1) * Math.PI/180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    const θ = Math.atan2(y, x);

    return (θ * 180/Math.PI + 360) % 360;
  }
}
