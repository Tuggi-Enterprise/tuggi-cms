import fs from 'fs';
import path from 'path';

async function main() {
  console.log("Fetching data from https://api.adventistas.pt/igrejas...");
  
  try {
    const response = await fetch("https://api.adventistas.pt/igrejas");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`Found ${data.length} locations.\n`);

    const records = data.map((item) => {
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

    const headers = Object.keys(records[0]);
    let csvContent = headers.join(",") + "\n";
    
    for (const record of records) {
      const row = headers.map(header => {
        let value = String(record[header] || "");
        value = value.replace(/"/g, '""');
        if (value.includes(",") || value.includes("\n") || value.includes("\r") || value.includes('"')) {
          value = `"${value}"`;
        }
        return value;
      });
      csvContent += row.join(",") + "\n";
    }

    const outputDir = path.join(process.cwd(), "data");
    const outputPath = path.join(outputDir, "adventistas_pt_pois.csv");
    if(!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    fs.writeFileSync(outputPath, csvContent);

    console.log(`✅ Success! Data exported to ${outputPath}`);
    
  } catch (error) {
    console.error("❌ Failed to fetch or process churches:", error);
  }
}

main();
