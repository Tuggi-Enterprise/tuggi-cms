/**
 * Check Duplicates API
 * 
 * Checks for duplicate POIs in the database
 * 
 * @route POST /api/osm-importer/check-duplicates
 */

import { NextRequest, NextResponse } from 'next/server'
import { OSMImporterService } from '@/lib/services/osm-importer-service'
import { EditableOSMPOI } from '@/types/osm-importer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pois }: { pois: EditableOSMPOI[] } = body

    if (!pois || !Array.isArray(pois) || pois.length === 0) {
      return NextResponse.json(
        { error: 'No POIs provided for duplicate check' },
        { status: 400 }
      )
    }

    const importerService = new OSMImporterService()
    const duplicates = await importerService.checkDuplicates(pois)

    return NextResponse.json({
      success: true,
      duplicates,
      summary: {
        total_checked: pois.length,
        duplicates_found: duplicates.length,
        duplicate_rate: (duplicates.length / pois.length) * 100
      }
    })
  } catch (error) {
    console.error('Error in check-duplicates API:', error)
    return NextResponse.json(
      { 
        error: 'Duplicate check failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
