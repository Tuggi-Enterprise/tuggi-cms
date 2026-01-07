/**
 * Local Database Save API
 * 
 * Save POIs to local SQLite database
 * 
 * @module app/api/local-db/save/route
 */

import { NextRequest, NextResponse } from 'next/server'
import { LocalSQLiteDB } from '@/lib/services/local-sqlite-db'
import { SimpleOSMPOI } from '@/lib/types/osm-types'

export async function POST(request: NextRequest) {
  let localDB: LocalSQLiteDB | null = null
  
  try {
    console.log('💾 [API] Saving POIs to local database')
    
    const body = await request.json()
    const { pois, sourceFile } = body

    if (!pois || !Array.isArray(pois)) {
      return NextResponse.json(
        { error: 'Invalid POIs data' },
        { status: 400 }
      )
    }

    console.log('📤 [API] Processing POIs:', { count: pois.length, sourceFile })
    
    localDB = new LocalSQLiteDB()
    await localDB.initialize()
    
    let saved = 0
    const errors: string[] = []

    for (const poi of pois) {
      try {
        await localDB.savePOI(poi, sourceFile || 'unknown.geojson')
        saved++
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        errors.push(`POI ${poi._id}: ${errorMsg}`)
        console.error('❌ [API] Error saving POI:', poi._id, errorMsg)
      }
    }

    const results = {
      success: errors.length === 0,
      imported: saved,
      errors
    }
    
    console.log('✅ [API] Local database save completed:', results)
    
    return NextResponse.json({
      success: true,
      results
    })
  } catch (error) {
    console.error('❌ [API] Error saving to local database:', error)
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    if (localDB) {
      localDB.close()
    }
  }
}
