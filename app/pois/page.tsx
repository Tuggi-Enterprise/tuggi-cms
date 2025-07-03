'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search, Filter, Edit, CheckCircle, XCircle, Eye, Trash2, MapPin, Calendar, Star, Users, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import { POI_CATEGORIES } from '@/constants/poi-importer'
import { POIDetailsModal } from '@/components/poi-management/POIDetailsModal'

interface POI {
  id: string
  name: string
  city: string
  country: string
  category: string
  approved: boolean
  approved_by: string | null
  approved_at: string | null
  rating: number | null
  image_url: string | null
  created_at: string
  updated_at: string
  user_ratings_total: number | null
  formatted_address: string | null
  website: string | null
  formatted_phone_number: string | null
  business_status: string | null
  coordinates?: {
    latitude: number
    longitude: number
  }
}

interface POIStats {
  total: number
  approved: number
  pending: number
  recentlyAdded: number
}

// Component that handles search params
function POIListWithSearchParams() {
  const [pois, setPois] = useState<POI[]>([])
  const [filteredPois, setFilteredPois] = useState<POI[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending'>('all')
  const [cityFilter, setCityFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [selectedPois, setSelectedPois] = useState<string[]>([])
  const [cities, setCities] = useState<string[]>([])
  const [stats, setStats] = useState<POIStats>({ total: 0, approved: 0, pending: 0, recentlyAdded: 0 })
  const [selectedPoi, setSelectedPoi] = useState<POI | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(20)
  const [totalPages, setTotalPages] = useState(1)
  
  const supabase = useSupabaseClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    fetchPois()
    
    // Check for filter from URL
    const filterParam = searchParams.get('filter')
    if (filterParam === 'pending') {
      setStatusFilter('pending')
    }
  }, [searchParams])

  useEffect(() => {
    filterPois()
  }, [pois, searchTerm, statusFilter, cityFilter, categoryFilter])

  useEffect(() => {
    calculateStats()
  }, [pois])

  const fetchPois = async () => {
    try {
      // Fetch POIs with coordinates
      const { data, error } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          *,
          coordinates:attraction_coordinate(latitude, longitude)
        `)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching POIs:', error)
        return
      }

      // Transform data to include coordinates and ensure required fields
      const poisWithCoords = data?.map(poi => ({
        ...poi,
        coordinates: poi.coordinates?.[0] || null,
        formatted_phone_number: poi.formatted_phone_number || null,
        business_status: poi.business_status || null
      })) || []

      setPois(poisWithCoords)
      
      // Extract unique cities
      const uniqueCities = Array.from(new Set(poisWithCoords.map(poi => poi.city).filter(Boolean)))
      setCities(uniqueCities)
    } catch (error) {
      console.error('Error fetching POIs:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const calculateStats = () => {
    const total = pois.length
    const approved = pois.filter(poi => poi.approved).length
    const pending = total - approved
    const recentlyAdded = pois.filter(poi => {
      const created = new Date(poi.created_at)
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      return created > weekAgo
    }).length

    setStats({ total, approved, pending, recentlyAdded })
  }

  const filterPois = () => {
    let filtered = pois

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(poi =>
        poi.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        poi.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
        poi.country.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(poi =>
        statusFilter === 'approved' ? poi.approved : !poi.approved
      )
    }

    // City filter
    if (cityFilter) {
      filtered = filtered.filter(poi => poi.city === cityFilter)
    }

    // Category filter
    if (categoryFilter) {
      filtered = filtered.filter(poi => poi.category === categoryFilter)
    }

    setFilteredPois(filtered)
    setTotalPages(Math.ceil(filtered.length / itemsPerPage))
    setCurrentPage(1) // Reset to first page when filtering
  }

  const getPaginatedPois = () => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return filteredPois.slice(startIndex, endIndex)
  }

  const togglePOISelection = (poiId: string) => {
    setSelectedPois(prev =>
      prev.includes(poiId)
        ? prev.filter(id => id !== poiId)
        : [...prev, poiId]
    )
  }

  const selectAllPois = () => {
    const currentPagePois = getPaginatedPois()
    const allSelected = currentPagePois.every(poi => selectedPois.includes(poi.id))
    
    if (allSelected) {
      // Deselect all from current page
      setSelectedPois(prev => prev.filter(id => !currentPagePois.map(p => p.id).includes(id)))
    } else {
      // Select all from current page
      setSelectedPois(prev => [...new Set([...prev, ...currentPagePois.map(p => p.id)])])
    }
  }

  const bulkApprove = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .update({ 
          approved: true,
          approved_by: user?.id,
          approved_at: new Date().toISOString()
        })
        .in('id', selectedPois)

      if (error) throw error

      await fetchPois()
      setSelectedPois([])
    } catch (error) {
      console.error('Error bulk approving POIs:', error)
    }
  }

  const bulkReject = async () => {
    try {
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .update({ 
          approved: false,
          approved_by: null,
          approved_at: null
        })
        .in('id', selectedPois)

      if (error) throw error

      await fetchPois()
      setSelectedPois([])
    } catch (error) {
      console.error('Error bulk rejecting POIs:', error)
    }
  }

  const toggleApproval = async (poiId: string, currentStatus: boolean) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .update({ 
          approved: !currentStatus,
          approved_by: !currentStatus ? user?.id : null,
          approved_at: !currentStatus ? new Date().toISOString() : null
        })
        .eq('id', poiId)

      if (error) throw error

      await fetchPois()
    } catch (error) {
      console.error('Error updating POI approval:', error)
    }
  }

  const deletePoi = async (poiId: string) => {
    if (!window.confirm('Are you sure you want to delete this POI? This action cannot be undone.')) {
      return
    }

    try {
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .delete()
        .eq('id', poiId)

      if (error) throw error

      await fetchPois()
    } catch (error) {
      console.error('Error deleting POI:', error)
    }
  }

  const openPOIDetails = (poi: POI) => {
    setSelectedPoi(poi)
    setIsModalOpen(true)
  }

  const closePOIDetails = () => {
    setSelectedPoi(null)
    setIsModalOpen(false)
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="space-y-3">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header with Statistics */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-tuggi-text dark:text-white">
            POI Management
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage and approve imported Points of Interest
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-6 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-tuggi-blue">{stats.total}</div>
              <div className="text-gray-500">Total POIs</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{stats.approved}</div>
              <div className="text-gray-500">Approved</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-tuggi-orange">{stats.pending}</div>
              <div className="text-gray-500">Pending</div>
            </div>
          </div>
          <Link
            href="/poi-importer"
            className="bg-tuggi-blue text-white inline-flex items-center px-4 py-2 rounded-md hover:bg-tuggi-blue/90 transition-colors"
          >
            <Plus className="h-4 w-4 mr-2" />
            Import POIs
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search POIs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
          >
            <option value="all">All Status</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
          </select>

          {/* City Filter */}
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Cities</option>
            {cities.map(city => (
              <option key={city} value={city}>{city}</option>
            ))}
          </select>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Categories</option>
            {POI_CATEGORIES.filter(cat => cat.value !== 'all').map(category => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
          </select>

          {/* Results count */}
          <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
            Showing {filteredPois.length} of {pois.length} POIs
          </div>
        </div>

        {/* Bulk Actions */}
        {selectedPois.length > 0 && (
          <div className="flex items-center space-x-3 p-4 bg-tuggi-blue/10 border border-tuggi-blue/20 rounded-md">
            <span className="text-sm font-medium text-tuggi-blue">
              {selectedPois.length} POI(s) selected
            </span>
            <button
              onClick={bulkApprove}
              className="inline-flex items-center px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors"
            >
              <CheckCircle className="h-3 w-3 mr-1" />
              Approve
            </button>
            <button
              onClick={bulkReject}
              className="inline-flex items-center px-3 py-1 bg-tuggi-orange text-white text-sm rounded hover:bg-tuggi-orange/90 transition-colors"
            >
              <XCircle className="h-3 w-3 mr-1" />
              Reject
            </button>
          </div>
        )}
      </div>

      {/* POI Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={getPaginatedPois().length > 0 && getPaginatedPois().every(poi => selectedPois.includes(poi.id))}
                    onChange={selectAllPois}
                    className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  City
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Country
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Rating
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Created At
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {getPaginatedPois().map((poi) => (
                <tr key={poi.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4">
                    <input
                      type="checkbox"
                      checked={selectedPois.includes(poi.id)}
                      onChange={() => togglePOISelection(poi.id)}
                      className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      {poi.image_url && (
                        <img
                          src={poi.image_url}
                          alt={poi.name}
                          className="h-10 w-10 rounded-md object-cover mr-3"
                        />
                      )}
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {poi.name}
                        </div>
                        {poi.formatted_address && (
                          <div className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-xs">
                            {poi.formatted_address}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                    {poi.city}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                    {poi.country}
                  </td>
                  <td className="px-6 py-4">
                    {poi.category && (
                      <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300">
                        {POI_CATEGORIES.find(cat => cat.value === poi.category)?.label || poi.category}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {poi.rating && (
                      <div className="flex items-center">
                        <Star className="h-4 w-4 text-yellow-400 mr-1" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {poi.rating.toFixed(1)}
                        </span>
                        {poi.user_ratings_total && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                            ({poi.user_ratings_total})
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => toggleApproval(poi.id, poi.approved)}
                      className={cn(
                        'inline-flex items-center px-2 py-1 text-xs font-medium rounded-full transition-colors',
                        poi.approved
                          ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/40'
                          : 'bg-tuggi-orange/10 text-tuggi-orange border border-tuggi-orange/20 hover:bg-tuggi-orange/20'
                      )}
                    >
                      {poi.approved ? (
                        <>
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Approved
                        </>
                      ) : (
                        <>
                          <Clock className="h-3 w-3 mr-1" />
                          Pending
                        </>
                      )}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(poi.created_at)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={() => openPOIDetails(poi)}
                        className="inline-flex items-center px-2 py-1 text-xs bg-tuggi-blue/10 text-tuggi-blue border border-tuggi-blue/20 rounded hover:bg-tuggi-blue/20 transition-colors"
                      >
                        <Edit className="h-3 w-3 mr-1" />
                        Edit
                      </button>
                      <button
                        onClick={() => deletePoi(poi.id)}
                        className="inline-flex items-center px-2 py-1 text-xs bg-red-100 text-red-800 border border-red-200 rounded hover:bg-red-200 transition-colors"
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-white dark:bg-gray-800 px-4 py-3 flex items-center justify-between border-t border-gray-200 dark:border-gray-700">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Showing{' '}
                  <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span>
                  {' '}to{' '}
                  <span className="font-medium">
                    {Math.min(currentPage * itemsPerPage, filteredPois.length)}
                  </span>
                  {' '}of{' '}
                  <span className="font-medium">{filteredPois.length}</span>
                  {' '}results
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  
                  {/* Page Numbers */}
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={cn(
                        'relative inline-flex items-center px-4 py-2 border text-sm font-medium',
                        page === currentPage
                          ? 'z-10 bg-tuggi-blue border-tuggi-blue text-white'
                          : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                      )}
                    >
                      {page}
                    </button>
                  ))}
                  
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* POI Details Modal */}
      {selectedPoi && (
        <POIDetailsModal
          poi={selectedPoi}
          isOpen={isModalOpen}
          onClose={closePOIDetails}
          onUpdate={fetchPois}
        />
      )}
    </div>
  )
}

function POIListLoading() {
  return (
    <div className="p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
        <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded"></div>
        <div className="space-y-3">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function POIListPage() {
  return (
    <Suspense fallback={<POIListLoading />}>
      <POIListWithSearchParams />
    </Suspense>
  )
} 