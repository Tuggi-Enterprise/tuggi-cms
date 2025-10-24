/**
 * Local Database Features API
 * 
 * Get features from local SQLite database with pagination and filters
 * 
 * @module app/api/local-db/features/route
 */

import { NextRequest, NextResponse } from 'next/server'
import { LocalSQLiteDB } from '@/lib/services/local-sqlite-db'

export async function GET(request: NextRequest) {
  let localDB: LocalSQLiteDB | null = null
  
  try {
    console.log('📊 [API] Getting features from local database')
    
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const city = searchParams.get('city')
    const category = searchParams.get('category')
    const search = searchParams.get('search')
    
    localDB = new LocalSQLiteDB()
    await localDB.initialize()
    
    // Build query with filters
    let whereClause = 'WHERE 1=1'
    const params: any[] = []
    
    if (city) {
      whereClause += ' AND city LIKE ?'
      params.push(`%${city}%`)
    }
    
    if (category) {
      whereClause += ' AND primary_category LIKE ?'
      params.push(`%${category}%`)
    }
    
    if (search) {
      whereClause += ' AND (name LIKE ? OR description LIKE ?)'
      params.push(`%${search}%`, `%${search}%`)
    }
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM geojson_features ${whereClause}`
    const countResult = localDB['db']?.prepare(countQuery).get(...params) as { total: number }
    const total = countResult?.total || 0
    
    // Get features with pagination
    const offset = (page - 1) * limit
    const featuresQuery = `
      SELECT f.*, c.latitude, c.longitude, c.distance_from_sao_paulo_km, c.distance_from_rio_km
      FROM geojson_features f
      LEFT JOIN geojson_coordinates c ON f.id = c.feature_id
      ${whereClause}
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `
    
    const features = localDB['db']?.prepare(featuresQuery).all(...params, limit, offset) || []
    
    console.log('✅ [API] Features retrieved:', { total, page, limit, featuresCount: features.length })
    
    return NextResponse.json({
      success: true,
      data: {
        features,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    })
  } catch (error) {
    console.error('❌ [API] Error getting features:', error)
    
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
