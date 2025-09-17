// Exemplo de implementação do sistema core de trigger points
// Este arquivo demonstra como usar o CoreTriggerPointPredictor

import { CoreTriggerPointPredictor } from '@/lib/services/trigger-points-google/core/trigger-point-predictor';
import { POIData, TriggerPoint } from '@/lib/services/trigger-points-google/types/interfaces';

// Exemplo de uso básico
async function exemploBasico() {
  const predictor = new CoreTriggerPointPredictor();
  
  const poiData: POIData = {
    id: 'exemplo-1',
    name: 'Copacabana Beach',
    location: { lat: -22.9711, lng: -43.1822 },
    type: 'tourist_attraction',
    country: 'Brazil',
    city: 'Rio de Janeiro'
  };
  
  try {
    const triggerPoints = await predictor.predictTriggerPoints(poiData);
    
    console.log(`Gerados ${triggerPoints.length} trigger points para ${poiData.name}`);
    
    triggerPoints.forEach((tp, index) => {
      console.log(`Trigger Point ${index + 1}:`);
      console.log(`  Localização: ${tp.location.lat}, ${tp.location.lng}`);
      console.log(`  Raio: ${tp.radius}m`);
      console.log(`  Qualidade: ${tp.quality.toFixed(2)}`);
      console.log(`  Confiança: ${tp.confidence.toFixed(2)}`);
      console.log(`  Tipo: ${tp.type}`);
    });
    
  } catch (error) {
    console.error('Erro ao gerar trigger points:', error);
  }
}

// Exemplo de processamento em lote
async function exemploLote() {
  const predictor = new CoreTriggerPointPredictor();
  
  const pois: POIData[] = [
    {
      id: 'exemplo-1',
      name: 'Copacabana Beach',
      location: { lat: -22.9711, lng: -43.1822 },
      type: 'tourist_attraction',
      country: 'Brazil',
      city: 'Rio de Janeiro'
    },
    {
      id: 'exemplo-2',
      name: 'Ibirapuera Park',
      location: { lat: -23.5874, lng: -46.6576 },
      type: 'park',
      country: 'Brazil',
      city: 'São Paulo'
    },
    {
      id: 'exemplo-3',
      name: 'Christ the Redeemer',
      location: { lat: -22.9519, lng: -43.2105 },
      type: 'monument',
      country: 'Brazil',
      city: 'Rio de Janeiro'
    }
  ];
  
  console.log(`Processando ${pois.length} POIs...`);
  
  const resultados = await Promise.all(
    pois.map(async (poi) => {
      try {
        const triggerPoints = await predictor.predictTriggerPoints(poi);
        return {
          poiId: poi.id,
          poiName: poi.name,
          success: true,
          triggerPoints: triggerPoints.length,
          averageQuality: triggerPoints.reduce((sum, tp) => sum + tp.quality, 0) / triggerPoints.length
        };
      } catch (error) {
        return {
          poiId: poi.id,
          poiName: poi.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    })
  );
  
  console.log('Resultados do processamento em lote:');
  resultados.forEach(resultado => {
    if (resultado.success) {
      console.log(`✅ ${resultado.poiName}: ${resultado.triggerPoints} trigger points (qualidade média: ${resultado.averageQuality?.toFixed(2) || 'N/A'})`);
    } else {
      console.log(`❌ ${resultado.poiName}: Erro - ${resultado.error}`);
    }
  });
}

// Exemplo de uso com opções customizadas
async function exemploCustomizado() {
  const predictor = new CoreTriggerPointPredictor();
  
  const poiData: POIData = {
    id: 'exemplo-customizado',
    name: 'Central Park',
    location: { lat: 40.7829, lng: -73.9654 },
    type: 'park',
    country: 'United States',
    city: 'New York'
  };
  
  // Configurar opções customizadas
  const opcoes = {
    maxSearchRadius: 1500, // 1.5km
    minQuality: 0.6,       // Qualidade mínima 60%
    maxTriggerPoints: 15   // Máximo 15 trigger points
  };
  
  try {
    const triggerPoints = await predictor.predictTriggerPoints(poiData);
    
    // Filtrar por qualidade mínima
    const triggerPointsFiltrados = triggerPoints.filter(tp => tp.quality >= opcoes.minQuality);
    
    // Limitar quantidade
    const triggerPointsLimitados = triggerPointsFiltrados.slice(0, opcoes.maxTriggerPoints);
    
    console.log(`POI: ${poiData.name}`);
    console.log(`Total gerado: ${triggerPoints.length}`);
    console.log(`Após filtro de qualidade: ${triggerPointsFiltrados.length}`);
    console.log(`Após limite de quantidade: ${triggerPointsLimitados.length}`);
    
    // Mostrar trigger points primários
    const triggerPointsPrimarios = triggerPointsLimitados.filter(tp => tp.type === 'primary');
    console.log(`Trigger points primários: ${triggerPointsPrimarios.length}`);
    
  } catch (error) {
    console.error('Erro ao processar POI customizado:', error);
  }
}

// Exemplo de análise de contexto geográfico
async function exemploAnaliseContexto() {
  const predictor = new CoreTriggerPointPredictor();
  
  const pois: POIData[] = [
    {
      id: 'urbano-denso',
      name: 'Times Square',
      location: { lat: 40.7580, lng: -73.9855 },
      type: 'tourist_attraction',
      country: 'United States',
      city: 'New York'
    },
    {
      id: 'rural',
      name: 'Grand Canyon',
      location: { lat: 36.1069, lng: -112.1129 },
      type: 'natural_feature',
      country: 'United States',
      city: 'Arizona'
    },
    {
      id: 'montanhoso',
      name: 'Mount Everest Base Camp',
      location: { lat: 28.0026, lng: 86.8528 },
      type: 'natural_feature',
      country: 'Nepal',
      city: 'Khumbu'
    }
  ];
  
  for (const poi of pois) {
    try {
      const triggerPoints = await predictor.predictTriggerPoints(poi);
      
      console.log(`\nPOI: ${poi.name}`);
      console.log(`Localização: ${poi.location.lat}, ${poi.location.lng}`);
      console.log(`Trigger points gerados: ${triggerPoints.length}`);
      
      // Análise de qualidade
      const qualidadeMedia = triggerPoints.reduce((sum, tp) => sum + tp.quality, 0) / triggerPoints.length;
      const confiancaMedia = triggerPoints.reduce((sum, tp) => sum + tp.confidence, 0) / triggerPoints.length;
      
      console.log(`Qualidade média: ${qualidadeMedia.toFixed(2)}`);
      console.log(`Confiança média: ${confiancaMedia.toFixed(2)}`);
      
      // Distribuição por tipo
      const tipos = triggerPoints.reduce((acc, tp) => {
        acc[tp.type] = (acc[tp.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log('Distribuição por tipo:', tipos);
      
    } catch (error) {
      console.error(`Erro ao processar ${poi.name}:`, error);
    }
  }
}

// Executar exemplos
async function executarExemplos() {
  console.log('=== Exemplo Básico ===');
  await exemploBasico();
  
  console.log('\n=== Exemplo em Lote ===');
  await exemploLote();
  
  console.log('\n=== Exemplo Customizado ===');
  await exemploCustomizado();
  
  console.log('\n=== Exemplo Análise de Contexto ===');
  await exemploAnaliseContexto();
}

// Exportar funções para uso em outros arquivos
export {
  exemploBasico,
  exemploLote,
  exemploCustomizado,
  exemploAnaliseContexto,
  executarExemplos
};

// Executar se chamado diretamente
if (require.main === module) {
  executarExemplos().catch(console.error);
}
