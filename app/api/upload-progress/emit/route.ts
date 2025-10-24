import { NextRequest, NextResponse } from 'next/server'
import { uploadProgressEmitter } from '../route'

export async function POST(request: NextRequest) {
  try {
    const { uploadId, data } = await request.json()
    
    if (!uploadId || !data) {
      return NextResponse.json({ error: 'Missing uploadId or data' }, { status: 400 })
    }

    console.log(`📡 [EMIT] Emitting progress update for upload: ${uploadId}`)
    
    // Emit the progress update
    uploadProgressEmitter.emit({
      uploadId,
      timestamp: new Date().toISOString(),
      ...data
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('❌ [EMIT] Error emitting progress update:', error)
    return NextResponse.json({ error: 'Failed to emit progress update' }, { status: 500 })
  }
}

