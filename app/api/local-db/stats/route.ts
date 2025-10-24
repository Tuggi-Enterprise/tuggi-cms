/**
 * Local Database Stats API
 * 
 * Get statistics from local SQLite database
 * 
 * @module app/api/local-db/stats/route
 */

import { NextRequest, NextResponse } from 'next/server'
import { LocalSQLiteDB } from '@/lib/services/local-sqlite-db'

export async function GET(request: NextRequest) {
  let localDB: LocalSQLiteDB | null = null
  
  try {
    console.log('📊 [API] Getting local database stats')
    
    localDB = new LocalSQLiteDB()
    await localDB.initialize()
    
    const stats = await localDB.getStats()
    
    console.log('✅ [API] Local database stats retrieved:', stats)
    
    return NextResponse.json({
      success: true,
      stats
    })
  } catch (error) {
    console.error('❌ [API] Error getting local database stats:', error)
    
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
