/**
 * File Browser Panel Component
 * 
 * Left sidebar for browsing and managing OSM files
 * 
 * @module components/osm-importer/FileBrowserPanel
 */

'use client'

import { useState, useEffect } from 'react'
import { 
  Folder, File, ChevronRight, ChevronDown, Upload, 
  BarChart3, MapPin, Tag, Calendar, RefreshCw, AlertCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface FileBrowserPanelProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onFileSelect: (filename: string, type: 'geojson' | 'pbf') => void
  selectedFile?: string
}

interface FileInfo {
  filename: string
  path: string
  size: number
  modified: string
  type: 'geojson' | 'pbf'
}

export function FileBrowserPanel({ 
  collapsed, 
  onToggleCollapse, 
  onFileSelect, 
  selectedFile 
}: FileBrowserPanelProps) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['recent']))

  // Load files on mount
  useEffect(() => {
    loadFiles()
  }, [])

  const loadFiles = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch('/api/osm-importer/list-files')
      const data = await response.json()
      
      if (response.ok) {
        setFiles(data.files || [])
      } else {
        setError(data.error || 'Failed to load files')
      }
    } catch (err) {
      setError('Failed to load files')
    } finally {
      setLoading(false)
    }
  }

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folder)) {
        next.delete(folder)
      } else {
        next.add(folder)
      }
      return next
    })
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Group files by type
  const geojsonFiles = files.filter(f => f.type === 'geojson')
  const pbfFiles = files.filter(f => f.type === 'pbf')
  const recentFiles = files.slice(0, 5) // Most recent 5 files

  if (collapsed) {
    return (
      <div className="w-12 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col items-center py-4">
        <button 
          onClick={onToggleCollapse}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
        >
          <Folder className="w-5 h-5" />
        </button>
      </div>
    )
  }

  return (
    <aside className="w-72 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm text-gray-700 dark:text-gray-300">FILES</h2>
          <div className="flex items-center gap-1">
            <button 
              onClick={loadFiles}
              disabled={loading}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition disabled:opacity-50"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
            <button 
              onClick={onToggleCollapse}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Upload Button */}
        <Button className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition">
          <Upload className="w-4 h-4" />
          Upload File
        </Button>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg mb-2">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          </div>
        )}

        {/* Recent Files */}
        <FileTreeFolder
          name="Recent"
          icon={Calendar}
          expanded={expandedFolders.has('recent')}
          onToggle={() => toggleFolder('recent')}
        >
          {recentFiles.map(file => (
            <FileTreeItem 
              key={file.filename}
              name={file.filename} 
              size={formatFileSize(file.size)}
              modified={formatDate(file.modified)}
              type={file.type}
              selected={selectedFile === file.filename}
              onClick={() => onFileSelect(file.filename, file.type)}
            />
          ))}
        </FileTreeFolder>

        {/* GeoJSON Files */}
        <FileTreeFolder
          name="GeoJSON Files"
          icon={File}
          expanded={expandedFolders.has('geojson')}
          onToggle={() => toggleFolder('geojson')}
        >
          {geojsonFiles.map(file => (
            <FileTreeItem 
              key={file.filename}
              name={file.filename} 
              size={formatFileSize(file.size)}
              modified={formatDate(file.modified)}
              type={file.type}
              selected={selectedFile === file.filename}
              onClick={() => onFileSelect(file.filename, file.type)}
            />
          ))}
        </FileTreeFolder>

        {/* PBF Files */}
        <FileTreeFolder
          name="PBF Files"
          icon={File}
          expanded={expandedFolders.has('pbf')}
          onToggle={() => toggleFolder('pbf')}
        >
          {pbfFiles.map(file => (
            <FileTreeItem 
              key={file.filename}
              name={file.filename} 
              size={formatFileSize(file.size)}
              modified={formatDate(file.modified)}
              type={file.type}
              selected={selectedFile === file.filename}
              onClick={() => onFileSelect(file.filename, file.type)}
            />
          ))}
        </FileTreeFolder>
      </div>

      {/* Stats Panel */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-800 space-y-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">File Stats</h3>
        <div className="space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-600 dark:text-gray-400 flex items-center gap-2">
              <File className="w-4 h-4" />
              GeoJSON
            </span>
            <span className="font-medium">{geojsonFiles.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600 dark:text-gray-400 flex items-center gap-2">
              <File className="w-4 h-4" />
              PBF
            </span>
            <span className="font-medium">{pbfFiles.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600 dark:text-gray-400 flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Total
            </span>
            <span className="font-medium">{files.length}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}

// Helper components
function FileTreeFolder({ 
  name, 
  icon: Icon, 
  expanded, 
  onToggle, 
  children 
}: {
  name: string
  icon: React.ComponentType<{ className?: string }>
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
      >
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <Icon className="w-4 h-4 text-gray-500" />
        <span className="font-medium">{name}</span>
      </button>
      {expanded && <div className="ml-6 mt-1 space-y-0.5">{children}</div>}
    </div>
  )
}

function FileTreeItem({ 
  name, 
  size, 
  modified, 
  type,
  selected = false, 
  onClick 
}: {
  name: string
  size: string
  modified: string
  type: 'geojson' | 'pbf'
  selected?: boolean
  onClick: () => void
}) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-2 py-1.5 text-sm rounded-lg transition group",
        selected 
          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
          : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <File className="w-4 h-4 flex-shrink-0 text-gray-400" />
        <span className="truncate">{name}</span>
        <span className={cn(
          "text-xs px-1.5 py-0.5 rounded",
          type === 'geojson' 
            ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
            : "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"
        )}>
          {type}
        </span>
      </div>
      <div className="text-xs text-gray-500 ml-2 text-right">
        <div>{size}</div>
        <div>{modified}</div>
      </div>
    </button>
  )
}
