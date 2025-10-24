/**
 * API Route: Delete Selected Features
 * 
 * Deletes selected features from the local SQLite database
 */

import { NextRequest, NextResponse } from 'next/server'
import { LocalSQLiteDB } from '@/lib/services/local-sqlite-db'

export async function POST(request: NextRequest) {
  try {
    console.log('🗑️ [API] Deleting selected features...')
    
    const body = await request.json()
    const { featureIds } = body
    
    if (!featureIds || !Array.isArray(featureIds) || featureIds.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No feature IDs provided'
      }, { status: 400 })
    }
    
    console.log('📋 [API] Feature IDs to delete:', { count: featureIds.length })
    
    const db = new LocalSQLiteDB()
    await db.initialize()
    
    const result = await db.deleteSelectedFeatures(featureIds)
    await db.close()
    
    console.log('✅ [API] Selected features deleted successfully:', result)
    
    return NextResponse.json({
      success: result.errors.length === 0,
      deleted: result.deleted,
      errors: result.errors,
      message: result.errors.length === 0 
        ? `${result.deleted} features deleted successfully`
        : `Deleted ${result.deleted} features with ${result.errors.length} errors`
    })
  } catch (error) {
    console.error('❌ [API] Error deleting selected features:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
