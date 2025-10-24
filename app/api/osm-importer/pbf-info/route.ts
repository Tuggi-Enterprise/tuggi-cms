/**
 * Get PBF File Info API
 * 
 * Gets information about PBF files using osmium-tool
 * 
 * @route POST /api/osm-importer/pbf-info
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
  console.log('📊 [API] PBF info request received')
  
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

    // Generate unique filename
    const timestamp = Date.now()
    const pbfFilename = `${timestamp}_info.pbf`
    const pbfPath = join(TEMP_DIR, pbfFilename)

    // Save PBF file
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(pbfPath, buffer)

    console.log('📄 [API] PBF file saved for info:', { size: buffer.length })

    // Get file info using osmium-tool
    console.log('📊 [API] Getting PBF file info...')
    
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

    // Get file info using osmium fileinfo
    const infoCommand = `osmium fileinfo "${pbfPath}"`
    console.log('🔄 [API] Running command:', infoCommand)
    
    const { stdout, stderr } = await execAsync(infoCommand)
    
    if (stderr) {
      console.warn('⚠️ [API] osmium stderr:', stderr)
    }
    
    console.log('✅ [API] File info retrieved:', stdout)

    // Parse osmium output to extract information
    const info = parseOsmiumOutput(stdout, file.size)

    // Clean up temp file
    try {
      await unlink(pbfPath)
    } catch (cleanupError) {
      console.warn('⚠️ [API] Failed to clean up temp file:', cleanupError)
    }

    console.log('✅ [API] PBF info successful:', info)

    return NextResponse.json({
      success: true,
      info
    })

  } catch (error) {
    console.error('❌ [API] PBF info failed:', error)
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get PBF info' 
      },
      { status: 500 }
    )
  }
}

/**
 * Parse osmium fileinfo output
 */
function parseOsmiumOutput(output: string, fileSize: number) {
  const lines = output.split('\n')
  let nodes = 0
  let ways = 0
  let relations = 0
  let bounds: any = null

  for (const line of lines) {
    if (line.includes('Number of nodes:')) {
      nodes = parseInt(line.split(':')[1].trim().replace(/,/g, '')) || 0
    } else if (line.includes('Number of ways:')) {
      ways = parseInt(line.split(':')[1].trim().replace(/,/g, '')) || 0
    } else if (line.includes('Number of relations:')) {
      relations = parseInt(line.split(':')[1].trim().replace(/,/g, '')) || 0
    } else if (line.includes('Bounding box:')) {
      // Parse bounding box: (west, south, east, north)
      const bboxMatch = line.match(/\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/)
      if (bboxMatch) {
        bounds = {
          west: parseFloat(bboxMatch[1]),
          south: parseFloat(bboxMatch[2]),
          east: parseFloat(bboxMatch[3]),
          north: parseFloat(bboxMatch[4])
        }
      }
    }
  }

  const featureCount = nodes + ways + relations

  return {
    size: fileSize,
    featureCount,
    bounds,
    objectCounts: {
      nodes,
      ways,
      relations
    }
  }
}
