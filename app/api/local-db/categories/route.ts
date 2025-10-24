/**
 * Local Database Categories API
 * 
 * Get unique categories from local SQLite database
 * 
 * @module app/api/local-db/categories/route
 */

import { NextRequest, NextResponse } from 'next/server'
import { LocalSQLiteDB } from '@/lib/services/local-sqlite-db'

export async function GET(request: NextRequest) {
  let localDB: LocalSQLiteDB | null = null
  
  try {
    console.log('🏷️ [API] Getting categories from local database')
    
    localDB = new LocalSQLiteDB()
    await localDB.initialize()
    
    const categories = localDB['db']?.prepare(`
      SELECT primary_category, COUNT(*) as count 
      FROM geojson_features 
      WHERE primary_category IS NOT NULL AND primary_category != ''
      GROUP BY primary_category 
      ORDER BY count DESC
    `).all() || []
    
    console.log('✅ [API] Categories retrieved:', { count: categories.length })
    
    return NextResponse.json({
      success: true,
      data: categories
    })
  } catch (error) {
    console.error('❌ [API] Error getting categories:', error)
    
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
