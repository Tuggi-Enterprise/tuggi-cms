/**
 * Unified Local DB API - KISS SIMPLIFIED
 * 
 * Single endpoint that returns all data needed by OSM Importer
 * Eliminates race conditions by providing everything in one call
 * 
 * @module app/api/local-db/all-data
 */

import { NextRequest, NextResponse } from 'next/server'
import { LocalSQLiteDB } from '@/lib/services/local-sqlite-db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  console.log('🔄 [API] Loading all data from local DB...')
  
  let db: LocalSQLiteDB | null = null
  
  try {
    // Initialize database
    db = new LocalSQLiteDB()
    await db.initialize()
    
    // Get all data in parallel (no race conditions)
    const [stats, features, cities, categories] = await Promise.all([
      db.getStats(),
      getFeatures(db, request),
      getCities(db),
      getCategories(db)
    ])
    
    console.log('✅ [API] All data loaded successfully:', {
      features: features.length,
      cities: cities.length,
      categories: categories.length,
      stats
    })
    
    return NextResponse.json({
      success: true,
      data: {
        features,
        cities,
        categories,
        stats,
        pagination: {
          page: 1,
          limit: 50,
          total: features.length,
          totalPages: Math.ceil(features.length / 50)
        }
      }
    })
    
  } catch (error) {
    console.error('❌ [API] Error loading all data:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load data'
    }, { status: 500 })
  } finally {
    if (db) {
      await db.close()
    }
  }
}

async function getFeatures(db: LocalSQLiteDB, request: NextRequest) {
  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = parseInt(url.searchParams.get('limit') || '50000') // Support up to 50k POIs for map view
  const offset = (page - 1) * limit
  
  console.log('📊 [API] Loading features:', { page, limit, offset })
  
  const query = `
    SELECT 
      f.*,
      c.latitude,
      c.longitude,
      c.distance_from_sao_paulo_km,
      c.distance_from_rio_km
    FROM geojson_features f
    LEFT JOIN geojson_coordinates c ON f.id = c.feature_id
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `
  
  const features = db.database?.prepare(query).all(limit, offset) || []
  
  console.log('📊 [API] Features loaded:', features.length)
  return features
}

async function getCities(db: LocalSQLiteDB) {
  console.log('🏙️ [API] Loading cities...')
  
  const query = `
    SELECT DISTINCT city, state 
    FROM geojson_features 
    WHERE city IS NOT NULL AND city != ''
    ORDER BY state, city
  `
  
  const cities = db.database?.prepare(query).all() || []
  const cityData = cities.map((item: any) => ({
    name: item.city,
    state: item.state || 'Unknown'
  }))
  
  console.log('🏙️ [API] Cities loaded:', cityData.length)
  return cityData
}

async function getCategories(db: LocalSQLiteDB) {
  console.log('🏷️ [API] Loading categories...')
  
  const query = `
    SELECT DISTINCT primary_category 
    FROM geojson_features 
    WHERE primary_category IS NOT NULL AND primary_category != ''
    ORDER BY primary_category
  `
  
  const categories = db.database?.prepare(query).all() || []
  const categoryNames = categories.map((item: any) => item.primary_category)
  
  console.log('🏷️ [API] Categories loaded:', categoryNames.length)
  return categoryNames
}
