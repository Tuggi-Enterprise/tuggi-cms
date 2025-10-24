/**
 * Convert PBF to GeoJSON API
 * 
 * Converts PBF files to GeoJSON using osmium-tool
 * 
 * @route POST /api/osm-importer/convert-pbf
 */

import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const TEMP_DIR = join(process.cwd(), 'output', 'temp')

export async function POST(request: NextRequest) {
  console.log('🔄 [API] PBF conversion request received')
  
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.pbf')) {
      return NextResponse.json(
        { error: 'Invalid file type. Only .pbf files are allowed.' },
        { status: 400 }
      )
    }

    // Create temp directory if it doesn't exist
    if (!existsSync(TEMP_DIR)) {
      await mkdir(TEMP_DIR, { recursive: true })
    }

    // Generate unique filenames
    const timestamp = Date.now()
    const pbfFilename = `${timestamp}_input.pbf`
    const geojsonFilename = `${timestamp}_output.geojson`
    const pbfPath = join(TEMP_DIR, pbfFilename)
    const geojsonPath = join(TEMP_DIR, geojsonFilename)

    // Save PBF file
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(pbfPath, buffer)

    console.log('📄 [API] PBF file saved:', { size: buffer.length })

    // Convert PBF to GeoJSON using osmium-tool
    console.log('🔄 [API] Converting PBF to GeoJSON...')
    
    try {
      // Check if osmium-tool is available
      await execAsync('osmium --version')
    } catch (error) {
      console.error('❌ [API] osmium-tool not found:', error)
      return NextResponse.json(
        { error: 'osmium-tool is required but not installed. Please install it first.' },
        { status: 500 }
      )
    }

    // Convert using osmium export
    const convertCommand = `osmium export "${pbfPath}" -o "${geojsonPath}"`
    console.log('🔄 [API] Running command:', convertCommand)
    
    const { stdout, stderr } = await execAsync(convertCommand)
    
    if (stderr) {
      console.warn('⚠️ [API] osmium stderr:', stderr)
    }
    
    console.log('✅ [API] Conversion completed:', stdout)

    // Read the converted GeoJSON
    const geojsonContent = await import('fs/promises').then(fs => fs.readFile(geojsonPath, 'utf-8'))
    const geojson = JSON.parse(geojsonContent)

    // Clean up temp files
    try {
      await unlink(pbfPath)
      await unlink(geojsonPath)
    } catch (cleanupError) {
      console.warn('⚠️ [API] Failed to clean up temp files:', cleanupError)
    }

    console.log('✅ [API] PBF conversion successful:', {
      features: geojson.features?.length || 0,
      type: geojson.type
    })

    return NextResponse.json({
      success: true,
      geojson,
      metadata: {
        originalSize: file.size,
        convertedSize: geojsonContent.length,
        features: geojson.features?.length || 0
      }
    })

  } catch (error) {
    console.error('❌ [API] PBF conversion failed:', error)
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'PBF conversion failed' 
      },
      { status: 500 }
    )
  }
}
