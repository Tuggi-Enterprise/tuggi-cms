/**
 * OSM Importer Upload API
 * 
 * Handles file uploads for OSM data processing
 * 
 * @module app/api/osm-importer/upload
 */

import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const UPLOAD_DIR = join(process.cwd(), 'output', 'uploads')

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Validate file type
    const allowedTypes = ['.geojson', '.json']
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
    
    if (!allowedTypes.includes(fileExtension)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only .geojson and .json files are allowed.' },
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
    const fileType = 'geojson'

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
      const type: 'pbf' | 'geojson' = extension === '.pbf' ? 'pbf' : 'geojson'
      
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
