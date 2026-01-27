/**
 * Pagination Component - Shared
 * 
 * Reusable pagination with numbered pages
 * 
 * @module components/shared/Pagination
 */

'use client'

import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  totalItems?: number
  itemsPerPage?: number
  className?: string
}

function generatePageNumbers(currentPage: number, totalPages: number): (number | 'ellipsis')[] {
  const pages: (number | 'ellipsis')[] = []
  
  if (totalPages <= 7) {
    // Show all pages if 7 or fewer
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i)
    }
  } else {
    // Always show first page
    pages.push(1)
    
    if (currentPage > 3) {
      pages.push('ellipsis')
    }
    
    // Show pages around current
    const start = Math.max(2, currentPage - 1)
    const end = Math.min(totalPages - 1, currentPage + 1)
    
    for (let i = start; i <= end; i++) {
      if (i !== 1 && i !== totalPages) {
        pages.push(i)
      }
    }
    
    if (currentPage < totalPages - 2) {
      pages.push('ellipsis')
    }
    
    // Always show last page
    if (totalPages > 1) {
      pages.push(totalPages)
    }
  }
  
  return pages
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  itemsPerPage = 50,
  className
}: PaginationProps) {
  const t = useTranslations('Shared.Pagination')
  if (totalPages <= 1) return null

  const pages = generatePageNumbers(currentPage, totalPages)
  
  // Calculate showing range
  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems || currentPage * itemsPerPage)

  return (
    <div className={cn("flex items-center justify-between", className)}>
      {/* Items info */}
      {totalItems !== undefined && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t('showing', {
            from: startItem,
            to: endItem,
            total: totalItems.toLocaleString()
          })}
        </div>
      )}

      {/* Page navigation */}
      <div className="flex items-center gap-1">
        {/* Previous button */}
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className={cn(
            "flex items-center px-3 py-1.5 text-sm border rounded-md transition-colors",
            currentPage === 1
              ? "opacity-50 cursor-not-allowed border-gray-200 dark:border-gray-700"
              : "hover:bg-gray-100 dark:hover:bg-gray-800 border-gray-300 dark:border-gray-600"
          )}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          {t('prev')}
        </button>

        {/* Page numbers */}
        <div className="flex items-center gap-1 mx-2">
          {pages.map((page, index) => (
            page === 'ellipsis' ? (
              <span key={`ellipsis-${index}`} className="px-2 py-1 text-gray-400">
                <MoreHorizontal className="h-4 w-4" />
              </span>
            ) : (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition-colors min-w-[36px]",
                  page === currentPage
                    ? "bg-blue-600 text-white font-medium"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                )}
              >
                {page}
              </button>
            )
          ))}
        </div>

        {/* Next button */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={cn(
            "flex items-center px-3 py-1.5 text-sm border rounded-md transition-colors",
            currentPage === totalPages
              ? "opacity-50 cursor-not-allowed border-gray-200 dark:border-gray-700"
              : "hover:bg-gray-100 dark:hover:bg-gray-800 border-gray-300 dark:border-gray-600"
          )}
        >
          {t('next')}
          <ChevronRight className="h-4 w-4 ml-1" />
        </button>
      </div>
    </div>
  )
}
