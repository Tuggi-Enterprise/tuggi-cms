import { NextRequest } from 'next/server'

// Store for active connections
const connections = new Set<ReadableStreamDefaultController>()

// Event emitter for upload progress
class UploadProgressEmitter {
  private listeners = new Set<(data: any) => void>()

  emit(data: any) {
    this.listeners.forEach(listener => {
      try {
        listener(data)
      } catch (error) {
        console.error('Error in progress listener:', error)
      }
    })
  }

  subscribe(listener: (data: any) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const uploadProgressEmitter = new UploadProgressEmitter()

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const uploadId = searchParams.get('uploadId')

  if (!uploadId) {
    return new Response('Missing uploadId', { status: 400 })
  }

  console.log(`📡 [SSE] Starting progress stream for upload: ${uploadId}`)

  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    start(controller) {
      // Add connection to active connections
      connections.add(controller)
      
      // Send initial connection message
      const initialMessage = `data: ${JSON.stringify({
        type: 'connected',
        uploadId,
        timestamp: new Date().toISOString()
      })}\n\n`
      controller.enqueue(encoder.encode(initialMessage))

      // Subscribe to progress updates
      const unsubscribe = uploadProgressEmitter.subscribe((data) => {
        if (data.uploadId === uploadId) {
          const message = `data: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(message))
        }
      })

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        console.log(`📡 [SSE] Connection closed for upload: ${uploadId}`)
        connections.delete(controller)
        unsubscribe()
        controller.close()
      })
    },

    cancel() {
      console.log(`📡 [SSE] Stream cancelled for upload: ${uploadId}`)
      connections.delete(controller)
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    }
  })
}

// Helper function to emit progress updates
export function emitProgressUpdate(uploadId: string, data: any) {
  uploadProgressEmitter.emit({
    uploadId,
    timestamp: new Date().toISOString(),
    ...data
  })
}

