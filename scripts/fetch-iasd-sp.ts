
import fetch from 'node-fetch';

async function fetchAdventistsSP() {
  const query = `
    [out:json][timeout:180];
    area["name"="São Paulo"]["admin_level"="4"]->.sp;
    (
      node["amenity"="place_of_worship"]["denomination"="seventh_day_adventist"](area.sp);
      way["amenity"="place_of_worship"]["denomination"="seventh_day_adventist"](area.sp);
      relation["amenity"="place_of_worship"]["denomination"="seventh_day_adventist"](area.sp);
      node["amenity"="place_of_worship"]["name"~"Adventista do Sétimo Dia"](area.sp);
      way["amenity"="place_of_worship"]["name"~"Adventista do Sétimo Dia"](area.sp);
      relation["amenity"="place_of_worship"]["name"~"Adventista do Sétimo Dia"](area.sp);
    );
    out center;
  `;

  console.log('🔄 Consultando a Overpass API (OSM) para o Estado de São Paulo...');
  
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    
    if (!response.ok) {
        throw new Error(`Erro na API Overpass: ${response.statusText}`);
    }

    const data = await response.json();
    const count = data.elements?.length || 0;
    
    console.log(`✅ Sucesso! Encontradas ${count} Igrejas Adventistas do Sétimo Dia em SP.`);
    
    if (count > 0) {
      console.log('\n--- Amostra das primeiras 10 igrejas encontradas:');
      const sample = data.elements.slice(0, 10).map(e => ({
        name: e.tags.name || 'Sem nome',
        city: e.tags['addr:city'] || '?',
        lat: e.lat || e.center?.lat,
        lon: e.lon || e.center?.lon
      }));
      console.table(sample);
      
      // Salvar resultado em JSON para uso posterior
      const fs = await import('fs');
      fs.writeFileSync('/Users/leandroramos/Documents/work/Tuggi/tuggi-cms/scripts/iasd-sp-results.json', JSON.stringify(data.elements, null, 2));
      console.log('\n✅ Lista completa salva em: scripts/iasd-sp-results.json');
    }
  } catch (error) {
    console.error('❌ Erro ao rodar a busca:', error.message);
  }
}

fetchAdventistsSP();
