/**
 * List OSM Files API
 * 
 * Lists available GeoJSON and PBF files from the output directory
 * 
 * @route GET /api/osm-importer/list-files
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

export async function GET(request: NextRequest) {
  try {
    const outputDir = path.join(process.cwd(), 'output')
    
    // Check if output directory exists
    try {
      await fs.access(outputDir)
    } catch {
      return NextResponse.json({ files: [] })
    }

    const files = await fs.readdir(outputDir)
    
    const geojsonFiles = files
      .filter(f => f.endsWith('.geojson'))
      .map(async (filename) => {
        const filePath = path.join(outputDir, filename)
        const stats = await fs.stat(filePath)
        
        return {
          filename,
          path: filePath,
          size: stats.size,
          modified: stats.mtime,
          type: 'geojson' as const
        }
      })

    const pbfFiles = files
      .filter(f => f.endsWith('.pbf'))
      .map(async (filename) => {
        const filePath = path.join(outputDir, filename)
        const stats = await fs.stat(filePath)
        
        return {
          filename,
          path: filePath,
          size: stats.size,
          modified: stats.mtime,
          type: 'pbf' as const
        }
      })

    const allFiles = await Promise.all([...geojsonFiles, ...pbfFiles])
    
    // Sort by modification date (newest first)
    allFiles.sort((a, b) => b.modified.getTime() - a.modified.getTime())

    return NextResponse.json({ 
      files: allFiles,
      total: allFiles.length,
      geojson_count: allFiles.filter(f => f.type === 'geojson').length,
      pbf_count: allFiles.filter(f => f.type === 'pbf').length
    })
  } catch (error) {
    console.error('Error listing files:', error)
    return NextResponse.json(
      { error: 'Failed to list files' },
      { status: 500 }
    )
  }
}
