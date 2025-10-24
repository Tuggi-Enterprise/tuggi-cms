/**
 * API Route: Clear Local Database
 * 
 * Clears all data from the local SQLite database
 */

import { NextRequest, NextResponse } from 'next/server'
import { LocalSQLiteDB } from '@/lib/services/local-sqlite-db'

export async function POST(request: NextRequest) {
  try {
    console.log('🧹 [API] Clearing local database...')
    
    const db = new LocalSQLiteDB()
    await db.initialize()
    await db.clearAllData()
    await db.close()
    
    console.log('✅ [API] Local database cleared successfully')
    
    return NextResponse.json({
      success: true,
      message: 'Local database cleared successfully'
    })
  } catch (error) {
    console.error('❌ [API] Error clearing local database:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
