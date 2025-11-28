/**
 * Load OSM File API
 * 
 * Loads and parses GeoJSON files with streaming support
 * 
 * @route GET /api/osm-importer/load-file
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const filename = searchParams.get('filename')
    const fileType = searchParams.get('type') || 'geojson'

    if (!filename) {
      return NextResponse.json(
        { error: 'Filename is required' },
        { status: 400 }
      )
    }

    // Validate file type
    if (!['geojson', 'pbf'].includes(fileType)) {
      return NextResponse.json(
        { error: 'Invalid file type. Must be geojson or pbf' },
        { status: 400 }
      )
    }

    // Validate filename extension
    const expectedExtension = fileType === 'geojson' ? '.geojson' : '.pbf'
    if (!filename.endsWith(expectedExtension)) {
      return NextResponse.json(
        { error: `Invalid filename. Must end with ${expectedExtension}` },
        { status: 400 }
      )
    }

    const filePath = path.join(process.cwd(), 'output', filename)

    // Security check: ensure file is within output directory
    const outputDir = path.join(process.cwd(), 'output')
    const resolvedPath = path.resolve(filePath)
    const resolvedOutputDir = path.resolve(outputDir)
    
    if (!resolvedPath.startsWith(resolvedOutputDir)) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      )
    }

    try {
      const fileContent = await fs.readFile(filePath, 'utf-8')
      const fileStats = await fs.stat(filePath)

      if (fileType === 'geojson') {
        // Parse GeoJSON to validate
        const geojson = JSON.parse(fileContent)
        
        if (geojson.type !== 'FeatureCollection') {
          return NextResponse.json(
            { error: 'Invalid GeoJSON: must be FeatureCollection' },
            { status: 400 }
          )
        }

        return NextResponse.json({
          content: geojson,
          metadata: {
            filename,
            type: 'geojson',
            size: fileStats.size,
            modified: fileStats.mtime,
            feature_count: geojson.features?.length || 0
          }
        })
      } else {
        // For PBF files, return metadata only (binary files can't be sent as JSON)
        return NextResponse.json({
          metadata: {
            filename,
            type: 'pbf',
            size: fileStats.size,
            modified: fileStats.mtime,
            note: 'PBF files require server-side processing'
          }
        })
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        return NextResponse.json(
          { error: 'File not found' },
          { status: 404 }
        )
      }
      
      console.error('Error loading file:', error)
      return NextResponse.json(
        { error: 'Failed to load file' },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Error in load-file API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
