'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { MapPin, CheckCircle, FileText, TrendingUp, AlertCircle, RefreshCw, Globe, ChevronDown, ChevronRight, Users, MessageSquare, Star, ThumbsUp, ThumbsDown, ExternalLink } from 'lucide-react'
import Link from 'next/link'

interface DashboardStats {
  totalPOIs: number
  approvedPOIs: number
  totalDescriptions: number
  cityDistribution: Array<{ city: string; count: number }>
  approvalByCountry: Array<{ country: string; total: number; approved: number; percentage: number }>
  approvalByCity: Array<{ city: string; country: string; total: number; approved: number; percentage: number }>
  // User Analytics
  totalUsers: number
  totalTrips: number
  totalKmDriven: number
  totalPOIsPlayed: number
  totalTriggerPointsActivated: number
  avgTripDuration: number
  totalTripTime: number
  audioQualityStats: { avg_rating: number; total_ratings: number }
  // POI Analytics
  mostPlayedPOIs: Array<{ name: string; city: string; plays: number; attraction_id: string }>
  mostTriggeredPoints: Array<{ poi_name: string; city: string; triggers: number; type: string }>
  monthlyUserGrowth: Array<{ month: string; newUsers: number }>
  tripsByPlatform: Array<{ platform: string; trips: number }>
  feedbackStats: Array<{ feedback_type: string; count: number }>
  // Feedback Analytics
  totalFeedbacks: number
  feedbackByType: Array<{ feedback_type: string; count: number; percentage: number }>
  averageRating: number
  ratingDistribution: Array<{ rating: number; count: number; percentage: number }>
  audioQualityDistribution: Array<{ rating: number; count: number; percentage: number }>
  timingRatingDistribution: Array<{ rating: number; count: number; percentage: number }>
  locationAccuracyDistribution: Array<{ rating: number; count: number; percentage: number }>
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
}

const COLORS = ['#10B981', '#FF6F00'] // Green for approved, Orange for pending

