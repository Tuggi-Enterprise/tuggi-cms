/**
 * OSM Importer Upload API
 * 
 * Handles file uploads for OSM data processing (GeoJSON and CSV)
 * 
 * @module app/api/osm-importer/upload
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const UPLOAD_DIR = join(process.cwd(), 'output', 'uploads')

export async function POST(request: NextRequest) {
  try {
    // Ensure admin user before allowing upload
    const supabaseAuth = createRouteHandlerClient({ cookies })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized - Authentication required' }, { status: 401 })
    }
    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()
    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 403 })
    }
    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Validate file type
    const allowedTypes = ['.geojson', '.json', '.csv']
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
    
    if (!allowedTypes.includes(fileExtension)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only .geojson, .json, and .csv files are allowed.' },
        { status: 400 }
      )
    }

    // Validate file size (max 500MB)
    const maxSize = 500 * 1024 * 1024 // 500MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 500MB.' },
        { status: 400 }
      )
    }

    // Create upload directory if it doesn't exist
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true })
    }

    // Generate unique filename to avoid conflicts
    const timestamp = Date.now()
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const filename = `${timestamp}_${sanitizedName}`
    const filepath = join(UPLOAD_DIR, filename)

    // Convert file to buffer and save
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    
    await writeFile(filepath, buffer)

    // Determine file type
    const fileType = fileExtension === '.csv' ? 'csv' : 'geojson'

    // Return success response
    return NextResponse.json({
      success: true,
      filename: filename,
      originalName: file.name,
      size: file.size,
      type: fileType,
      path: filepath,
      uploadedAt: new Date().toISOString()
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    // List uploaded files
    const { readdir, stat } = await import('fs/promises')
    
    if (!existsSync(UPLOAD_DIR)) {
      return NextResponse.json({ files: [] })
    }

    const files = await readdir(UPLOAD_DIR)
    const fileList = []

    for (const file of files) {
      const filepath = join(UPLOAD_DIR, file)
      const stats = await stat(filepath)
      
      // Determine file type
      const extension = file.toLowerCase().substring(file.lastIndexOf('.'))
      const type: 'pbf' | 'geojson' | 'csv' = 
        extension === '.pbf' ? 'pbf' : 
        extension === '.csv' ? 'csv' : 
        'geojson'
      
      fileList.push({
        filename: file,
        path: filepath,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        type: type,
        source: 'upload'
      })
    }

    // Sort by modification time (newest first)
    fileList.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())

    return NextResponse.json({ files: fileList })

  } catch (error) {
    console.error('List files error:', error)
    return NextResponse.json(
      { error: 'Failed to list files' },
      { status: 500 }
    )
  }
}
