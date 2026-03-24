import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { Papa } from "https://deno.land/x/papaparse@v5.4.1/mod.ts";

async function main() {
  console.log("Fetching data from https://api.adventistas.pt/igrejas...");
  
  try {
    const response = await fetch("https://api.adventistas.pt/igrejas");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`Found ${data.length} locations.\n`);

    const records = data.map((item: any) => {
      // Create a nice name
      const name = item.name.toLowerCase().includes("adventista") 
        ? item.name 
        : `Igreja Adventista do Sétimo Dia - ${item.name}`;

      // Create a full address
      let fullAddress = item.address || "";
      if (item.zipcode) {
        fullAddress += `, ${item.zipcode}`;
      }
      if (item.city) {
        fullAddress += ` ${item.city}`;
      }
      
      return {
        name: name,
        lat: item.lat,
        lng: item.lng,
        category: "amenity=place_of_worship",
        religion: "christian",
        denomination: "seventh_day_adventist",
        address: fullAddress.trim(),
        city: item.city || "",
        country: item.country || "Portugal",
        website: item.website || "",
        description: `Igreja Adventista do Sétimo Dia em ${item.city || item.name}. ${item.schedule ? 'Horários: ' + item.schedule : ''}`.trim()
      };
    });

    // Generate CSV using PapaParse
    const csvSettings = {
      quotes: true, 
      quoteChar: '"',
      escapeChar: '"',
      delimiter: ",",
      header: true,
      newline: "\r\n"
    };
    
    // We can also just manually build it if Papa is not available, but let's try manual first to avoid dependency issues if any
    const headers = Object.keys(records[0]);
    let csvContent = headers.join(",") + "\n";
    
    for (const record of records) {
      const row = headers.map(header => {
        let value = String((record as any)[header] || "");
        // Escape quotes
        value = value.replace(/"/g, '""');
        // Wrap in quotes if it contains comma, newline or quotes
        if (value.includes(",") || value.includes("\\n") || value.includes("\\r") || value.includes('"')) {
          value = `"${value}"`;
        }
        return value;
      });
      csvContent += row.join(",") + "\n";
    }

    const outputPath = join(Deno.cwd(), "data", "adventistas_pt_pois.csv");
    await Deno.writeTextFile(outputPath, csvContent);

    console.log(`✅ Success! Data exported to ${outputPath}`);
    
  } catch (error) {
    console.error("❌ Failed to fetch or process churches:", error);
  }
}

if (import.meta.main) {
  await main();
}
