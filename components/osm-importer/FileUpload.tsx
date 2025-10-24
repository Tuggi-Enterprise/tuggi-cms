/**
 * File Upload Component - KISS SIMPLIFIED
 * 
 * Simple file upload for GeoJSON files
 * 
 * @module components/osm-importer/FileUpload
 */

'use client'

import { useCallback } from 'react'
import { Upload, FileText, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FileUploadProps {
  onFileSelect: (file: File) => void
  isLoading: boolean
  error: string | null
  currentFile: { name: string; size: number } | null
  className?: string
}

export function FileUpload({ onFileSelect, isLoading, error, currentFile, className }: FileUploadProps) {
  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type === 'application/json') {
      onFileSelect(file)
    }
  }, [onFileSelect])

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file && file.type === 'application/json') {
      onFileSelect(file)
    }
  }, [onFileSelect])

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
  }, [])

  return (
    <div className={cn("w-full", className)}>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
          "border-gray-300 dark:border-gray-600",
          "hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20",
          "cursor-pointer",
          isLoading && "opacity-50 cursor-not-allowed"
        )}
      >
        <input
          type="file"
          accept=".json,.geojson"
          onChange={handleFileChange}
          disabled={isLoading}
          className="hidden"
          id="file-upload"
        />
        <label htmlFor="file-upload" className="cursor-pointer">
          <div className="flex flex-col items-center space-y-4">
            {isLoading ? (
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            ) : (
              <Upload className="w-12 h-12 text-gray-400" />
            )}
            
            <div>
              <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {isLoading ? 'Loading...' : 'Upload GeoJSON File'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Drag and drop or click to select
              </p>
            </div>

            {currentFile && (
              <div className="flex items-center space-x-2 text-sm text-green-600 dark:text-green-400">
                <FileText className="w-4 h-4" />
                <span>{currentFile.name}</span>
                <span className="text-gray-400">
                  ({(currentFile.size / 1024 / 1024).toFixed(2)} MB)
                </span>
              </div>
            )}

            {error && (
              <div className="flex items-center space-x-2 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </label>
      </div>
    </div>
  )
}
