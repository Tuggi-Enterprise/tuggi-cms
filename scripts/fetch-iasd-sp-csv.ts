
import fetch from 'node-fetch';
import fs from 'fs';

async function fetchAdventistsSPtoCSV() {
  const query = `
    [out:json][timeout:300];
    area["ISO3166-2"="BR-SP"]->.a;
    (
      node["amenity"="place_of_worship"]["denomination"="seventh_day_adventist"](area.a);
      way["amenity"="place_of_worship"]["denomination"="seventh_day_adventist"](area.a);
      relation["amenity"="place_of_worship"]["denomination"="seventh_day_adventist"](area.a);
      node["amenity"="place_of_worship"]["name"~"Adventista do Sétimo Dia"](area.a);
      way["amenity"="place_of_worship"]["name"~"Adventista do Sétimo Dia"](area.a);
      relation["amenity"="place_of_worship"]["name"~"Adventista do Sétimo Dia"](area.a);
    );
    out center;
  `;

  console.log('🔄 Consultando a Overpass API (OSM) para o Estado de São Paulo (IASD)...');
  
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    
    if (!response.ok) {
        throw new Error(`Erro na API Overpass: ${response.statusText}`);
    }

    const data = await response.json();
    const elements = data.elements || [];
    const count = elements.length;
    
    console.log(`✅ Sucesso! Encontradas ${count} Igrejas Adventistas do Sétimo Dia em SP.`);
    
    if (count > 0) {
      const csvHeader = 'osm_id,osm_type,name,city,street,lat,lon\n';
      const csvRows = elements.map(e => {
        const tags = e.tags || {};
        const osm_id = e.id;
        const osm_type = e.type;
        const name = tags.name || 'Sem nome';
        const city = tags['addr:city'] || '?';
        const street = tags['addr:street'] || '?';
        const lat = e.lat || e.center?.lat;
        const lon = e.lon || e.center?.lon;
        
        // Escape commas for CSV
        const escapeCSV = (str) => `"${String(str).replace(/"/g, '""')}"`;
        
        return `${osm_id},${osm_type},${escapeCSV(name)},${escapeCSV(city)},${escapeCSV(street)},${lat},${lon}`;
      }).join('\n');
      
      const csvContent = csvHeader + csvRows;
      const csvPath = '/Users/leandroramos/Documents/work/Tuggi/tuggi-cms/scripts/iasd-sp-report.csv';
      fs.writeFileSync(csvPath, csvContent);
      console.log(`\n✅ Relatório CSV salvo em: scripts/iasd-sp-report.csv`);
      
      // Amostra console
      console.log('\n--- Primeiras 3 igrejas do CSV:');
      console.table(elements.slice(0, 3).map(e => ({
        name: e.tags.name,
        city: e.tags['addr:city']
      })));
    }
  } catch (error) {
    console.error('❌ Erro ao rodar a busca:', error.message);
  }
}

fetchAdventistsSPtoCSV();
