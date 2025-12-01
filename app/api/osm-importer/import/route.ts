/**
 * Import OSM Data API
 * 
 * Handles batch import of OSM POIs with duplicate detection
 * 
 * @route POST /api/osm-importer/import
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { OSMImporterService } from '@/lib/services/osm-importer-service'
import { EditableOSMPOI } from '@/types/osm-importer'

export async function POST(request: NextRequest) {
  console.log('🚀 [API] Import request received')
  
  try {
    // Require admin for import
    const supabaseAuth = createRouteHandlerClient({ cookies })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized - Authentication required' }, { status: 401 })
    }
    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()
    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 403 })
    }
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
