#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write

/**
 * Audit Overpass API - Fetch EVERYTHING to see what our filters are removing.
 * 
 * Usage: deno run --allow-net scripts/audit-overpass.ts [lat] [lon] [radius]
 */

const LAT = -22.9519; 
const LON = -46.5419;
const RADIUS = 1000; // Smaller radius to avoid crashing with too much data

async function fetchEverythingFromOverpass(lat: number, lon: number, radius: number) {
    console.log(`🔍 AUDIT: Querying EVERYTHING around ${lat}, ${lon} (radius: ${radius}m)...`);
    
    const query = `
[out:json][timeout:90];
(
  nwr(around:${radius},${lat},${lon});
);
out body;
>;
out skel qt;
`;

    const mirrors = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.openstreetmap.fr/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter"
    ];

    for (const endpoint of mirrors) {
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Tuggi-Audit/1.0"
                },
                body: "data=" + encodeURIComponent(query)
            });
            if (response.ok) return await response.json();
        } catch (e) {}
    }
    throw new Error("All mirrors failed.");
}

async function main() {
    const lat = parseFloat(Deno.args[0]) || LAT;
    const lon = parseFloat(Deno.args[1]) || LON;
    const radius = parseFloat(Deno.args[2]) || RADIUS;

    try {
        const data = await fetchEverythingFromOverpass(lat, lon, radius);
        const elements = data.elements || [];
        
        // Group by category to see what's in there
        const categories: Record<string, any[]> = {};
        
        elements.forEach((el: any) => {
            if (!el.tags || !el.tags.name) return;
            
            const mainTag = el.tags.tourism || el.tags.historic || el.tags.amenity || el.tags.leisure || el.tags.shop || 'other';
            if (!categories[mainTag]) categories[mainTag] = [];
            categories[mainTag].push({
                name: el.tags.name,
                tags: el.tags
            });
        });

        console.log(`\n📊 AUDIT SUMMARY (Total with names: ${Object.values(categories).flat().length})`);
        
        for (const cat of Object.keys(categories).sort()) {
            console.log(`\n📁 [${cat}] - ${categories[cat].length} items:`);
            categories[cat].slice(0, 15).forEach(item => {
                console.log(`  - ${item.name}`);
            });
            if (categories[cat].length > 15) console.log(`  ... and ${categories[cat].length - 15} more.`);
        }

    } catch (error) {
        console.error("❌ Error:", (error as Error).message);
    }
}

main();
