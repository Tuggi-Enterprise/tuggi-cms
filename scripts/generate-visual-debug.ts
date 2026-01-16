import fs from 'fs';

async function generateVisualDebug() {
  const poiId = '9e705409-b74b-48e4-9c5a-cb831a70ffe7'; // Copan
  const accessToken = "eyJhbGciOiJIUzI1NiIsImtpZCI6IjQ0WFhKdEtOekZBWFpnWVAiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3R5c25rem1samxtbXFwYm90a3h2LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI3ZjZhMDUxNi00ODY3LTQ0YzctOTY0YS0yZmQ5OWZiZGJiMGYiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzY4OTI5NTkyLCJpYXQiOjE3NjgzMjQ3OTIsImVtYWlsIjoibGVhbmRyby5yYW1vc0B0dWdnaS5hcHAiLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsX3ZlcmlmaWVkIjp0cnVlfSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJwYXNzd29yZCIsInRpbWVzdGFtcCI6MTc1ODgwMDk1NX1dLCJzZXNzaW9uX2lkIjoiZGZiNzYwN2ItZjVhNS00MWQ0LWI1MWItYmE2NmYxZDg3YzI1IiwiaXNfYW5vbnltb3VzIjpmYWxzZX0.jvypj4wX55snGWQRZL9PrnrqaGCS9ZB2Ea_bxdJkCSU";
  
  console.log('🚀 Fetching current Trigger Points from Edge Function...');
  
  const efResponse = await fetch('https://tysnkzmljlmmqpbotkxv.supabase.co/functions/v1/generate-trigger-points', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({ poiId })
  });

  if (!efResponse.ok) {
    const errorText = await efResponse.text();
    console.error(`❌ Edge Function error (${efResponse.status}):`, errorText);
    return;
  }

  const efData = await efResponse.json();
  const triggerPoints = efData.triggerPoints || [];
  
  console.log(`✅ Received ${triggerPoints.length} Trigger Points.`);

  // Carregar dados OSM do debug anterior
  const osmData = JSON.parse(fs.readFileSync('./osm_debug_copan.json', 'utf8'));
  
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Tuggi Debug Map - Copan</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        #map { height: 90vh; width: 100%; background: #1a1a1a; }
        body { margin: 0; font-family: sans-serif; background: #121212; color: white; }
        .controls { padding: 10px; display: flex; gap: 20px; align-items: center; }
        .legend { background: rgba(0,0,0,0.8); padding: 10px; border-radius: 5px; }
        .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
        .dot { width: 12px; height: 12px; border-radius: 50%; }
    </style>
</head>
<body>
    <div class="controls">
        <h2>🔬 Tuggi Debug: Edifício Copan</h2>
        <div class="legend">
            <div class="legend-item"><div class="dot" style="background: red;"></div> POI Boundary</div>
            <div class="legend-item"><div class="dot" style="background: #555;"></div> Buildings (Obstructions)</div>
            <div class="legend-item"><div class="dot" style="background: #3498db;"></div> Trigger Points</div>
        </div>
        <div>Total TPs: ${triggerPoints.length}</div>
    </div>
    <div id="map"></div>

    <script>
        const map = L.map('map').setView([-23.5466, -46.6448], 17);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '©OpenStreetMap'
        }).addTo(map);

        const osmData = ${JSON.stringify(osmData)};
        const tps = ${JSON.stringify(triggerPoints)};

        // Helper para converter nodes em LatLng para Leaflet
        const nodeMap = new Map();
        osmData.elements.filter(e => e.type === 'node').forEach(n => {
            nodeMap.set(n.id, [n.lat, n.lon]);
        });

        // Desenhar Prédios
        osmData.elements.filter(e => e.tags && e.tags.building).forEach(b => {
            if (b.type === 'way' && b.nodes) {
                const coords = b.nodes.map(id => nodeMap.get(id)).filter(c => c);
                if (coords.length > 0) {
                    const color = b.tags.name && b.tags.name.includes('Copan') ? 'red' : '#555';
                    const weight = color === 'red' ? 3 : 1;
                    L.polygon(coords, { color, fillOpacity: 0.3, weight }).addTo(map)
                        .bindPopup("<b>" + (b.tags.name || "Building") + "</b><br>Height: " + (b.tags.height || b.tags['building:levels'] || "Unknown"));
                }
            }
        });

        // Desenhar Trigger Points
        tps.forEach(tp => {
            const marker = L.circleMarker([tp.location.lat, tp.location.lng], {
                radius: 8,
                color: '#3498db',
                fillColor: '#3498db',
                fillOpacity: 0.8
            }).addTo(map);
            
            marker.bindPopup(\`
                <b>TP: \${tp.streetName}</b><br>
                Confidence: \${tp.confidence.toFixed(2)}<br>
                Dist to POI: \${tp.distanceToBoundary.toFixed(1)}m<br>
                Quality: \${tp.quality.toFixed(2)}
            \`);

            // Desenhar linha para o POI (Visão teórica)
            L.polyline([
                [tp.location.lat, tp.location.lng],
                [-23.5466, -46.6448]
            ], { color: 'rgba(52, 152, 219, 0.2)', dashArray: '5, 10' }).addTo(map);
        });
    </script>
</body>
</html>
  `;

  fs.writeFileSync('./debug_map_viewer.html', htmlContent);
  console.log('✅ Visual Debug HTML generated: debug_map_viewer.html');
}

generateVisualDebug();
