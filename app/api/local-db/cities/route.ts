/**
 * Local Database Cities API
 * 
 * Get unique cities from local SQLite database
 * 
 * @module app/api/local-db/cities/route
 */

import { NextRequest, NextResponse } from 'next/server'
import { LocalSQLiteDB } from '@/lib/services/local-sqlite-db'

export async function GET(request: NextRequest) {
  let localDB: LocalSQLiteDB | null = null
  
  try {
    console.log('🏙️ [API] Getting cities from local database')
    
    localDB = new LocalSQLiteDB()
    await localDB.initialize()
    
    const cities = localDB['db']?.prepare(`
      SELECT city, COUNT(*) as count 
      FROM geojson_features 
      WHERE city IS NOT NULL AND city != ''
      GROUP BY city 
      ORDER BY count DESC
    `).all() || []
    
    console.log('✅ [API] Cities retrieved:', { count: cities.length })
    
    return NextResponse.json({
      success: true,
      data: cities
    })
  } catch (error) {
    console.error('❌ [API] Error getting cities:', error)
    
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