// Loading skeleton component
const SkeletonCard = () => (
  <div className="tuggi-card p-6 animate-pulse">
    <div className="flex items-center">
      <div className="p-3 rounded-full bg-gray-200 dark:bg-gray-700">
        <div className="h-6 w-6 bg-gray-300 dark:bg-gray-600 rounded"></div>
      </div>
      <div className="ml-4">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-2"></div>
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
      </div>
    </div>
  </div>
)

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalPOIs: 0,
    approvedPOIs: 0,
    totalDescriptions: 0,
    cityDistribution: [],
    approvalByCountry: [],
    approvalByCity: [],
    // User Analytics
    totalUsers: 0,
    totalTrips: 0,
    totalKmDriven: 0,
    totalPOIsPlayed: 0,
    totalTriggerPointsActivated: 0,
    avgTripDuration: 0,
    totalTripTime: 0,
    audioQualityStats: { avg_rating: 0, total_ratings: 0 },
    // POI Analytics
    mostPlayedPOIs: [],
    mostTriggeredPoints: [], // Will be implemented when trigger points are available
    monthlyUserGrowth: [],
    tripsByPlatform: [],
    feedbackStats: [], // Will be implemented when feedback is available
    // Feedback Analytics
    totalFeedbacks: 0,
    feedbackByType: [],
    averageRating: 0,
    ratingDistribution: [],
    audioQualityDistribution: [],
    timingRatingDistribution: [],
    locationAccuracyDistribution: [],
    recentFeedbacks: []
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set())
  const [useServiceRole, setUseServiceRole] = useState(false)
  const supabase = useSupabaseClient()

  const toggleCountryExpansion = (country: string) => {
    const newExpanded = new Set(expandedCountries)
    if (newExpanded.has(country)) {
      newExpanded.delete(country)
    } else {
      newExpanded.add(country)
    }
    setExpandedCountries(newExpanded)
  }

  const fetchDashboardData = useCallback(async () => {
    try {
      setError(null)
      setIsLoading(true)

      const daysAgo = new Date()
      daysAgo.setDate(daysAgo.getDate() - 30) // Last 30 days
      const dateFilter = daysAgo.toISOString()

      // Parallel queries for better performance
      const [
        totalPOIsResult,
        approvedPOIsResult,
        totalDescriptionsResult
      ] = await Promise.all([
        // Fetch total POIs
        supabase
          .schema('core')
          .from('attractions')
          .select('*', { count: 'exact', head: true }),

        // Fetch approved POIs
        supabase
          .schema('core')
          .from('attractions')
          .select('*', { count: 'exact', head: true })
          .eq('approved', true),

        // Fetch total descriptions
        supabase
          .schema('core')
          .from('attraction_descriptions')
          .select('*', { count: 'exact', head: true })
      ])

      // Fetch country stats with pagination
      let allCountryData: any[] = []
      let hasMoreCountries = true
      let countryPage = 0
      const pageSize = 1000
      
      while (hasMoreCountries) {
        const { data: countryDataChunk, error: countryError } = await supabase
          .schema('core')
          .from('attractions')
          .select('country, approved')
          .not('country', 'is', null)
          .range(countryPage * pageSize, (countryPage + 1) * pageSize - 1)
        
        if (countryError) {
          console.error('Error fetching country data:', countryError)
          break
        }
        
        if (countryDataChunk && countryDataChunk.length > 0) {
          allCountryData = [...allCountryData, ...countryDataChunk]
          countryPage++
        } else {
          hasMoreCountries = false
        }
        
        // Safety check to prevent infinite loops
        if (countryPage > 10) {
          hasMoreCountries = false
        }
      }

      // Fetch city stats with pagination
      let allCityData: any[] = []
      let hasMoreCities = true
      let cityPage = 0
      
      while (hasMoreCities) {
        const { data: cityDataChunk, error: cityError } = await supabase
          .schema('core')
          .from('attractions')
          .select('city, country, approved')
          .not('city', 'is', null)
          .not('country', 'is', null)
          .range(cityPage * pageSize, (cityPage + 1) * pageSize - 1)
        
        if (cityError) {
          console.error('Error fetching city data:', cityError)
          break
        }
        
        if (cityDataChunk && cityDataChunk.length > 0) {
          allCityData = [...allCityData, ...cityDataChunk]
          cityPage++
        } else {
          hasMoreCities = false
        }
        
        // Safety check to prevent infinite loops
        if (cityPage > 10) {
          hasMoreCities = false
        }
      }
      
      // Fetch city distribution in chunks to overcome the 1000 item limit
      let allCityDistributionData: any[] = []
      let hasMore = true
      let page = 0
      
      while (hasMore) {
        const { data: cityDataChunk, error } = await supabase
          .schema('core')
          .from('attractions')
          .select('city')
          .not('city', 'is', null)
          .range(page * pageSize, (page + 1) * pageSize - 1)
        
        if (error) {
          console.error('Error fetching city data:', error)
          break
        }
        
        if (cityDataChunk && cityDataChunk.length > 0) {
          allCityDistributionData = [...allCityDistributionData, ...cityDataChunk]
          page++
        } else {
          hasMore = false
        }
        
        // Safety check to prevent infinite loops
        if (page > 10) {
          hasMore = false
        }
      }

      // Fetch User Analytics with pagination
      let allUsersData: any[] = []
      let hasMoreUsers = true
      let userPage = 0
      
      while (hasMoreUsers) {
        const { data: userDataChunk, error: userError } = await supabase
          .schema('drive')
          .from('profiles')
          .select('*')
          .range(userPage * pageSize, (userPage + 1) * pageSize - 1)
        
        if (userError) {
          console.error('Error fetching user data:', userError)
          break
        }
        
        if (userDataChunk && userDataChunk.length > 0) {
          allUsersData = [...allUsersData, ...userDataChunk]
          userPage++
        } else {
          hasMoreUsers = false
        }
        
        if (userPage > 10) {
          hasMoreUsers = false
        }
      }

      // Debug: Log user count for troubleshooting
      console.log('🔍 Dashboard Debug - Users found:', allUsersData.length)
      console.log('🔍 Dashboard Debug - User data sample:', allUsersData.slice(0, 3))

      // Alternative: Try with service role if user count seems wrong
      if (allUsersData.length < 5) {
        console.log('⚠️ Warning: Low user count detected, this might be an RLS issue')
        
        // Try to get a count using a different approach
        const { count: userCount, error: countError } = await supabase
          .schema('drive')
          .from('profiles')
          .select('*', { count: 'exact', head: true })
        
        console.log('🔍 Dashboard Debug - Direct count result:', { userCount, countError })
        
        if (userCount && userCount > allUsersData.length) {
          console.log('⚠️ RLS issue confirmed: Direct count shows', userCount, 'but pagination returned', allUsersData.length)
        }
      }

      // Fetch Trip Analytics with pagination
      let allTripsData: any[] = []
      let hasMoreTrips = true
      let tripPage = 0
      
      while (hasMoreTrips) {
        const { data: tripDataChunk, error: tripError } = await supabase
          .schema('drive')
          .from('trip_sessions')
          .select('duration, distance_km, platform')
          .gte('start_time', dateFilter)
          .not('end_time', 'is', null)
          .range(tripPage * pageSize, (tripPage + 1) * pageSize - 1)
        
        if (tripError) {
          console.error('Error fetching trip data:', tripError)
          break
        }
        
        if (tripDataChunk && tripDataChunk.length > 0) {
          allTripsData = [...allTripsData, ...tripDataChunk]
          tripPage++
        } else {
          hasMoreTrips = false
        }
        
        if (tripPage > 10) {
          hasMoreTrips = false
        }
      }

      // Fetch POI Plays with pagination
      let allPOIPlaysData: any[] = []
      let hasMorePOIPlays = true
      let poiPlaysPage = 0
      
      while (hasMorePOIPlays) {
        const { data: poiPlaysChunk, error: poiPlaysError } = await supabase
          .schema('drive')
          .from('trip_session_attractions')
          .select('attraction_id')
          .gte('played_at', dateFilter)
          .range(poiPlaysPage * pageSize, (poiPlaysPage + 1) * pageSize - 1)
        
        if (poiPlaysError) {
          console.error('Error fetching POI plays data:', poiPlaysError)
          break
        }
        
        if (poiPlaysChunk && poiPlaysChunk.length > 0) {
          allPOIPlaysData = [...allPOIPlaysData, ...poiPlaysChunk]
          poiPlaysPage++
        } else {
          hasMorePOIPlays = false
        }
        
        if (poiPlaysPage > 10) {
          hasMorePOIPlays = false
        }
      }

      // Extract counts with better error handling
      const totalPOIs = totalPOIsResult.count ?? 0
      const approvedPOIs = approvedPOIsResult.count ?? 0
      const totalDescriptions = totalDescriptionsResult.count ?? 0

      // Process all city data collected from pagination
      const cityDistribution = allCityDistributionData.reduce((acc: Record<string, number>, item) => {
        if (item.city) {
          acc[item.city] = (acc[item.city] || 0) + 1
        }
        return acc
      }, {})

      const cityDistributionArray = Object.entries(cityDistribution)
        .map(([city, count]) => ({ city, count: count as number }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10) // Top 10 cities

      // Process approval stats by country
      const countryStats = allCountryData.reduce((acc: Record<string, { total: number; approved: number }>, item) => {
        if (item.country) {
          if (!acc[item.country]) {
            acc[item.country] = { total: 0, approved: 0 }
          }
          acc[item.country].total++
          if (item.approved) {
            acc[item.country].approved++
          }
        }
        return acc
      }, {})

      const approvalByCountry = Object.entries(countryStats)
        .map(([country, stats]) => ({
          country,
          total: stats.total,
          approved: stats.approved,
          percentage: Math.round((stats.approved / stats.total) * 100)
        }))
        .sort((a, b) => b.total - a.total)

      // Process approval stats by city with country
      const cityStats = allCityData.reduce((acc: Record<string, { total: number; approved: number; country: string }>, item) => {
        if (item.city && item.country) {
          const key = `${item.city}-${item.country}`
          if (!acc[key]) {
            acc[key] = { total: 0, approved: 0, country: item.country }
          }
          acc[key].total++
          if (item.approved) {
            acc[key].approved++
          }
        }
        return acc
      }, {})

      const approvalByCity = Object.entries(cityStats)
        .map(([key, stats]) => {
          const [city] = key.split('-')
          return {
            city,
            country: stats.country,
            total: stats.total,
            approved: stats.approved,
            percentage: Math.round((stats.approved / stats.total) * 100)
          }
        })
        .sort((a, b) => b.total - a.total)

      // Process User Analytics
      const totalUsers = allUsersData.length
      const totalTrips = allTripsData.length
      const totalKmDriven = allTripsData.reduce((acc, trip) => acc + (trip.distance_km || 0), 0)
      const totalPOIsPlayed = allPOIPlaysData.length
      const totalTriggerPointsActivated = 0 // Will be implemented when trigger points are available

      // Calculate average trip duration
      let totalTripTimeMinutes = 0
      const avgTripDuration = allTripsData.length > 0 
        ? allTripsData.reduce((acc, trip) => {
            if (trip.duration) {
              const match = trip.duration.match(/(\d+):(\d+):(\d+)/)
              if (match) {
                const hours = parseInt(match[1])
                const minutes = parseInt(match[2])
                const tripMinutes = hours * 60 + minutes
                totalTripTimeMinutes += tripMinutes
                return acc + tripMinutes
              }
            }
            return acc
          }, 0) / allTripsData.length
        : 0

      // Process platform data
      const platformCounts = allTripsData.reduce((acc: Record<string, number>, trip) => {
        acc[trip.platform] = (acc[trip.platform] || 0) + 1
        return acc
      }, {})
      const tripsByPlatform = Object.entries(platformCounts)
        .map(([platform, trips]) => ({ platform: platform || 'Unknown', trips: trips as number }))

      // Process most played POIs
      const poiCounts = allPOIPlaysData.reduce((acc: Record<string, number>, item) => {
        acc[item.attraction_id] = (acc[item.attraction_id] || 0) + 1
        return acc
      }, {})
      
      const topPoiIds = Object.keys(poiCounts).sort((a, b) => poiCounts[b] - poiCounts[a]).slice(0, 5)
      const poiDetailsResult = topPoiIds.length > 0 ? await supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city')
        .in('id', topPoiIds) : { data: [] }
      
      const poiDetails = (poiDetailsResult.data ?? []).reduce((acc: Record<string, any>, poi) => {
        acc[poi.id] = poi
        return acc
      }, {})
      
      const mostPlayedPOIs = topPoiIds.map(id => ({
        attraction_id: id,
        name: poiDetails[id]?.name || 'Unknown',
        city: poiDetails[id]?.city || 'Unknown',
        plays: poiCounts[id]
      }))

      // Process monthly user growth
      const monthlyGrowth = allUsersData.reduce((acc: Record<string, number>, user) => {
        const date = new Date(user.created_at)
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        acc[monthKey] = (acc[monthKey] || 0) + 1
        return acc
      }, {})
      
      const monthlyUserGrowth = Object.entries(monthlyGrowth)
        .map(([month, newUsers]) => ({ 
          month: new Date(month + '-01').toLocaleDateString('en-US', { year: 'numeric', month: 'short' }), 
          newUsers: newUsers as number 
        }))
        .sort((a, b) => new Date(a.month + ' 1, 2000').getTime() - new Date(b.month + ' 1, 2000').getTime())

      // Fetch Feedback Analytics with pagination
      let allFeedbacksData: any[] = []
      let hasMoreFeedbacks = true
      let feedbackPage = 0
      
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

      // Audio quality distribution
      const audioQualityMap = allFeedbacksData.reduce((acc: Record<number, number>, feedback) => {
        if (feedback.audio_quality_rating !== null) {
          acc[feedback.audio_quality_rating] = (acc[feedback.audio_quality_rating] || 0) + 1
        }
        return acc
      }, {})
      
      const audioQualityDistribution = Object.entries(audioQualityMap).map(([rating, count]) => ({
        rating: parseInt(rating),
        count: count as number,
        percentage: Math.round(((count as number) / Object.values(audioQualityMap).reduce((sum, c) => sum + c, 0)) * 100)
      })).sort((a, b) => a.rating - b.rating)

      // Timing rating distribution
      const timingRatingMap = allFeedbacksData.reduce((acc: Record<number, number>, feedback) => {
        if (feedback.timing_rating !== null) {
          acc[feedback.timing_rating] = (acc[feedback.timing_rating] || 0) + 1
        }
        return acc
      }, {})
      
      const timingRatingDistribution = Object.entries(timingRatingMap).map(([rating, count]) => ({
        rating: parseInt(rating),
        count: count as number,
        percentage: Math.round(((count as number) / Object.values(timingRatingMap).reduce((sum, c) => sum + c, 0)) * 100)
      })).sort((a, b) => a.rating - b.rating)

      // Location accuracy distribution
      const locationAccuracyMap = allFeedbacksData.reduce((acc: Record<number, number>, feedback) => {
        if (feedback.location_accuracy_rating !== null) {
          acc[feedback.location_accuracy_rating] = (acc[feedback.location_accuracy_rating] || 0) + 1
        }
        return acc
      }, {})
      
      const locationAccuracyDistribution = Object.entries(locationAccuracyMap).map(([rating, count]) => ({
        rating: parseInt(rating),
        count: count as number,
        percentage: Math.round(((count as number) / Object.values(locationAccuracyMap).reduce((sum, c) => sum + c, 0)) * 100)
      })).sort((a, b) => a.rating - b.rating)

      // Get recent feedbacks with attraction names
      const recentFeedbacksWithDetails = await Promise.all(
        allFeedbacksData
          .slice(0, 10)
          .map(async (feedback) => {
            // Get attraction name
            const { data: attractionData } = await supabase
              .schema('core')
              .from('attractions')
              .select('name')
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
               created_at: new Date(feedback.created_at).toLocaleDateString('en-US', { 
                 year: 'numeric', 
                 month: 'short', 
                 day: 'numeric', 
                 hour: '2-digit', 
                 minute: '2-digit' 
               }),
               attraction_id: feedback.attraction_id,
               attraction_name: attractionData?.name || 'POI not found',
               user_name: userData?.full_name || userData?.nickname || 'User'
             }
          })
      )

      const newStats = {
        totalPOIs,
        approvedPOIs,
        totalDescriptions,
        cityDistribution: cityDistributionArray,
        approvalByCountry,
        approvalByCity,
        // User Analytics
        totalUsers,
        totalTrips,
        totalKmDriven: Math.round(totalKmDriven),
        totalPOIsPlayed,
        totalTriggerPointsActivated,
        avgTripDuration: Math.round(avgTripDuration),
        totalTripTime: Math.round(totalTripTimeMinutes),
        audioQualityStats: { avg_rating: 0, total_ratings: 0 }, // Will be implemented when available
        // POI Analytics
        mostPlayedPOIs,
        mostTriggeredPoints: [], // Will be implemented when trigger points are available
        monthlyUserGrowth,
        tripsByPlatform,
        feedbackStats: [], // Will be implemented when feedback is available
        // Feedback Analytics
        totalFeedbacks,
        feedbackByType,
        averageRating,
        ratingDistribution,
        audioQualityDistribution,
        timingRatingDistribution,
        locationAccuracyDistribution,
        recentFeedbacks: recentFeedbacksWithDetails
      }

      setStats(newStats)
      setLastUpdated(new Date())
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
      setError('Failed to load dashboard data. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchDashboardData()
    
    // Set up auto-refresh every 5 minutes
    const interval = setInterval(fetchDashboardData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchDashboardData])

  const StatCard = ({ icon: Icon, title, value, color, suffix = '' }: {
    icon: any
    title: string
    value: number
    color: string
    suffix?: string
  }) => {
    const displayValue = typeof value === 'number' ? value : 0
    
    return (
      <div className="tuggi-card p-6 hover:shadow-md transition-shadow duration-200">
        <div className="flex items-center">
          <div className={`p-3 rounded-full ${color} shadow-sm`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {title}
            </p>
            <p className="text-2xl font-bold text-tuggi-text dark:text-white">
              {isLoading ? (
                <span className="inline-block h-8 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></span>
              ) : (
                `${displayValue.toLocaleString()}${suffix}`
              )}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const ApprovalCascadeView = () => {
    if (isLoading) {
      return (
        <div className="tuggi-card p-6">
          <div className="flex items-center mb-4">
            <Globe className="h-5 w-5 text-tuggi-blue mr-2" />
            <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
              Approval by Country and City
            </h3>
          </div>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-2"></div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div className="tuggi-card p-6">
        <div className="flex items-center mb-4">
          <Globe className="h-5 w-5 text-tuggi-blue mr-2" />
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
            Approval by Country and City
          </h3>
        </div>
        <div className="space-y-4">
          {stats.approvalByCountry.map((countryData) => {
            const citiesInCountry = stats.approvalByCity.filter(city => city.country === countryData.country)
            const isExpanded = expandedCountries.has(countryData.country)
            
            return (
              <div key={countryData.country} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                {/* Country Header */}
                <div 
                  className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  onClick={() => toggleCountryExpansion(countryData.country)}
                >
                  <div className="flex items-center">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-gray-500 mr-2" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-500 mr-2" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium text-tuggi-text dark:text-white">
                        {countryData.country}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {countryData.approved} of {countryData.total} POIs
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <div className="w-20 bg-gray-200 dark:bg-gray-700 rounded-full h-2 mr-3">
                      <div 
                        className="bg-green-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${countryData.percentage}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-medium text-tuggi-text dark:text-white min-w-[3rem]">
                      {countryData.percentage}%
                    </span>
                  </div>
                </div>
                
                {/* Cities List */}
                {isExpanded && citiesInCountry.length > 0 && (
                  <div className="border-t border-gray-200 dark:border-gray-700">
                    {citiesInCountry.slice(0, 10).map((cityData, index) => (
                      <div key={cityData.city} className="flex items-center justify-between p-3 pl-8 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        <div className="flex-1">
                          <p className="font-medium text-tuggi-text dark:text-white">
                            {cityData.city}
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {cityData.approved} of {cityData.total} POIs
                          </p>
                        </div>
                        <div className="flex items-center">
                          <div className="w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-2 mr-2">
                            <div 
                              className="bg-green-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${cityData.percentage}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-medium text-tuggi-text dark:text-white min-w-[3rem]">
                            {cityData.percentage}%
                          </span>
                        </div>
                      </div>
                    ))}
                    {citiesInCountry.length > 10 && (
                      <div className="p-3 pl-8 text-sm text-gray-500 dark:text-gray-400">
                        +{citiesInCountry.length - 10} other cities
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const UserAnalyticsCard = () => {
    if (isLoading) {
      return (
        <div className="tuggi-card p-6">
          <div className="flex items-center mb-4">
            <Users className="h-5 w-5 text-tuggi-blue mr-2" />
            <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
              User Statistics
            </h3>
          </div>
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-2"></div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div className="tuggi-card p-6">
        <div className="flex items-center mb-4">
          <Users className="h-5 w-5 text-tuggi-blue mr-2" />
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
            User Statistics
          </h3>
        </div>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-400">Total Users</span>
            <span className="text-sm font-semibold text-tuggi-text dark:text-white">
              {stats.totalUsers.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-400">Total Trips</span>
            <span className="text-sm font-semibold text-tuggi-text dark:text-white">
              {stats.totalTrips.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-400">Total Distance</span>
            <span className="text-sm font-semibold text-tuggi-text dark:text-white">
              {stats.totalKmDriven.toLocaleString()} km
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-400">Average Duration</span>
            <span className="text-sm font-semibold text-tuggi-text dark:text-white">
              {stats.avgTripDuration} min
            </span>
          </div>
        </div>
      </div>
    )
  }

  const UserGrowthCard = () => {
    if (isLoading) {
      return (
        <div className="tuggi-card p-6">
          <div className="flex items-center mb-4">
            <TrendingUp className="h-5 w-5 text-green-500 mr-2" />
            <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
              User Growth
            </h3>
          </div>
          <div className="h-48 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
        </div>
      )
    }

    return (
      <div className="tuggi-card p-6">
        <div className="flex items-center mb-4">
          <TrendingUp className="h-5 w-5 text-green-500 mr-2" />
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
            New Users per Month
          </h3>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.monthlyUserGrowth} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis 
                dataKey="month" 
                tick={{ fontSize: 10 }}
                angle={-45}
                textAnchor="end"
                height={40}
              />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip 
                contentStyle={{
                  backgroundColor: 'rgb(31 41 55)',
                  border: '1px solid rgb(75 85 99)',
                  borderRadius: '8px',
                  color: 'white'
                }}
                formatter={(value, name) => [`${value} new users`, 'New Users']}
              />
              <Bar dataKey="newUsers" fill="#10B981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    )
  }

  const POIAnalyticsCard = () => {
    if (isLoading) {
      return (
        <div className="tuggi-card p-6">
          <div className="flex items-center mb-4">
            <MapPin className="h-5 w-5 text-tuggi-orange mr-2" />
            <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
              POI Statistics
            </h3>
          </div>
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-2"></div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div className="tuggi-card p-6">
        <div className="flex items-center mb-4">
          <MapPin className="h-5 w-5 text-tuggi-orange mr-2" />
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
            POI Statistics
          </h3>
        </div>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-400">POIs Played</span>
            <span className="text-sm font-semibold text-tuggi-text dark:text-white">
              {stats.totalPOIsPlayed.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-400">Trigger Points Activated</span>
            <span className="text-sm font-semibold text-tuggi-text dark:text-white">
              {stats.totalTriggerPointsActivated.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-400">Audio Quality</span>
            <span className="text-sm font-semibold text-tuggi-text dark:text-white">
              {stats.audioQualityStats.avg_rating}/5
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-400">Audio Ratings</span>
            <span className="text-sm font-semibold text-tuggi-text dark:text-white">
              {stats.audioQualityStats.total_ratings}
            </span>
          </div>
        </div>
      </div>
    )
  }

  const MostPlayedPOIsCard = () => {
    if (isLoading) {
      return (
        <div className="tuggi-card p-6">
          <div className="flex items-center mb-4">
            <MapPin className="h-5 w-5 text-tuggi-orange mr-2" />
            <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
              Most Played POIs
            </h3>
          </div>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-2"></div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div className="tuggi-card p-6">
        <div className="flex items-center mb-4">
          <MapPin className="h-5 w-5 text-tuggi-orange mr-2" />
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
            Most Played POIs
          </h3>
        </div>
        <div className="space-y-3">
          {stats.mostPlayedPOIs.slice(0, 5).map((poi, index) => (
            <div key={poi.attraction_id} className="flex justify-between items-center p-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded transition-colors group">
              <div className="flex-1">
                <a 
                  href={`/pois/${poi.attraction_id}`}
                  className="text-sm font-medium text-tuggi-text dark:text-white hover:text-tuggi-blue dark:hover:text-tuggi-blue transition-colors cursor-pointer group-hover:underline truncate block"
                >
                  {poi.name}
                </a>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {poi.city}
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-semibold text-tuggi-orange">
                  {poi.plays} plays
                </span>
                <a 
                  href={`/pois/${poi.attraction_id}`}
                  className="text-xs text-tuggi-blue hover:text-tuggi-blue/80 opacity-0 group-hover:opacity-100 transition-all"
                >
                  →
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const PlatformAnalyticsCard = () => {
    if (isLoading) {
      return (
        <div className="tuggi-card p-6">
          <div className="flex items-center mb-4">
            <TrendingUp className="h-5 w-5 text-green-500 mr-2" />
            <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
              Trips by Platform
            </h3>
          </div>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-2"></div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div className="tuggi-card p-6">
        <div className="flex items-center mb-4">
          <TrendingUp className="h-5 w-5 text-green-500 mr-2" />
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
            Trips by Platform
          </h3>
        </div>
        <div className="space-y-3">
          {stats.tripsByPlatform.slice(0, 5).map((platform, index) => (
            <div key={platform.platform} className="flex justify-between items-center">
              <span className="text-sm text-gray-600 dark:text-gray-400 capitalize">
                {platform.platform}
              </span>
              <span className="text-sm font-semibold text-green-500">
                {platform.trips} trips
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Feedback Analytics Components
  const FeedbackOverviewCard = () => {
    return (
      <div className="tuggi-card p-6">
        <div className="flex items-center mb-4">
          <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
            <MessageSquare className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </div>
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
            Feedback Overview
          </h3>
        </div>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-400">Total Feedbacks</span>
            <span className="text-lg font-semibold text-purple-600 dark:text-purple-400">
              {stats.totalFeedbacks}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-400">Average Rating</span>
            <div className="flex items-center">
              <Star className="h-4 w-4 text-yellow-500 mr-1" />
              <span className="text-lg font-semibold text-yellow-600 dark:text-yellow-400">
                {stats.averageRating.toFixed(1)}
              </span>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-400">Last 30 days</span>
            <span className="text-sm font-semibold text-green-500">
              {stats.feedbackByType.length > 0 ? 
                stats.feedbackByType.reduce((sum, type) => sum + type.count, 0) : 0
              }
            </span>
          </div>
        </div>
      </div>
    )
  }

  const FeedbackByTypeCard = () => {
    return (
      <div className="tuggi-card p-6">
        <div className="flex items-center mb-4">
          <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
            <ThumbsUp className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          </div>
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
            Feedback by Type
          </h3>
        </div>
        <div className="space-y-3">
          {stats.feedbackByType.slice(0, 6).map((feedback) => (
            <div key={feedback.feedback_type} className="flex justify-between items-center p-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded transition-colors">
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600 dark:text-gray-400 capitalize">
                  {feedback.feedback_type.replace(/_/g, ' ')}
                </span>
                {feedback.feedback_type === 'wrong_info' && (
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full">
                    Critical
                  </span>
                )}
                {feedback.feedback_type === 'audio_quality_poor' && (
                  <span className="text-xs bg-yellow-100 text-yellow-600 px-2 py-1 rounded-full">
                    Audio
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-semibold text-orange-600 dark:text-orange-400">
                  {feedback.count}
                </span>
                <span className="text-xs text-gray-500">
                  ({feedback.percentage}%)
                </span>
              </div>
            </div>
          ))}
        </div>
        {stats.feedbackByType.some(f => f.feedback_type === 'wrong_info') && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-xs text-red-700 dark:text-red-300">
              ⚠️ <strong>POIs with incorrect information</strong> need immediate attention
            </p>
          </div>
        )}
      </div>
    )
  }

  const RatingDistributionCard = () => {
    return (
      <div className="tuggi-card p-6">
        <div className="flex items-center mb-4">
          <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
            <Star className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
          </div>
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
            Rating Distribution
          </h3>
        </div>
        <div className="space-y-3">
          {stats.ratingDistribution.map((rating) => (
            <div key={rating.rating} className="flex items-center space-x-3">
              <div className="flex items-center space-x-1">
                {[...Array(5)].map((_, i) => (
                  <Star 
                    key={i} 
                    className={`h-3 w-3 ${i < rating.rating ? 'text-yellow-500 fill-current' : 'text-gray-300'}`} 
                  />
                ))}
              </div>
              <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div 
                  className="bg-yellow-500 h-2 rounded-full" 
                  style={{ width: `${rating.percentage}%` }}
                ></div>
              </div>
              <span className="text-sm font-semibold text-gray-600 dark:text-gray-400 min-w-[3rem]">
                {rating.count}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const RecentFeedbacksCard = () => {
    return (
      <div className="tuggi-card p-6">
        <div className="flex items-center mb-4">
          <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
            <MessageSquare className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
            Recent Feedbacks
          </h3>
        </div>
        <div className="space-y-3 max-h-64 overflow-y-auto">
          {stats.recentFeedbacks.length > 0 ? (
            stats.recentFeedbacks.map((feedback) => (
              <div key={feedback.id} className="border-l-4 border-green-500 pl-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-r transition-colors">
                <div className="flex justify-between items-start mb-1">
                  <a 
                    href={`/pois/${feedback.attraction_id}`}
                    className="text-sm font-medium text-tuggi-text dark:text-white hover:text-tuggi-blue dark:hover:text-tuggi-blue transition-colors cursor-pointer group"
                  >
                    <span className="group-hover:underline">{feedback.attraction_name}</span>
                    <MapPin className="h-3 w-3 text-gray-400 group-hover:text-tuggi-blue inline ml-1 opacity-0 group-hover:opacity-100 transition-all" />
                  </a>
                  {feedback.rating && (
                    <div className="flex items-center">
                      <Star className="h-3 w-3 text-yellow-500 fill-current mr-1" />
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        {feedback.rating}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-600 dark:text-gray-400 capitalize">
                    {feedback.feedback_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-gray-500">
                    {feedback.created_at}
                  </span>
                </div>
                {feedback.feedback_details && (
                  <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 line-clamp-2">
                    &ldquo;{feedback.feedback_details}&rdquo;
                  </p>
                )}
                <div className="flex justify-between items-center mt-1">
                  <span className="text-xs text-gray-500">
                    By: {feedback.user_name}
                  </span>
                  <a 
                    href={`/pois/${feedback.attraction_id}`}
                    className="text-xs text-tuggi-blue hover:text-tuggi-blue/80 dark:text-tuggi-blue dark:hover:text-tuggi-blue/80 font-medium hover:underline transition-colors"
                  >
                    View POI →
                  </a>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-4">
              <MessageSquare className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No recent feedback</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  const approvalRate = stats.totalPOIs > 0 ? Math.round((stats.approvedPOIs / stats.totalPOIs) * 100) : 0

  const pieData = [
    { name: 'Approved', value: stats.approvedPOIs, percentage: approvalRate },
    { name: 'Pending', value: stats.totalPOIs - stats.approvedPOIs, percentage: 100 - approvalRate }
  ]

  if (error) {
    return (
      <div className="p-6">
        <div className="tuggi-card p-8 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-tuggi-text dark:text-white mb-2">
            Error Loading Dashboard
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={fetchDashboardData}
            className="inline-flex items-center px-4 py-2 bg-tuggi-blue text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
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
            Dashboard
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Overview of your POI management system
          </p>
          {lastUpdated && !isLoading && (
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={fetchDashboardData}
          disabled={isLoading}
          className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Main KPIs - Reduced to 4 most important */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={MapPin}
          title="Total POIs"
          value={stats.totalPOIs}
          color="bg-tuggi-blue"
        />
        <StatCard
          icon={CheckCircle}
          title="Approved POIs"
          value={stats.approvedPOIs}
          color="bg-green-500"
        />
        <StatCard
          icon={TrendingUp}
          title="Approval Rate"
          value={approvalRate}
          color="bg-purple-500"
          suffix="%"
        />
        <StatCard
          icon={Users}
          title="Total Users"
          value={stats.totalUsers}
          color="bg-indigo-500"
        />
      </div>

      {/* Main Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: POIs by City Chart */}
        <div className="lg:col-span-2">
          <div className="tuggi-card p-6 h-full">
            <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
              POIs by City
            </h3>
            {isLoading ? (
              <div className="h-[calc(100%-4rem)] bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
            ) : (
              <div className="h-[calc(100%-4rem)]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.cityDistribution} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="city" 
                      tick={{ fontSize: 12 }}
                      className="text-gray-600 dark:text-gray-400"
                      angle={-45}
                      textAnchor="end"
                      height={60}
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
                      fill="#00A8E8" 
                      radius={[4, 4, 0, 0]}
                      stroke="#0096D1"
                      strokeWidth={1}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Right: Approval Status + Quick Stats */}
        <div className="flex flex-col h-full">
          {/* Approval Status Pie Chart */}
          <div className="tuggi-card p-6 flex-1">
            <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
              Approval Status
            </h3>
            {isLoading ? (
              <div className="h-[calc(100%-4rem)] bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
            ) : (
              <div className="h-[calc(100%-4rem)]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ name, percentage }) => `${name}: ${percentage}%`}
                      labelLine={false}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index]} stroke="#fff" strokeWidth={2} />
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
                      formatter={(value, name) => [`${value} POIs`, name]}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Quick Stats */}
          <div className="tuggi-card p-6 mt-6">
            <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
              Quick Stats
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Total Descriptions</span>
                <span className="text-sm font-semibold text-tuggi-orange">{stats.totalDescriptions}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Total Feedbacks</span>
                <span className="text-sm font-semibold text-indigo-600">{stats.totalFeedbacks}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Total Trips</span>
                <span className="text-sm font-semibold text-green-600">{stats.totalTrips}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">POIs Played</span>
                <span className="text-sm font-semibold text-blue-600">{stats.totalPOIsPlayed}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Sections - Reorganized */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: User Analytics */}
        <div className="space-y-6">
          <h3 className="text-xl font-semibold text-tuggi-text dark:text-white flex items-center">
            <Users className="h-6 w-6 text-tuggi-blue mr-2" />
            User Analytics
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UserAnalyticsCard />
            <UserGrowthCard />
          </div>
          
          <PlatformAnalyticsCard />
        </div>

        {/* Right Column: POI Analytics */}
        <div className="space-y-6">
          <h3 className="text-xl font-semibold text-tuggi-text dark:text-white flex items-center">
            <MapPin className="h-6 w-6 text-tuggi-orange mr-2" />
            POI Analytics
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <POIAnalyticsCard />
            <MostPlayedPOIsCard />
          </div>
        </div>
      </div>

                {/* Feedback Analytics - Summary */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-tuggi-text dark:text-white flex items-center">
                <MessageSquare className="h-6 w-6 text-purple-600 mr-2" />
                Feedback Analytics
              </h3>
              <Link
                href="/reviews"
                className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Detailed Analysis
              </Link>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <FeedbackOverviewCard />
              <FeedbackByTypeCard />
              <RecentFeedbacksCard />
            </div>
          </div>

      {/* Approval Cascade View - Full Width */}
      <div className="tuggi-card p-6">
        <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4 flex items-center">
          <Globe className="h-5 w-5 text-green-600 mr-2" />
          Approval by Country and City
        </h3>
        <ApprovalCascadeView />
      </div>

      {/* Quick Actions */}
      <div className="tuggi-card p-6">
        <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
          Quick Actions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a
            href="/pois/new"
            className="group flex items-center p-4 bg-tuggi-blue/10 rounded-lg hover:bg-tuggi-blue/20 transition-all duration-200 border border-tuggi-blue/20 hover:border-tuggi-blue/30 hover:shadow-md"
          >
            <MapPin className="h-8 w-8 text-tuggi-blue mr-3 group-hover:scale-110 transition-transform duration-200" />
            <div>
              <p className="font-medium text-tuggi-text dark:text-white">Add New POI</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Create a new point of interest</p>
            </div>
          </a>
          
          <a
            href="/pois?filter=pending"
            className="group flex items-center p-4 bg-tuggi-orange/10 rounded-lg hover:bg-tuggi-orange/20 transition-all duration-200 border border-tuggi-orange/20 hover:border-tuggi-orange/30 hover:shadow-md"
          >
            <CheckCircle className="h-8 w-8 text-tuggi-orange mr-3 group-hover:scale-110 transition-transform duration-200" />
            <div>
              <p className="font-medium text-tuggi-text dark:text-white">Review Pending</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {stats.totalPOIs - stats.approvedPOIs > 0 ? 
                  `${stats.totalPOIs - stats.approvedPOIs} POIs awaiting review` : 
                  'No pending POIs'
                }
              </p>
            </div>
          </a>
          
          <a
            href="/analytics"
            className="group flex items-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-all duration-200 border border-green-200 dark:border-green-700 hover:shadow-md"
          >
            <TrendingUp className="h-8 w-8 text-green-600 dark:text-green-400 mr-3 group-hover:scale-110 transition-transform duration-200" />
            <div>
              <p className="font-medium text-tuggi-text dark:text-white">View Analytics</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Check performance metrics</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  )
}