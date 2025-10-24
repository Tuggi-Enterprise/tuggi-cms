import { useState, useEffect, useCallback, useRef } from 'react'

interface UploadProgressData {
  type: 'connected' | 'upload-started' | 'pois-processed' | 'upload-completed'
  uploadId: string
  timestamp: string
  message?: string
  totalFeatures?: number
  completeCount?: number
  incompleteCount?: number
  chunkNumber?: number
  totalChunks?: number
  newPOIs?: number
  totalImported?: number
  totalErrors?: number
  success?: boolean
}

interface UseUploadProgressReturn {
  isConnected: boolean
  progress: UploadProgressData | null
  error: string | null
  connect: (uploadId: string) => void
  disconnect: () => void
}

export function useUploadProgress(): UseUploadProgressReturn {
  const [isConnected, setIsConnected] = useState(false)
  const [progress, setProgress] = useState<UploadProgressData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const connect = useCallback((uploadId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    console.log(`📡 [HOOK] Connecting to upload progress stream: ${uploadId}`)
    
    const eventSource = new EventSource(`/api/upload-progress?uploadId=${uploadId}`)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      console.log('📡 [HOOK] Upload progress stream connected')
      setIsConnected(true)
      setError(null)
    }

    eventSource.onmessage = (event) => {
      try {
        const data: UploadProgressData = JSON.parse(event.data)
        console.log('📡 [HOOK] Received progress update:', data)
        setProgress(data)
      } catch (err) {
        console.error('📡 [HOOK] Error parsing progress data:', err)
        setError('Failed to parse progress data')
      }
    }

    eventSource.onerror = (err) => {
      console.error('📡 [HOOK] Upload progress stream error:', err)
      setError('Connection to upload progress stream failed')
      setIsConnected(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      console.log('📡 [HOOK] Disconnecting from upload progress stream')
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setIsConnected(false)
      setProgress(null)
      setError(null)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  return {
    isConnected,
    progress,
    error,
    connect,
    disconnect
  }
}

