'use client'

import { useState, useEffect, forwardRef } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchInputProps {
  placeholder?: string
  value: string
  onChange: (value: string) => void
  onSearch?: (value: string) => void
  debounceMs?: number
  className?: string
  showSearchButton?: boolean
  disabled?: boolean
}

// Custom hook for debouncing
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ 
    placeholder = "Search...", 
    value, 
    onChange, 
    onSearch,
    debounceMs = 300,
    className,
    showSearchButton = false,
    disabled = false
  }, ref) => {
    const debouncedValue = useDebounce(value, debounceMs)

    // Call onSearch when debounced value changes
    useEffect(() => {
      if (onSearch && debouncedValue !== value) {
        onSearch(debouncedValue)
      }
    }, [debouncedValue, onSearch, value])

    const handleSearchClick = () => {
      if (onSearch) {
        onSearch(value)
      }
    }

    const handleKeyPress = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && onSearch) {
        onSearch(value)
      }
    }

    return (
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          ref={ref}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={disabled}
          className={cn(
            "pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm",
            showSearchButton && "pr-12",
            className
          )}
        />
        {showSearchButton && onSearch && (
          <button
            onClick={handleSearchClick}
            disabled={disabled || !value.trim()}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 px-2 py-1 bg-tuggi-blue text-white rounded text-xs hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Search
          </button>
        )}
      </div>
    )
  }
)

SearchInput.displayName = 'SearchInput'
