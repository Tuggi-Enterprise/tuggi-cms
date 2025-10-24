/**
 * API Route: Manage Excluded Features
 * 
 * GET: List excluded features
 * POST: Restore excluded feature
 */

import { NextRequest, NextResponse } from 'next/server'
import { LocalSQLiteDB } from '@/lib/services/local-sqlite-db'

export async function GET(request: NextRequest) {
  try {
    console.log('📋 [API] Getting excluded features...')
    
    const db = new LocalSQLiteDB()
    await db.initialize()
    
    const excludedFeatures = await db.getExcludedFeatures()
    await db.close()
    
    console.log('✅ [API] Excluded features retrieved:', { count: excludedFeatures.length })
    
    return NextResponse.json({
      success: true,
      features: excludedFeatures,
      count: excludedFeatures.length
    })
  } catch (error) {
    console.error('❌ [API] Error getting excluded features:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 [API] Restoring excluded feature...')
    
    const body = await request.json()
    const { excludedId } = body
    
    if (!excludedId) {
      return NextResponse.json({
        success: false,
        error: 'No excluded ID provided'
      }, { status: 400 })
    }
    
    const db = new LocalSQLiteDB()
    await db.initialize()
    
    const result = await db.restoreExcludedFeature(excludedId)
    await db.close()
    
    if (result.success) {
      console.log('✅ [API] Excluded feature restored successfully:', excludedId)
      return NextResponse.json({
        success: true,
        message: 'Feature restored successfully'
      })
    } else {
      console.error('❌ [API] Error restoring excluded feature:', result.error)
      return NextResponse.json({
        success: false,
        error: result.error
      }, { status: 400 })
    }
  } catch (error) {
    console.error('❌ [API] Error restoring excluded feature:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
