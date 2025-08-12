'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { MapPin, CheckCircle, FileText, TrendingUp, AlertCircle, RefreshCw, Globe, ChevronDown, ChevronRight } from 'lucide-react'

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
    mostTriggeredPoints: [],
    monthlyUserGrowth: [],
    tripsByPlatform: [],
    feedbackStats: []
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set())
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

      // Parallel queries for better performance
      const [
        totalPOIsResult,
        approvedPOIsResult,
        totalDescriptionsResult,
        // User Analytics
        totalUsersResult,
        totalTripsResult,
        totalKmDrivenResult,
        totalPOIsPlayedResult,
        totalTriggerPointsActivatedResult,
        avgTripDurationResult,
        totalTripTimeResult,
        audioQualityStatsResult,
        // POI Analytics
        mostPlayedPOIsResult,
        mostTriggeredPointsResult,
        monthlyUserGrowthResult,
        tripsByPlatformResult,
        feedbackStatsResult
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
          .select('*', { count: 'exact', head: true }),
        // User Analytics
        supabase
          .schema('core')
          .from('users')
          .select('*', { count: 'exact', head: true }),
        supabase
          .schema('core')
          .from('trips')
          .select('*', { count: 'exact', head: true }),
        supabase
          .schema('core')
          .from('trips')
          .select('km_driven', { count: 'exact', head: true }),
        supabase
          .schema('core')
          .from('poi_plays')
          .select('*', { count: 'exact', head: true }),
        supabase
          .schema('core')
          .from('trigger_points_activated')
          .select('*', { count: 'exact', head: true }),
        supabase
          .schema('core')
          .from('trips')
          .select('avg_duration, total_duration', { count: 'exact', head: true }),
        supabase
          .schema('core')
          .from('trips')
          .select('total_duration', { count: 'exact', head: true }),
        supabase
          .schema('core')
          .from('audio_quality_ratings')
          .select('avg_rating, total_ratings', { count: 'exact', head: true }),
        // POI Analytics
        supabase
          .schema('core')
          .from('poi_plays')
          .select('name, city, plays, attraction_id')
          .order('plays', { ascending: false })
          .limit(5),
        supabase
          .schema('core')
          .from('trigger_points_activated')
          .select('poi_name, city, triggers, type')
          .order('triggers', { ascending: false })
          .limit(5),
        supabase
          .schema('core')
          .from('users')
          .select('created_at')
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .select('count')
          .eq('created_at', 'created_at')
          .then(res => res.count),
        supabase
          .schema('core')
          .from('trips')
          .select('platform')
          .not('platform', 'is', null)
          .select('count')
          .eq('platform', 'platform')
          .then(res => res.count),
        supabase
          .schema('core')
          .from('feedback')
          .select('feedback_type, count')
          .not('feedback_type', 'is', null)
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
      const totalUsers = totalUsersResult.count ?? 0
      const totalTrips = totalTripsResult.count ?? 0
      const totalKmDriven = totalKmDrivenResult.count ?? 0
      const totalPOIsPlayed = totalPOIsPlayedResult.count ?? 0
      const totalTriggerPointsActivated = totalTriggerPointsActivatedResult.count ?? 0
      const avgTripDuration = avgTripDurationResult.avg_duration ?? 0
      const totalTripTime = avgTripDurationResult.total_duration ?? 0
      const audioQualityStats = audioQualityStatsResult.avg_rating ?? 0

      // Process POI Analytics
      const mostPlayedPOIs = mostPlayedPOIsResult.map(poi => ({
        name: poi.name,
        city: poi.city,
        plays: poi.plays,
        attraction_id: poi.attraction_id
      }))

      const mostTriggeredPoints = mostTriggeredPointsResult.map(tp => ({
        poi_name: tp.poi_name,
        city: tp.city,
        triggers: tp.triggers,
        type: tp.type
      }))

      const monthlyUserGrowth = monthlyUserGrowthResult.map(mu => ({
        month: mu.month,
        newUsers: mu.count
      }))

      const tripsByPlatform = tripsByPlatformResult.map(tp => ({
        platform: tp.platform,
        trips: tp.count
      }))

      const feedbackStats = feedbackStatsResult.map(fs => ({
        feedback_type: fs.feedback_type,
        count: fs.count
      }))

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
        totalKmDriven,
        totalPOIsPlayed,
        totalTriggerPointsActivated,
        avgTripDuration,
        totalTripTime,
        audioQualityStats,
        // POI Analytics
        mostPlayedPOIs,
        mostTriggeredPoints,
        monthlyUserGrowth,
        tripsByPlatform,
        feedbackStats
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
              Aprovação por País e Cidade
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
            Aprovação por País e Cidade
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
                        {countryData.approved} de {countryData.total} POIs
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
                            {cityData.approved} de {cityData.total} POIs
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
                        +{citiesInCountry.length - 10} outras cidades
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

      {/* KPI Cards */}
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
          icon={FileText}
          title="Total Descriptions"
          value={stats.totalDescriptions}
          color="bg-tuggi-orange"
        />
        <StatCard
          icon={TrendingUp}
          title="Approval Rate"
          value={approvalRate}
          color="bg-purple-500"
          suffix="%"
        />
      </div>

      {/* Approval Cascade View */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ApprovalCascadeView />
        
        {/* Placeholder for future content or additional stats */}
        <div className="tuggi-card p-6">
          <div className="flex items-center mb-4">
            <TrendingUp className="h-5 w-5 text-tuggi-blue mr-2" />
            <h3 className="text-lg font-semibold text-tuggi-text dark:text-white">
              Estatísticas Adicionais
            </h3>
          </div>
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400">
              Espaço reservado para métricas futuras
            </p>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart - City Distribution */}
        <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
            POIs by City
          </h3>
          {isLoading ? (
            <div className="h-80 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
          ) : (
            <div className="h-80">
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

        {/* Pie Chart - Approval Status */}
        <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
            Approval Status
          </h3>
          {isLoading ? (
            <div className="h-80 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
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