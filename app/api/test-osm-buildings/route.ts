import { NextRequest, NextResponse } from 'next/server';

interface OSMElement {
  type: string;
  id: number;
  tags?: {
    [key: string]: string;
  };
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  nodes?: Array<{
    lat: number;
    lon: number;
  }>;
  geometry?: Array<{
    lat: number;
    lon: number;
  }>;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get('lat') || '-23.5466147';
    const lng = searchParams.get('lng') || '-46.6448513';
    const radius = searchParams.get('radius') || '500';

    console.log(`🔍 Testing OSM buildings query for lat=${lat}, lng=${lng}, radius=${radius}m`);

    // Query OSM Overpass API for buildings - ENHANCED for Sagrada Família
    const overpassQuery = `[out:json][timeout:30];
(
  way[building](around:${radius},${lat},${lng});
  relation[building](around:${radius},${lat},${lng});
  way[man_made=tower](around:${radius},${lat},${lng});
  way[building=tower](around:${radius},${lat},${lng});
  way["tower:type"](around:${radius},${lat},${lng});
  way[building=spire](around:${radius},${lat},${lng});
  way[building=church](around:${radius},${lat},${lng});
  relation[building=church](around:${radius},${lat},${lng});
);
out geom;`;

    console.log(`📝 Overpass Query:`, overpassQuery);

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (building-structure-test)',
        'Content-Type': 'text/plain'
      }
    });

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Received ${data.elements?.length || 0} elements from OSM`);

    // Analyze structure of first few buildings
    const analysis = {
      totalElements: data.elements?.length || 0,
      elementTypes: {} as { [key: string]: number },
      sampleStructures: [],
      heightAnalysis: {
        withHeight: 0,
        withLevels: 0,
        withMinHeight: 0,
        withMaxHeight: 0,
        tallStructures: [],
        heightSources: {}
      },
      coordinateExtraction: {
        hasLatLon: 0,
        hasCenter: 0,
        hasNodes: 0,
        hasGeometry: 0
      }
    };

    // Analyze each element
    data.elements?.forEach((element: OSMElement, index: number) => {
      // Count element types
      analysis.elementTypes[element.type] = (analysis.elementTypes[element.type] || 0) + 1;

      // Sample first 5 elements + HEIGHT ANALYSIS
      if (index < 5) {
        const tags = element.tags || {};
        const heightData = {
          height: tags.height,
          building_height: tags['building:height'],
          levels: tags['building:levels'],
          man_made: tags.man_made,
          tower_type: tags['tower:type'],
          building_type: tags.building,
          name: tags.name,
          // Extract numeric height
          extractedHeight: (() => {
            const heightStr = tags.height || tags['building:height'];
            if (!heightStr) return null;
            const match = heightStr.toString().match(/(\d+\.?\d*)/);
            return match ? parseFloat(match[1]) : null;
          })()
        };

        analysis.sampleStructures.push({
          index: index + 1,
          type: element.type,
          id: element.id,
          tags: element.tags,
          heightData,
          hasLat: !!element.lat,
          hasLon: !!element.lon,
          hasCenter: !!element.center,
          hasNodes: !!element.nodes,
          nodesCount: element.nodes?.length || 0,
          hasGeometry: !!element.geometry,
          geometryCount: element.geometry?.length || 0,
          // Show actual values for debugging
          lat: element.lat,
          lon: element.lon,
          center: element.center,
          firstNode: element.nodes?.[0],
          firstGeometry: element.geometry?.[0]
        });
      }

      // Count coordinate extraction methods
      if (element.lat && element.lon) analysis.coordinateExtraction.hasLatLon++;
      if (element.center) analysis.coordinateExtraction.hasCenter++;
      if (element.nodes && element.nodes.length > 0) analysis.coordinateExtraction.hasNodes++;
      if (element.geometry && element.geometry.length > 0) analysis.coordinateExtraction.hasGeometry++;
    });

    // Test coordinate extraction for first few buildings
    const coordinateTests = [];
    data.elements?.slice(0, 3).forEach((element: OSMElement, index: number) => {
      const test = {
        buildingIndex: index + 1,
        type: element.type,
        extractionMethods: {
          directLatLon: element.lat && element.lon ? { lat: element.lat, lon: element.lon } : null,
          center: element.center ? { lat: element.center.lat, lon: element.center.lon } : null,
          firstNode: element.nodes?.[0] ? { lat: element.nodes[0].lat, lon: element.nodes[0].lon } : null,
          firstGeometry: element.geometry?.[0] ? { lat: element.geometry[0].lat, lon: element.geometry[0].lon } : null,
          calculatedCenter: element.geometry && element.geometry.length > 0 ? (() => {
            let sumLat = 0;
            let sumLon = 0;
            for (const geomPoint of element.geometry) {
              sumLat += geomPoint.lat;
              sumLon += geomPoint.lon;
            }
            return {
              lat: sumLat / element.geometry.length,
              lon: sumLon / element.geometry.length,
            };
          })() : null
        }
      };

      // Try to calculate center from nodes if available
      if (element.nodes && element.nodes.length > 0) {
        let sumLat = 0, sumLon = 0;
        element.nodes.forEach(node => {
          sumLat += node.lat;
          sumLon += node.lon;
        });
        test.extractionMethods.calculatedCenter = {
          lat: sumLat / element.nodes.length,
          lon: sumLon / element.nodes.length
        };
      }

      coordinateTests.push(test);
    });

    // ANALYZE HEIGHT DATA for all elements
    const heightAnalysis = {
      totalWithHeight: 0,
      tallStructures: [],
      heightDistribution: {
        '0-10m': 0,
        '10-30m': 0,
        '30-50m': 0,
        '50-100m': 0,
        '100m+': 0,
        'no_height': 0
      }
    };

    data.elements?.forEach((element: OSMElement) => {
      const tags = element.tags || {};
      const heightStr = tags.height || tags['building:height'];
      let height = null;
      
      if (heightStr) {
        const match = heightStr.toString().match(/(\d+\.?\d*)/);
        height = match ? parseFloat(match[1]) : null;
      }

      if (height) {
        heightAnalysis.totalWithHeight++;
        
        // Categorize height
        if (height <= 10) heightAnalysis.heightDistribution['0-10m']++;
        else if (height <= 30) heightAnalysis.heightDistribution['10-30m']++;
        else if (height <= 50) heightAnalysis.heightDistribution['30-50m']++;
        else if (height <= 100) heightAnalysis.heightDistribution['50-100m']++;
        else heightAnalysis.heightDistribution['100m+']++;

        // Collect tall structures (>30m or special types)
        const isTallStructureType = tags.man_made === 'tower' ||
                                   tags.building === 'tower' ||
                                   tags['tower:type'] ||
                                   tags.building === 'spire';
        
        if (height > 30 || isTallStructureType) {
          heightAnalysis.tallStructures.push({
            id: element.id,
            type: element.type,
            height,
            name: tags.name || `${tags.building || tags.man_made || 'structure'}`,
            building_type: tags.building,
            man_made: tags.man_made,
            tower_type: tags['tower:type'],
            raw_height: heightStr
          });
        }
      } else {
        heightAnalysis.heightDistribution.no_height++;
      }
    });

    // Sort tall structures by height
    heightAnalysis.tallStructures.sort((a, b) => b.height - a.height);

    return NextResponse.json({
      success: true,
      query: {
        lat,
        lng,
        radius,
        overpassQuery
      },
      analysis,
      heightAnalysis,
      coordinateTests,
      rawData: {
        totalElements: data.elements?.length || 0,
        firstElement: data.elements?.[0] || null,
        sampleElements: data.elements?.slice(0, 3) || []
      }
    });

  } catch (error) {
    console.error('❌ OSM Buildings Test Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
