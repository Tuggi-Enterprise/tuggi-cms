'use client'

import { useState, useEffect } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search, Filter, Edit, CheckCircle, XCircle, Eye } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'

interface POI {
  id: string
  name: string
  city: string
  country: string
  approved: boolean
  audio_guides_count: number
  created_at: string
  updated_at: string
}

export default function POIListPage() {
  const [pois, setPois] = useState<POI[]>([])
  const [filteredPois, setFilteredPois] = useState<POI[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending'>('all')
  const [cityFilter, setCityFilter] = useState('')
  const [selectedPois, setSelectedPois] = useState<string[]>([])
  const [cities, setCities] = useState<string[]>([])
  
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
  }, [pois, searchTerm, statusFilter, cityFilter])

  const fetchPois = async () => {
    try {
      const { data, error } = await supabase
        .from('core.attractions')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching POIs:', error)
        return
      }

      setPois(data || [])
      
      // Extract unique cities
      const uniqueCities = [...new Set(data?.map(poi => poi.city).filter(Boolean))]
      setCities(uniqueCities)
    } catch (error) {
      console.error('Error fetching POIs:', error)
    } finally {
      setIsLoading(false)
    }
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

    setFilteredPois(filtered)
  }

  const togglePOISelection = (poiId: string) => {
    setSelectedPois(prev =>
      prev.includes(poiId)
        ? prev.filter(id => id !== poiId)
        : [...prev, poiId]
    )
  }

  const selectAllPois = () => {
    setSelectedPois(
      selectedPois.length === filteredPois.length
        ? []
        : filteredPois.map(poi => poi.id)
    )
  }

  const bulkApprove = async () => {
    try {
      const { error } = await supabase
        .from('core.attractions')
        .update({ approved: true })
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
        .from('core.attractions')
        .update({ approved: false })
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
      const { error } = await supabase
        .from('core.attractions')
        .update({ approved: !currentStatus })
        .eq('id', poiId)

      if (error) throw error

      await fetchPois()
    } catch (error) {
      console.error('Error updating POI approval:', error)
    }
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-tuggi-text dark:text-white">
            POI Management
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage your points of interest
          </p>
        </div>
        <Link
          href="/pois/new"
          className="tuggi-button-primary inline-flex items-center px-4 py-2 rounded-md transition-colors"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add New POI
        </Link>
      </div>

      {/* Filters */}
      <div className="tuggi-card p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search POIs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="tuggi-input pl-10 pr-4 py-2 w-full rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="tuggi-input px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
          >
            <option value="all">All Status</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
          </select>

          {/* City Filter */}
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="tuggi-input px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
          >
            <option value="">All Cities</option>
            {cities.map(city => (
              <option key={city} value={city}>{city}</option>
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
              className="tuggi-button-secondary inline-flex items-center px-3 py-1 text-sm rounded transition-colors"
            >
              <XCircle className="h-3 w-3 mr-1" />
              Reject
            </button>
          </div>
        )}
      </div>

      {/* POI Table */}
      <div className="tuggi-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-tuggi-border dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedPois.length === filteredPois.length && filteredPois.length > 0}
                    onChange={selectAllPois}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-tuggi-text dark:text-gray-400 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-tuggi-text dark:text-gray-400 uppercase tracking-wider">
                  Location
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-tuggi-text dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-tuggi-text dark:text-gray-400 uppercase tracking-wider">
                  Descriptions
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-tuggi-text dark:text-gray-400 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-tuggi-text dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-tuggi-border dark:divide-gray-700">
              {filteredPois.map((poi) => (
                <tr key={poi.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4">
                    <input
                      type="checkbox"
                      checked={selectedPois.includes(poi.id)}
                      onChange={() => togglePOISelection(poi.id)}
                      className="rounded border-tuggi-border text-tuggi-blue focus:ring-tuggi-blue"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-tuggi-text dark:text-white">
                      {poi.name}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-tuggi-text dark:text-white">
                      {poi.city}, {poi.country}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => toggleApproval(poi.id, poi.approved)}
                      className={cn(
                        'inline-flex items-center px-2 py-1 text-xs font-medium rounded-full',
                        poi.approved
                          ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                          : 'bg-tuggi-orange/10 text-tuggi-orange border border-tuggi-orange/20'
                      )}
                    >
                      {poi.approved ? (
                        <>
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Approved
                        </>
                      ) : (
                        <>
                          <XCircle className="h-3 w-3 mr-1" />
                          Pending
                        </>
                      )}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-sm text-tuggi-text dark:text-white">
                    {poi.audio_guides_count}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(poi.created_at)}
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <Link
                      href={`/pois/${poi.id}`}
                      className="inline-flex items-center px-3 py-1 text-xs bg-tuggi-blue/10 text-tuggi-blue border border-tuggi-blue/20 rounded hover:bg-tuggi-blue/20 transition-colors"
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredPois.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">
              No POIs found matching your criteria.
            </p>
          </div>
        )}
      </div>
    </div>
  )
} 