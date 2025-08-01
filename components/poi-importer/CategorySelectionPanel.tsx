import { Search, Loader2, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { POI_CATEGORIES } from '@/constants/poi-importer'

interface CategorySelectionPanelProps {
  selectedCategory: string
  onCategorySelect: (category: string) => void
  isSearching: boolean
  disabled?: boolean
  onSearch?: () => void
}

export function CategorySelectionPanel({
  selectedCategory,
  onCategorySelect,
  isSearching,
  disabled = false,
  onSearch
}: CategorySelectionPanelProps) {
  const handleCategoryClick = (categoryValue: string) => {
    onCategorySelect(categoryValue)
    if (onSearch && !isSearching && !disabled) {
      onSearch()
    }
  }

  if (disabled) {
    return (
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 bg-gray-300 text-gray-500 rounded-full flex items-center justify-center text-xs font-bold">
            2
          </div>
          <h2 className="text-sm font-semibold text-gray-500">Select Category & Search</h2>
        </div>
        
        <div className="text-center py-4 text-gray-400">
          <Target className="h-6 w-6 mx-auto mb-2" />
          <p className="text-xs">Define an area first to enable search</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 border-b border-gray-200">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
          2
        </div>
        <h2 className="text-sm font-semibold text-gray-900">Select Category & Search</h2>
        {selectedCategory && onSearch && (
          <button
            onClick={onSearch}
            disabled={isSearching}
            className="ml-auto px-3 py-1 bg-orange-500 text-white text-xs rounded hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {isSearching ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            Search
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {POI_CATEGORIES.map((category) => {
          const Icon = category.icon
          const isSelected = selectedCategory === category.value
          return (
            <button
              key={category.value}
              onClick={() => handleCategoryClick(category.value)}
              disabled={isSearching}
              className={cn(
                "flex items-center gap-2 p-2 rounded-md text-sm transition-colors relative",
                isSelected
                  ? "bg-orange-100 text-orange-700 border border-orange-200"
                  : "hover:bg-gray-100 text-gray-700 border border-gray-200",
                isSearching && isSelected && "opacity-75"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate text-xs">{category.label}</span>
              {category.value === 'all' && (
                <div className="absolute top-1 right-1 w-2 h-2 bg-orange-400 rounded-full" title="Searches all categories" />
              )}
            </button>
          )
        })}
      </div>
      
      {selectedCategory === 'all' && (
        <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded-md">
          <p className="text-xs text-orange-700">
            ⚡ &quot;All Categories&quot; searches 15+ types and may take longer
          </p>
        </div>
      )}
    </div>
  )
}