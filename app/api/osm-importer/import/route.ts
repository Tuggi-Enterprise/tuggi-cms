/**
 * Import OSM Data API
 * 
 * Handles batch import of OSM POIs with duplicate detection
 * 
 * @route POST /api/osm-importer/import
 */

import { NextRequest, NextResponse } from 'next/server'
import { OSMImporterService } from '@/lib/services/osm-importer-service'
import { EditableOSMPOI } from '@/types/osm-importer'

export async function POST(request: NextRequest) {
  console.log('🚀 [API] Import request received')
  
  try {
    const body = await request.json()
    console.log('📦 [API] Request body parsed:', { 
      hasPois: !!body.pois,
      poisCount: body.pois?.length,
      hasSourceFile: !!body.sourceFile,
      duplicateStrategy: body.duplicateStrategy,
      hasBatchId: !!body.batchId
    })
    
    const { 
      pois, 
      sourceFile, 
      duplicateStrategy = 'skip',
      batchId 
    }: {
      pois: EditableOSMPOI[]
      sourceFile: string
      duplicateStrategy?: 'skip' | 'replace' | 'merge'
      batchId?: string
    } = body

    if (!pois || !Array.isArray(pois) || pois.length === 0) {
      console.log('❌ [API] No POIs provided for import')
      return NextResponse.json(
        { error: 'No POIs provided for import' },
        { status: 400 }
      )
    }

    if (!sourceFile) {
      console.log('❌ [API] Source file is required')
      return NextResponse.json(
        { error: 'Source file is required' },
        { status: 400 }
      )
    }

    const importerService = new OSMImporterService()

    // Create batch if not provided
    let importBatchId = batchId
    if (!importBatchId) {
      importBatchId = await importerService.createImportBatch(sourceFile, 'geojson')
    }

    // Import POIs
    const results = await importerService.importPOIs(pois, importBatchId!, duplicateStrategy)

    return NextResponse.json({
      success: true,
      batch_id: importBatchId,
      results,
      summary: {
        total: pois.length,
        imported: results.imported.length,
        skipped: results.skipped.length,
        failed: results.failed.length,
        processing_time_ms: results.summary.processing_time_ms
      }
    })
  } catch (error) {
    console.error('Error in import API:', error)
    return NextResponse.json(
      { 
        error: 'Import failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
