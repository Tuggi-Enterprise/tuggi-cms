'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { 
  MessageSquare, 
  Star, 
  ThumbsUp, 
  ThumbsDown, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  MapPin, 
  Users, 
  TrendingUp, 
  Filter,
  Search,
  Calendar,
  RefreshCw,
  Eye,
  ExternalLink
} from 'lucide-react'
import Link from 'next/link'

interface ReviewStats {
  totalFeedbacks: number
  averageRating: number
  totalRatings: number
  feedbackByType: Array<{ feedback_type: string; count: number; percentage: number }>
  ratingDistribution: Array<{ rating: number; count: number; percentage: number }>
  recentFeedbacks: Array<{ 
    id: string; 
    feedback_type: string; 
    rating: number | null; 
    feedback_details: string | null; 
    created_at: string;
    attraction_id: string;
    attraction_name: string;
    user_name: string;
  }>
  feedbacksByPOI: Array<{
    attraction_id: string;
    attraction_name: string;
    city: string;
    total_feedbacks: number;
    avg_rating: number;
    critical_issues: number;
    last_feedback: string;
  }>
  topIssues: Array<{ issue: string; count: number; percentage: number }>
}

const COLORS = ['#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#84CC16']

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

export default function ReviewsPage() {
  const [stats, setStats] = useState<ReviewStats>({
    totalFeedbacks: 0,
    averageRating: 0,
    totalRatings: 0,
    feedbackByType: [],
    ratingDistribution: [],
    recentFeedbacks: [],
    feedbacksByPOI: [],
    topIssues: []
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [activeFilter, setActiveFilter] = useState<'all' | 'critical' | 'recent' | 'high-rated' | 'low-rated'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  
  // Debounce search term to avoid excessive filtering
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  
  const supabase = useSupabaseClient()

  const fetchReviewData = useCallback(async () => {
    try {
      setError(null)
      setIsLoading(true)

      const daysAgo = new Date()
      daysAgo.setDate(daysAgo.getDate() - 30) // Last 30 days
      const dateFilter = daysAgo.toISOString()

      // Fetch all feedback data with pagination
      let allFeedbacksData: any[] = []
      let hasMoreFeedbacks = true
      let feedbackPage = 0
      const pageSize = 1000
      
      while (hasMoreFeedbacks) {
        const { data: feedbackChunk, error: feedbackError } = await supabase
          .schema('drive')
          .from('attraction_feedback')
          .select(`
            id, 
            feedback_type, 
            rating, 
            audio_quality_rating,
            timing_rating,
            location_accuracy_rating,
            feedback_details, 
            created_at, 
            attraction_id,
            user_id
          `)
          .gte('created_at', dateFilter)
          .range(feedbackPage * pageSize, (feedbackPage + 1) * pageSize - 1)
        
        if (feedbackError) {
          console.error('Error fetching feedback data:', feedbackError)
          break
        }
        
        if (feedbackChunk && feedbackChunk.length > 0) {
          allFeedbacksData = [...allFeedbacksData, ...feedbackChunk]
          feedbackPage++
        } else {
          hasMoreFeedbacks = false
        }
        
        if (feedbackPage > 10) {
          hasMoreFeedbacks = false
        }
      }

      // Process feedback data
      const totalFeedbacks = allFeedbacksData.length
      
      // Group feedbacks by type
      const feedbackByTypeMap = allFeedbacksData.reduce((acc: Record<string, number>, feedback) => {
        const type = feedback.feedback_type
        acc[type] = (acc[type] || 0) + 1
        return acc
      }, {})
      
      const feedbackByType = Object.entries(feedbackByTypeMap).map(([type, count]) => ({
        feedback_type: type,
        count: count as number,
        percentage: Math.round(((count as number) / totalFeedbacks) * 100)
      })).sort((a, b) => b.count - a.count)

      // Calculate average rating
      const ratingsWithValues = allFeedbacksData.filter(f => f.rating !== null)
      const averageRating = ratingsWithValues.length > 0 
        ? ratingsWithValues.reduce((sum, f) => sum + f.rating, 0) / ratingsWithValues.length 
        : 0

      // Rating distribution
      const ratingDistributionMap = allFeedbacksData.reduce((acc: Record<number, number>, feedback) => {
        if (feedback.rating !== null) {
          acc[feedback.rating] = (acc[feedback.rating] || 0) + 1
        }
        return acc
      }, {})
      
      const ratingDistribution = Object.entries(ratingDistributionMap).map(([rating, count]) => ({
        rating: parseInt(rating),
        count: count as number,
        percentage: Math.round(((count as number) / ratingsWithValues.length) * 100)
      })).sort((a, b) => a.rating - b.rating)

      // Get recent feedbacks with attraction names
      const recentFeedbacksWithDetails = await Promise.all(
        allFeedbacksData
          .slice(0, 20) // Get more recent feedbacks
          .map(async (feedback) => {
            // Get attraction name
            const { data: attractionData } = await supabase
              .schema('core')
              .from('attractions')
              .select('name, city')
              .eq('id', feedback.attraction_id)
              .single()
            
            // Get user name
            const { data: userData } = await supabase
              .schema('drive')
              .from('profiles')
              .select('full_name, nickname')
              .eq('id', feedback.user_id)
              .single()
            
            return {
              id: feedback.id,
              feedback_type: feedback.feedback_type,
              rating: feedback.rating,
              feedback_details: feedback.feedback_details,
              created_at: new Date(feedback.created_at).toLocaleDateString('pt-BR', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit' 
              }),
              attraction_id: feedback.attraction_id,
              attraction_name: attractionData?.name || 'POI não encontrado',
              user_name: userData?.full_name || userData?.nickname || 'Usuário'
            }
          })
      )

      // Group feedbacks by POI
      const feedbacksByPOIMap = allFeedbacksData.reduce((acc: Record<string, any>, feedback) => {
        if (!acc[feedback.attraction_id]) {
          acc[feedback.attraction_id] = {
            attraction_id: feedback.attraction_id,
            total_feedbacks: 0,
            ratings: [],
            critical_issues: 0,
            last_feedback: feedback.created_at
          }
        }
        
        acc[feedback.attraction_id].total_feedbacks++
        if (feedback.rating) {
          acc[feedback.attraction_id].ratings.push(feedback.rating)
        }
        if (feedback.feedback_type === 'wrong_info') {
          acc[feedback.attraction_id].critical_issues++
        }
        if (new Date(feedback.created_at) > new Date(acc[feedback.attraction_id].last_feedback)) {
          acc[feedback.attraction_id].last_feedback = feedback.created_at
        }
        
        return acc
      }, {})

      const feedbacksByPOI = await Promise.all(
        Object.values(feedbacksByPOIMap).map(async (poiData: any) => {
          const { data: attractionData } = await supabase
            .schema('core')
            .from('attractions')
            .select('name, city')
            .eq('id', poiData.attraction_id)
            .single()

          return {
            attraction_id: poiData.attraction_id,
            attraction_name: attractionData?.name || 'POI não encontrado',
            city: attractionData?.city || 'Cidade não encontrada',
            total_feedbacks: poiData.total_feedbacks,
            avg_rating: poiData.ratings.length > 0 
              ? poiData.ratings.reduce((sum: number, r: number) => sum + r, 0) / poiData.ratings.length 
              : 0,
            critical_issues: poiData.critical_issues,
            last_feedback: new Date(poiData.last_feedback).toLocaleDateString('pt-BR')
          }
        })
      )

      // Sort by critical issues first, then by total feedbacks
      feedbacksByPOI.sort((a, b) => {
        if (a.critical_issues !== b.critical_issues) {
          return b.critical_issues - a.critical_issues
        }
        return b.total_feedbacks - a.total_feedbacks
      })

      // Top issues
      const topIssues = feedbackByType
        .filter(f => f.feedback_type !== 'like')
        .slice(0, 6)
        .map(f => ({
          issue: f.feedback_type.replace(/_/g, ' '),
          count: f.count,
          percentage: f.percentage
        }))

      const newStats = {
        totalFeedbacks,
        averageRating,
        totalRatings: ratingsWithValues.length,
        feedbackByType,
        ratingDistribution,
        recentFeedbacks: recentFeedbacksWithDetails,
        feedbacksByPOI: feedbacksByPOI.slice(0, 20), // Top 20 POIs with most feedbacks
        topIssues
      }

      setStats(newStats)
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Error fetching review data:', err)
      setError('Erro ao carregar dados de reviews')
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchReviewData()
  }, [fetchReviewData])

  // Memoize filtered feedbacks to prevent unnecessary re-filtering
  const filteredFeedbacks = useMemo(() => {
    let filtered = stats.recentFeedbacks

    // Apply search filter
    if (debouncedSearchTerm) {
      filtered = filtered.filter(feedback => 
        feedback.attraction_name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        feedback.feedback_type.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        feedback.user_name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
      )
    }

    // Apply type filter
    switch (activeFilter) {
      case 'critical':
        filtered = filtered.filter(f => f.feedback_type === 'wrong_info')
        break
      case 'recent':
        filtered = filtered.slice(0, 10)
        break
      case 'high-rated':
        filtered = filtered.filter(f => f.rating && f.rating >= 4)
        break
      case 'low-rated':
        filtered = filtered.filter(f => f.rating && f.rating <= 2)
        break
      default:
        break
    }

    return filtered
  }, [stats.recentFeedbacks, debouncedSearchTerm, activeFilter])

  // Memoize filtered POIs to prevent unnecessary re-filtering
  const filteredPOIs = useMemo(() => {
    let filtered = stats.feedbacksByPOI

    if (debouncedSearchTerm) {
      filtered = filtered.filter(poi => 
        poi.attraction_name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        poi.city.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
      )
    }

    switch (activeFilter) {
      case 'critical':
        filtered = filtered.filter(poi => poi.critical_issues > 0)
        break
      case 'high-rated':
        filtered = filtered.filter(poi => poi.avg_rating >= 4)
        break
      case 'low-rated':
        filtered = filtered.filter(poi => poi.avg_rating <= 2)
        break
      default:
        break
    }

    return filtered
  }, [stats.feedbacksByPOI, debouncedSearchTerm, activeFilter])

  const getFilteredFeedbacks = () => filteredFeedbacks
  const getFilteredPOIs = () => filteredPOIs

  if (error) {
    return (
      <div className="p-6">
        <div className="tuggi-card p-8 text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-tuggi-text dark:text-white mb-2">
            Erro ao Carregar Reviews
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={fetchReviewData}
            className="inline-flex items-center px-4 py-2 bg-tuggi-blue text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 bg-tuggi-background min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-tuggi-text dark:text-white">
            Reviews & Feedbacks
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Detailed analysis of user feedback and reviews
          </p>
          {lastUpdated && !isLoading && (
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={fetchReviewData}
          disabled={isLoading}
          className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="tuggi-card p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-purple-100 dark:bg-purple-900/30">
              <MessageSquare className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Feedbacks</p>
              <p className="text-2xl font-bold text-tuggi-text dark:text-white">{stats.totalFeedbacks}</p>
            </div>
          </div>
        </div>

        <div className="tuggi-card p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-yellow-100 dark:bg-yellow-900/30">
              <Star className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Average Rating</p>
              <p className="text-2xl font-bold text-tuggi-text dark:text-white">{stats.averageRating.toFixed(1)}</p>
            </div>
          </div>
        </div>

        <div className="tuggi-card p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
              <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Critical Issues</p>
              <p className="text-2xl font-bold text-tuggi-text dark:text-white">
                {stats.feedbackByType.find(f => f.feedback_type === 'wrong_info')?.count || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="tuggi-card p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Avaliações Positivas</p>
              <p className="text-2xl font-bold text-tuggi-text dark:text-white">
                {stats.feedbackByType.find(f => f.feedback_type === 'like')?.count || 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="tuggi-card p-6">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="flex items-center space-x-2">
            <Filter className="h-5 w-5 text-gray-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filtros:</span>
            {['all', 'critical', 'recent', 'high-rated', 'low-rated'].map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter as any)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeFilter === filter
                    ? 'bg-tuggi-blue text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {filter === 'all' && 'Todos'}
                {filter === 'critical' && 'Críticos'}
                {filter === 'recent' && 'Recentes'}
                {filter === 'high-rated' && 'Bem Avaliados'}
                {filter === 'low-rated' && 'Mal Avaliados'}
              </button>
            ))}
          </div>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar POIs, tipos de feedback..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
            />
            {searchTerm !== debouncedSearchTerm && searchTerm && (
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-tuggi-blue"></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Feedback Types Chart */}
        <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
            Feedback Types
          </h3>
          {isLoading ? (
            <div className="h-80 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.feedbackByType}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="count"
                    label={({ feedback_type, percentage }) => `${feedback_type.replace(/_/g, ' ')}: ${percentage}%`}
                    labelLine={false}
                  >
                    {stats.feedbackByType.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="#fff" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'rgb(31 41 55)',
                      border: '1px solid rgb(75 85 99)',
                      borderRadius: '8px',
                      color: 'white',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Rating Distribution Chart */}
        <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
            Rating Distribution
          </h3>
          {isLoading ? (
            <div className="h-80 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.ratingDistribution} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis 
                    dataKey="rating" 
                    tick={{ fontSize: 12 }}
                    className="text-gray-600 dark:text-gray-400"
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    className="text-gray-600 dark:text-gray-400"
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'rgb(31 41 55)',
                      border: '1px solid rgb(75 85 99)',
                      borderRadius: '8px',
                      color: 'white',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                    }}
                  />
                  <Bar 
                    dataKey="count" 
                    fill="#10B981" 
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* POIs with Most Feedback */}
      <div className="tuggi-card p-6">
        <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
          POIs with Most Feedback
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-gray-400">POI</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-gray-400">City</th>
                <th className="text-center py-3 px-4 font-medium text-gray-600 dark:text-gray-400">Feedbacks</th>
                <th className="text-center py-3 px-4 font-medium text-gray-600 dark:text-gray-400">Rating</th>
                <th className="text-center py-3 px-4 font-medium text-gray-600 dark:text-gray-400">Critical Issues</th>
                <th className="text-center py-3 px-4 font-medium text-gray-600 dark:text-gray-400">Last Feedback</th>
                <th className="text-center py-3 px-4 font-medium text-gray-600 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {getFilteredPOIs().slice(0, 10).map((poi) => (
                <tr key={poi.attraction_id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="py-3 px-4">
                    <div className="font-medium text-tuggi-text dark:text-white">{poi.attraction_name}</div>
                  </td>
                  <td className="py-3 px-4 text-gray-600 dark:text-gray-400">{poi.city}</td>
                  <td className="py-3 px-4 text-center">
                    <span className="font-semibold text-tuggi-blue">{poi.total_feedbacks}</span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex items-center justify-center">
                      <Star className="h-4 w-4 text-yellow-500 fill-current mr-1" />
                      <span className="font-semibold">{poi.avg_rating.toFixed(1)}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center">
                    {poi.critical_issues > 0 ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300">
                        {poi.critical_issues}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center text-sm text-gray-600 dark:text-gray-400">
                    {poi.last_feedback}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Link
                      href={`/pois/${poi.attraction_id}`}
                      className="inline-flex items-center px-3 py-1 bg-tuggi-blue text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View POI
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Feedbacks */}
      <div className="tuggi-card p-6">
        <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
          Recent Feedbacks
        </h3>
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {getFilteredFeedbacks().map((feedback) => (
            <div key={feedback.id} className="border-l-4 border-green-500 pl-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-r transition-colors">
              <div className="flex justify-between items-start mb-2">
                <Link 
                  href={`/pois/${feedback.attraction_id}`}
                  className="text-sm font-medium text-tuggi-text dark:text-white hover:text-tuggi-blue dark:hover:text-tuggi-blue transition-colors cursor-pointer group"
                >
                  <span className="group-hover:underline">{feedback.attraction_name}</span>
                  <MapPin className="h-3 w-3 text-gray-400 group-hover:text-tuggi-blue inline ml-1 opacity-0 group-hover:opacity-100 transition-all" />
                </Link>
                {feedback.rating && (
                  <div className="flex items-center">
                    <Star className="h-3 w-3 text-yellow-500 fill-current mr-1" />
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      {feedback.rating}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-600 dark:text-gray-400 capitalize">
                  {feedback.feedback_type.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-gray-500">
                  {feedback.created_at}
                </span>
              </div>
              {feedback.feedback_details && (
                <p className="text-xs text-gray-700 dark:text-gray-300 mb-2 line-clamp-2">
                  &ldquo;{feedback.feedback_details}&rdquo;
                </p>
              )}
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">
                  By: {feedback.user_name}
                </span>
                <Link 
                  href={`/pois/${feedback.attraction_id}`}
                  className="text-xs text-tuggi-blue hover:text-tuggi-blue/80 font-medium hover:underline transition-colors"
                >
                  View POI →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
