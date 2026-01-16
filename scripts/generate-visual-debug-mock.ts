import fs from 'fs';

async function generateVisualDebugMock() {
  console.log('📦 Using Mock Trigger Points (last successful run)...');
  
  // Mocks baseados no seu último log de 9 pontos
  const triggerPoints = [
    { location: { lat: -23.5463, lng: -46.6455 }, streetName: "Avenida Ipiranga", confidence: 1.0, distanceToBoundary: 41, quality: 1.0 },
    { location: { lat: -23.5461, lng: -46.6452 }, streetName: "Avenida Ipiranga", confidence: 0.9, distanceToBoundary: 85, quality: 0.9 },
    { location: { lat: -23.5472, lng: -46.6451 }, streetName: "Avenida São Luís", confidence: 0.9, distanceToBoundary: 83, quality: 0.9 },
    // Adicionando pontos suspeitos na Consolação baseados no seu print
    { location: { lat: -23.5479, lng: -46.6465 }, streetName: "Rua da Consolação (Suspeito)", confidence: 0.8, distanceToBoundary: 120, quality: 0.8 },
    { location: { lat: -23.5482, lng: -46.6472 }, streetName: "Rua da Consolação (Suspeito)", confidence: 0.8, distanceToBoundary: 150, quality: 0.8 }
  ];

  // Carregar dados OSM do debug anterior
  const osmData = JSON.parse(fs.readFileSync('./osm_debug_copan.json', 'utf8'));
  
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Tuggi Debug Visualizer - OSM + TPs</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        #map { height: 95vh; width: 100%; }
        body { margin: 0; font-family: sans-serif; }
        .info { position: absolute; top: 10px; right: 10px; z-index: 1000; background: white; padding: 15px; border-radius: 8px; border: 2px solid #333; max-width: 300px; }
    </style>
</head>
<body>
    <div class="info">
        <h3>🔍 Debug Visibilidade</h3>
        <p><b>Vermelho:</b> Copan</p>
        <p><b>Cinza:</b> Prédios (Obstáculos OSM)</p>
        <p><b>Azul:</b> Trigger Points</p>
        <hr>
        <p><small>Aproxime o zoom na Consolação para ver se existem polígonos cinzas bloqueando o caminho para o centro do Copan.</small></p>
    </div>
    <div id="map"></div>

    <script>
        const map = L.map('map').setView([-23.5466, -46.6455], 17);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

        const osmData = ${JSON.stringify(osmData)};
        const tps = ${JSON.stringify(triggerPoints)};

        const nodeMap = new Map();
        osmData.elements.filter(e => e.type === 'node').forEach(n => {
            nodeMap.set(n.id, [n.lat, n.lon]);
        });

        // Desenhar Prédios
        osmData.elements.filter(e => e.tags && e.tags.building).forEach(b => {
            if (b.type === 'way' && b.nodes) {
                const coords = b.nodes.map(id => nodeMap.get(id)).filter(c => c);
                if (coords.length > 0) {
                    const isCopan = b.tags.name && b.tags.name.includes('Copan');
                    L.polygon(coords, { 
                        color: isCopan ? 'red' : '#555', 
                        fillColor: isCopan ? 'red' : '#999',
                        fillOpacity: 0.5, 
                        weight: 2 
                    }).addTo(map).bindPopup("<b>" + (b.tags.name || "Building") + "</b><br>Type: " + b.tags.building);
                }
            }
        });

        // Trigger Points
        tps.forEach(tp => {
            L.circleMarker([tp.location.lat, tp.location.lng], {
                radius: 10, color: 'blue', fillOpacity: 0.8
            }).addTo(map).bindPopup(tp.streetName);

            // Linha de visão
            L.polyline([[tp.location.lat, tp.location.lng], [-23.5466, -46.6448]], {
                color: 'blue', weight: 1, opacity: 0.4, dashArray: '5, 10'
            }).addTo(map);
        });
    </script>
</body>
</html>
  `;

  fs.writeFileSync('./debug_map_viewer.html', htmlContent);
  console.log('✅ Visual Debug HTML generated: debug_map_viewer.html');
}

generateVisualDebugMock();
