/**
 * CSV Parser Service
 * 
 * Handles CSV file parsing and conversion to OSMFeature format:
 * - Parse CSV files (streaming for large files)
 * - Convert CSV rows to GeoJSON Feature format
 * - Extract coordinates from latitude/longitude columns
 * - Handle CSV fields as GeoJSON properties
 * 
 * @module lib/services/csv-parser-service
 */

import { OSMFeature } from '@/types/osm-importer'

export class CSVParserService {
  /**
   * Parse CSV line handling quoted fields and commas
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      const nextChar = line[i + 1]
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"'
          i++ // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator
        result.push(current)
        current = ''
      } else {
        current += char
      }
    }
    
    // Add last field
    result.push(current)
    
    return result
  }

  /**
   * Parse CSV incrementally (streaming for large files)
   */
  async *parseCSV(file: File): AsyncGenerator<OSMFeature[], void, unknown> {
    const text = await file.text()
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0)
    
    if (lines.length === 0) {
      throw new Error('Empty CSV file')
    }
    
    // Parse header
    const headerLine = lines[0]
    const headers = this.parseCSVLine(headerLine).map(h => h.trim())
    
    console.log('📋 [CSV] Headers found:', headers.length)
    
    // Find required columns
    const idIndex = headers.findIndex(h => h.toLowerCase() === 'id')
    const latIndex = headers.findIndex(h => h.toLowerCase() === 'latitude' || h.toLowerCase() === 'lat')
    const lngIndex = headers.findIndex(h => h.toLowerCase() === 'longitude' || h.toLowerCase() === 'lng' || h.toLowerCase() === 'lon')
    const typeIndex = headers.findIndex(h => h.toLowerCase() === 'type')
    
    if (latIndex === -1 || lngIndex === -1) {
      throw new Error('CSV file must contain latitude and longitude columns')
    }
    
    const features: OSMFeature[] = []
    const chunkSize = 100
    
    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      
      const values = this.parseCSVLine(line)
      
      // Ensure we have enough values
      if (values.length < headers.length) {
        // Pad with empty strings if needed
        while (values.length < headers.length) {
          values.push('')
        }
      }
      
      // Extract coordinates
      const latStr = values[latIndex]?.trim() || ''
      const lngStr = values[lngIndex]?.trim() || ''
      
      if (!latStr || !lngStr) {
        const nameStr = values[headers.findIndex(h => h.toLowerCase() === 'name')]?.trim() || 'Unknown'
        console.warn(`⚠️ [CSV] Row ${i + 1} missing coordinates, skipping: "${nameStr}"`)
        continue
      }
      
      const lat = parseFloat(latStr)
      const lng = parseFloat(lngStr)
      
      if (isNaN(lat) || isNaN(lng)) {
        const nameStr = values[headers.findIndex(h => h.toLowerCase() === 'name')]?.trim() || 'Unknown'
        console.warn(`⚠️ [CSV] Row ${i + 1} invalid coordinates (${latStr}, ${lngStr}), skipping: "${nameStr}"`)
        continue
      }
      
      // Extract ID
      const id = idIndex >= 0 && values[idIndex] ? values[idIndex].trim() : undefined
      
      // Extract type
      const geometryType = typeIndex >= 0 && values[typeIndex] 
        ? (values[typeIndex].trim() || 'Point')
        : 'Point'
      
      // Build properties from all other columns
      const properties: Record<string, any> = {}
      
      for (let j = 0; j < headers.length; j++) {
        // Skip special columns that are handled separately
        if (j === idIndex || j === latIndex || j === lngIndex || j === typeIndex) {
          continue
        }
        
        const header = headers[j].trim()
        const value = values[j]?.trim() || ''
        
        if (header && value !== '') {
          // Try to parse as number or boolean, otherwise keep as string
          if (value === 'true' || value === 'True') {
            properties[header] = true
          } else if (value === 'false' || value === 'False') {
            properties[header] = false
          } else {
            const numValue = parseFloat(value)
            if (!isNaN(numValue) && value !== '') {
              properties[header] = numValue
            } else {
              properties[header] = value
            }
          }
        }
      }
      
