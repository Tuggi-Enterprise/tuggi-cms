const variations = ["Estádio Cícero Pompeu de Toledo (Morumbi)", "Estádio Cícero Pompeu de Toledo", "Cícero Pompeu de Toledo", "Estádio Cícero"];
const nameRegex = variations
  .map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const lat = -23.6000811;
const lng = -46.7201047;
const radius = 300;

const query = `
  [out:json][timeout:45];
  (
    relation["name"~"${nameRegex}",i](around:${radius},${lat},${lng});
    way["name"~"${nameRegex}",i](around:${radius},${lat},${lng});
  );
  out geom;
`;

console.log("Query:");
console.log(query);

async function testQuery() {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: `data=${encodeURIComponent(query)}`
    });
    console.log("Status:", response.status);
    const data = await response.json();
    console.log("Elements found:", data.elements?.length || 0);
    if (data.elements) {
        data.elements.forEach((e: any) => {
            console.log(`- [${e.type} ${e.id}] ${e.tags?.name}`);
        });
    }
}

testQuery();