      // Create GeoJSON Feature
      const feature: OSMFeature = {
        type: 'Feature',
        ...(id ? { id } : {}),
        properties,
        geometry: {
          type: geometryType as 'Point' | 'LineString' | 'Polygon' | 'MultiPoint' | 'MultiLineString' | 'MultiPolygon',
          coordinates: [lng, lat] // GeoJSON format: [longitude, latitude]
        }
      }
      
      // Log specific POI names for debugging
      const poiName = properties.name || 'Unnamed'
      if (poiName.includes('Parque de Exposições') || poiName.includes('Doutor Fernando Costa') || poiName.includes('Posto de Monta') || poiName.includes('Lago') || poiName.includes('Orfeu')) {
        console.log(`📋 [CSV] Parsed feature ${i + 1}:`, {
          name: poiName,
          type: geometryType,
          lat,
          lng,
          city: properties.city || 'Unknown',
          state: properties.state || 'Unknown',
          propertiesKeys: Object.keys(properties).slice(0, 10),
          allProperties: properties
        })
      }
      
      features.push(feature)
      
      // Yield chunks
      if (features.length >= chunkSize) {
        yield features.splice(0, chunkSize)
      }
    }
    
    // Yield remaining features
    if (features.length > 0) {
      yield features
    }
  }

  /**
   * Parse CSV from text content
   */
  parseCSVFromText(content: string): OSMFeature[] {
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0)
    
    if (lines.length === 0) {
      throw new Error('Empty CSV content')
    }
    
    // Parse header
    const headerLine = lines[0]
    const headers = this.parseCSVLine(headerLine).map(h => h.trim())
    
    // Find required columns
    const idIndex = headers.findIndex(h => h.toLowerCase() === 'id')
    const latIndex = headers.findIndex(h => h.toLowerCase() === 'latitude' || h.toLowerCase() === 'lat')
    const lngIndex = headers.findIndex(h => h.toLowerCase() === 'longitude' || h.toLowerCase() === 'lng' || h.toLowerCase() === 'lon')
    const typeIndex = headers.findIndex(h => h.toLowerCase() === 'type')
    
    if (latIndex === -1 || lngIndex === -1) {
      throw new Error('CSV content must contain latitude and longitude columns')
    }
    
    const features: OSMFeature[] = []
    
    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      
      const values = this.parseCSVLine(line)
      
      // Ensure we have enough values
      if (values.length < headers.length) {
        while (values.length < headers.length) {
          values.push('')
        }
      }
      
      // Extract coordinates
      const latStr = values[latIndex]?.trim() || ''
      const lngStr = values[lngIndex]?.trim() || ''
      
      if (!latStr || !lngStr) {
        continue
      }
      
      const lat = parseFloat(latStr)
      const lng = parseFloat(lngStr)
      
      if (isNaN(lat) || isNaN(lng)) {
        continue
      }
      
      // Extract ID
      const id = idIndex >= 0 && values[idIndex] ? values[idIndex].trim() : undefined
      
      // Extract type
      const geometryType = typeIndex >= 0 && values[typeIndex] 
        ? (values[typeIndex].trim() || 'Point')
        : 'Point'
      
      // Build properties from all other columns
      const properties: Record<string, any> = {}
      
      for (let j = 0; j < headers.length; j++) {
        // Skip special columns
        if (j === idIndex || j === latIndex || j === lngIndex || j === typeIndex) {
          continue
        }
        
        const header = headers[j].trim()
        const value = values[j]?.trim() || ''
        
        if (header && value !== '') {
          // Try to parse as number or boolean, otherwise keep as string
          if (value === 'true' || value === 'True') {
            properties[header] = true
          } else if (value === 'false' || value === 'False') {
            properties[header] = false
          } else {
            const numValue = parseFloat(value)
            if (!isNaN(numValue) && value !== '') {
              properties[header] = numValue
            } else {
              properties[header] = value
            }
          }
        }
      }
      
      // Create GeoJSON Feature
      const feature: OSMFeature = {
        type: 'Feature',
        ...(id ? { id } : {}),
        properties,
        geometry: {
          type: geometryType as 'Point' | 'LineString' | 'Polygon' | 'MultiPoint' | 'MultiLineString' | 'MultiPolygon',
          coordinates: [lng, lat] // GeoJSON format: [longitude, latitude]
        }
      }
      
      features.push(feature)
    }
    
    return features
  }
}

