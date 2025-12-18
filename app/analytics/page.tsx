'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line, AreaChart, Area } from 'recharts'
import { MapPin, Users, TrendingUp, Clock, Navigation, Star, Activity, RefreshCw, AlertCircle, Calendar, Target, Volume2 } from 'lucide-react'

interface AnalyticsData {
  totalUsers: number
  totalTrips: number
  totalKmDriven: number
  totalPOIsPlayed: number
  totalTriggerPointsActivated: number
  avgTripDuration: number
  totalTripTime: number
  mostPlayedPOIs: Array<{ name: string; city: string; plays: number; attraction_id: string }>
  mostTriggeredPoints: Array<{ poi_name: string; city: string; triggers: number; type: string }>
  userGrowth: Array<{ date: string; users: number }>
  monthlyUserGrowth: Array<{ month: string; newUsers: number }>
  tripsByPlatform: Array<{ platform: string; trips: number }>
  feedbackStats: Array<{ feedback_type: string; count: number }>
  topCities: Array<{ city: string; pois: number; trips: number }>
  audioQualityStats: { avg_rating: number; total_ratings: number }
}

const COLORS = ['#00A8E8', '#FF6F00', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444']

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

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData>({
    totalUsers: 0,
    totalTrips: 0,
    totalKmDriven: 0,
    totalPOIsPlayed: 0,
    totalTriggerPointsActivated: 0,
    avgTripDuration: 0,
    totalTripTime: 0,
    mostPlayedPOIs: [],
    mostTriggeredPoints: [],
    userGrowth: [],
    monthlyUserGrowth: [],
    tripsByPlatform: [],
    feedbackStats: [],
    topCities: [],
    audioQualityStats: { avg_rating: 0, total_ratings: 0 }
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [timeRange, setTimeRange] = useState('30') // days
  const supabase = useSupabaseClient()

  const fetchAnalyticsData = useCallback(async () => {
    try {
      setError(null)
      setIsLoading(true)

      const daysAgo = new Date()
      daysAgo.setDate(daysAgo.getDate() - parseInt(timeRange))
      const dateFilter = daysAgo.toISOString()

      // Parallel queries for better performance
      const [
        usersResult,
        tripsResult,
        poisPlayedResult,
        triggerPointsResult,
        mostPlayedResult,
        mostTriggeredResult,
        userGrowthResult,
        platformResult,
        feedbackResult,
        citiesResult,
        audioQualityResult,
        tripDistanceResult
      ] = await Promise.all([
        // Total users (all time, not filtered by date)
        supabase
          .schema('drive')
          .from('profiles')
          .select('*'),

        // Total trips and avg duration
        supabase
          .schema('drive')
          .from('trip_sessions')
          .select('duration')
          .gte('start_time', dateFilter)
          .not('end_time', 'is', null),

        // Total POIs played
        supabase
          .schema('drive')
          .from('trip_session_attractions')
          .select('*', { count: 'exact', head: true })
          .gte('played_at', dateFilter),

        // Trigger points activated (using trigger points table)
        supabase
          .schema('core')
          .from('attraction_trigger_points')
          .select('*', { count: 'exact', head: true })
          .eq('is_active', true)
          .gte('created_at', dateFilter),

        // Most played POIs - using pagination to avoid 1000 record limit
        (async () => {
          interface PlayedData {
            attraction_id: string;
          }
          
          let allPlayedData: PlayedData[] = [];
          let hasMore = true;
          let range = 0;
          const pageSize = 1000;

          while (hasMore) {
            const { data, error } = await supabase
              .schema('drive')
              .from('trip_session_attractions')
              .select('attraction_id')
              .gte('played_at', dateFilter)
              .range(range, range + pageSize - 1);
              
            if (error) throw error;
            
            if (data.length > 0) {
              allPlayedData = [...allPlayedData, ...data];
              range += pageSize;
            }
            
            if (data.length < pageSize) {
              hasMore = false;
            }
          }
          
          return { data: allPlayedData };
        })(),

        // Most triggered points (using analytics) - using pagination to avoid 1000 record limit
        (async () => {
          interface TriggeredData {
            attraction_id: string;
          }
          
          let allTriggeredData: TriggeredData[] = [];
          let hasMore = true;
          let range = 0;
          const pageSize = 1000;

          while (hasMore) {
            const { data, error } = await supabase
              .schema('core')
              .from('attraction_trigger_points')
              .select('attraction_id')
              .eq('is_active', true)
              .gte('created_at', dateFilter)
              .range(range, range + pageSize - 1);
              
            if (error) throw error;
            
            if (data.length > 0) {
              allTriggeredData = [...allTriggeredData, ...data];
              range += pageSize;
            }
            
            if (data.length < pageSize) {
              hasMore = false;
            }
          }
          
          return { data: allTriggeredData };
        })(),

        // User growth over time - using pagination to avoid 1000 record limit
        (async () => {
          interface UserGrowthData {
            created_at: string;
          }
          
          let allUserGrowthData: UserGrowthData[] = [];
          let hasMore = true;
          let range = 0;
          const pageSize = 1000;

          while (hasMore) {
            const { data, error } = await supabase
              .schema('drive')
              .from('profiles')
              .select('created_at')
              .gte('created_at', dateFilter)
              .order('created_at')
              .range(range, range + pageSize - 1);
              
            if (error) throw error;
            
            if (data.length > 0) {
              allUserGrowthData = [...allUserGrowthData, ...data];
              range += pageSize;
            }
            
            if (data.length < pageSize) {
              hasMore = false;
            }
          }
          
          return { data: allUserGrowthData };
        })(),

        // Trips by platform - using pagination to avoid 1000 record limit
        (async () => {
          interface PlatformData {
            platform: string;
          }
          
          let allPlatformData: PlatformData[] = [];
          let hasMore = true;
          let range = 0;
          const pageSize = 1000;

          while (hasMore) {
            const { data, error } = await supabase
              .schema('drive')
              .from('trip_sessions')
              .select('platform')
              .gte('start_time', dateFilter)
              .not('platform', 'is', null)
              .range(range, range + pageSize - 1);
              
            if (error) throw error;
            
            if (data.length > 0) {
              allPlatformData = [...allPlatformData, ...data];
              range += pageSize;
            }
            
            if (data.length < pageSize) {
              hasMore = false;
            }
          }
          
          return { data: allPlatformData };
        })(),

        // Feedback statistics - using pagination to avoid 1000 record limit
        (async () => {
          interface FeedbackData {
            feedback_type: string;
          }
          
          let allFeedbackData: FeedbackData[] = [];
          let hasMore = true;
          let range = 0;
          const pageSize = 1000;

          while (hasMore) {
            const { data, error } = await supabase
              .schema('drive')
              .from('attraction_feedback')
              .select('feedback_type')
              .gte('created_at', dateFilter)
              .range(range, range + pageSize - 1);
              
            if (error) throw error;
            
            if (data.length > 0) {
              allFeedbackData = [...allFeedbackData, ...data];
              range += pageSize;
            }
            
            if (data.length < pageSize) {
              hasMore = false;
            }
          }
          
          return { data: allFeedbackData };
        })(),

        // Top cities - using pagination to avoid 1000 record limit
        (async () => {
          interface CityData {
            city: string;
          }
          
          let allCitiesData: CityData[] = [];
          let hasMore = true;
          let range = 0;
          const pageSize = 1000;

          while (hasMore) {
            const { data, error } = await supabase
              .schema('core')
              .from('attractions')
              .select('city')
              .not('city', 'is', null)
              .range(range, range + pageSize - 1);
              
            if (error) throw error;
            
            if (data.length > 0) {
              allCitiesData = [...allCitiesData, ...data];
              range += pageSize;
            }
            
            if (data.length < pageSize) {
              hasMore = false;
            }
          }
          
          return { data: allCitiesData };
        })(),

        // Audio quality ratings - using pagination to avoid 1000 record limit
        (async () => {
          interface AudioData {
            audio_quality_rating: number;
          }
          
          let allAudioData: AudioData[] = [];
          let hasMore = true;
          let range = 0;
          const pageSize = 1000;

          while (hasMore) {
            const { data, error } = await supabase
              .schema('drive')
              .from('attraction_feedback')
              .select('audio_quality_rating')
              .gte('created_at', dateFilter)
              .not('audio_quality_rating', 'is', null)
              .range(range, range + pageSize - 1);
              
            if (error) throw error;
            
            if (data.length > 0) {
              allAudioData = [...allAudioData, ...data];
              range += pageSize;
            }
            
            if (data.length < pageSize) {
              hasMore = false;
            }
          }
          
          return { data: allAudioData };
        })(),

        // Trip distances (using trip_sessions) - using pagination to avoid 1000 record limit
        (async () => {
          interface DistanceData {
            distance_km: number;
          }
          
          let allDistanceData: DistanceData[] = [];
          let hasMore = true;
          let range = 0;
          const pageSize = 1000;

          while (hasMore) {
            const { data, error } = await supabase
              .schema('drive')
              .from('trip_sessions')
              .select('distance_km')
              .gte('start_time', dateFilter)
              .not('distance_km', 'is', null)
              .range(range, range + pageSize - 1);
              
            if (error) throw error;
            
            if (data.length > 0) {
              allDistanceData = [...allDistanceData, ...data];
              range += pageSize;
            }
            
            if (data.length < pageSize) {
              hasMore = false;
            }
          }
          
          return { data: allDistanceData };
        })()
      ])

      // Process results
      const totalUsers = usersResult.data?.length ?? 0
      const trips = tripsResult.data ?? []
      const totalTrips = trips.length
      const totalPOIsPlayed = poisPlayedResult.count ?? 0
      const totalTriggerPointsActivated = triggerPointsResult.count ?? 0

      // Calculate average trip duration and total trip time
      let totalTripTimeMinutes = 0
      const avgTripDuration = trips.length > 0 
        ? trips.reduce((acc, trip) => {
            if (trip.duration) {
              // Convert PostgreSQL interval to minutes
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
          }, 0) / trips.length
        : 0

      // Calculate total km driven
      const distances = tripDistanceResult.data ?? []
      const totalKmDriven = distances.reduce((acc, item) => acc + (item.distance_km || 0), 0)

      // Process most played POIs - get attraction details separately
      const playedPOIs = mostPlayedResult.data ?? []
      const poiCounts = playedPOIs.reduce((acc: Record<string, any>, item) => {
        const key = item.attraction_id
        if (!acc[key]) {
          acc[key] = {
            attraction_id: key,
            plays: 0
          }
        }
        acc[key].plays++
        return acc
      }, {})
      
      // Get attraction details for top POIs
      const topPoiIds = Object.keys(poiCounts).sort((a, b) => poiCounts[b].plays - poiCounts[a].plays).slice(0, 10)
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
        plays: poiCounts[id].plays
      }))

      // Process most triggered points
      const triggeredPoints = mostTriggeredResult.data ?? []
      const triggerCounts = triggeredPoints.reduce((acc: Record<string, any>, item) => {
        const key = item.attraction_id
        if (!acc[key]) {
          acc[key] = {
            attraction_id: key,
            triggers: 0
          }
        }
        acc[key].triggers++
        return acc
      }, {})
      
      // Get attraction details for top triggered points
      const topTriggerIds = Object.keys(triggerCounts).sort((a, b) => triggerCounts[b].triggers - triggerCounts[a].triggers).slice(0, 10)
      const triggerDetailsResult = topTriggerIds.length > 0 ? await supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city')
        .in('id', topTriggerIds) : { data: [] }
      
      const triggerDetails = (triggerDetailsResult.data ?? []).reduce((acc: Record<string, any>, poi) => {
        acc[poi.id] = poi
        return acc
      }, {})
      
      const mostTriggeredPoints = topTriggerIds.map(id => ({
        poi_name: triggerDetails[id]?.name || 'Unknown',
        city: triggerDetails[id]?.city || 'Unknown',
        type: 'trigger_point',
        triggers: triggerCounts[id].triggers
      }))

      // Process user growth
      const userGrowthData = userGrowthResult.data ?? []
      const growthByDate = userGrowthData.reduce((acc: Record<string, number>, user) => {
        const date = new Date(user.created_at).toISOString().split('T')[0]
        acc[date] = (acc[date] || 0) + 1
        return acc
      }, {})
      const userGrowth = Object.entries(growthByDate)
        .map(([date, users]) => ({ date, users: users as number }))
        .sort((a, b) => a.date.localeCompare(b.date))

      // Process monthly user growth (all time data)
      const allUsersResult = await supabase
        .schema('drive')
        .from('profiles')
        .select('created_at')
        .order('created_at')
      
      const allUsersData = allUsersResult.data ?? []
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

      // Process platform data
      const platformData = platformResult.data ?? []
      const platformCounts = platformData.reduce((acc: Record<string, number>, trip) => {
        acc[trip.platform] = (acc[trip.platform] || 0) + 1
        return acc
      }, {})
      const tripsByPlatform = Object.entries(platformCounts)
        .map(([platform, trips]) => ({ platform: platform || 'Unknown', trips: trips as number }))

      // Process feedback data
      const feedbackData = feedbackResult.data ?? []
      const feedbackCounts = feedbackData.reduce((acc: Record<string, number>, feedback) => {
        acc[feedback.feedback_type] = (acc[feedback.feedback_type] || 0) + 1
        return acc
      }, {})
      const feedbackStats = Object.entries(feedbackCounts)
        .map(([feedback_type, count]) => ({ feedback_type, count: count as number }))
        .sort((a, b) => b.count - a.count)

      // Process cities data - now using all cities data from pagination
      const citiesData = citiesResult.data ?? []
      const cityCounts = citiesData.reduce((acc: Record<string, number>, attraction) => {
        if (attraction.city) {
          acc[attraction.city] = (acc[attraction.city] || 0) + 1
        }
        return acc
      }, {})
      const topCities = Object.entries(cityCounts)
        .map(([city, pois]) => ({ city, pois: pois as number, trips: 0 }))
        .sort((a, b) => b.pois - a.pois)
        .slice(0, 10)

      // Process audio quality
      const audioData = audioQualityResult.data ?? []
      const avgAudioRating = audioData.length > 0 
        ? audioData.reduce((acc, item) => acc + item.audio_quality_rating, 0) / audioData.length
        : 0
      const audioQualityStats = {
        avg_rating: Math.round(avgAudioRating * 10) / 10,
        total_ratings: audioData.length
      }

      setData({
        totalUsers,
        totalTrips,
        totalKmDriven: Math.round(totalKmDriven),
        totalPOIsPlayed,
        totalTriggerPointsActivated,
        avgTripDuration: Math.round(avgTripDuration),
        totalTripTime: Math.round(totalTripTimeMinutes),
        mostPlayedPOIs: mostPlayedPOIs as any,
        mostTriggeredPoints: mostTriggeredPoints as any,
        userGrowth,
        monthlyUserGrowth,
        tripsByPlatform,
        feedbackStats,
        topCities,
        audioQualityStats
      })
      setLastUpdated(new Date())
    } catch (error) {
      console.error('Error fetching analytics data:', error)
      setError('Failed to load analytics data. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [supabase, timeRange])

  useEffect(() => {
    fetchAnalyticsData()
  }, [fetchAnalyticsData])

  const StatCard = ({ icon: Icon, title, value, color, suffix = '', subtitle = '' }: {
    icon: any
    title: string
    value: number | string
    color: string
    suffix?: string
    subtitle?: string
  }) => {
    const displayValue = typeof value === 'number' ? value : value
    
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
                `${typeof displayValue === 'number' ? displayValue.toLocaleString() : displayValue}${suffix}`
              )}
            </p>
            {subtitle && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {subtitle}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="tuggi-card p-8 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-tuggi-text dark:text-white mb-2">
            Error Loading Analytics
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={fetchAnalyticsData}
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
            Analytics Dashboard
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            User engagement and platform performance metrics
          </p>
          {lastUpdated && !isLoading && (
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
          <button
            onClick={fetchAnalyticsData}
            disabled={isLoading}
            className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={Users}
          title="Total Users"
          value={data.totalUsers}
          color="bg-tuggi-blue"
        />
        <StatCard
          icon={MapPin}
          title="POIs Played"
          value={data.totalPOIsPlayed}
          color="bg-green-500"
        />
        <StatCard
          icon={Target}
          title="Trigger Points Activated"
          value={data.totalTriggerPointsActivated}
          color="bg-purple-500"
        />
        <StatCard
          icon={Navigation}
          title="Distance Traveled"
          value={data.totalKmDriven}
          color="bg-tuggi-orange"
          suffix=" km"
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={Activity}
          title="Total Trips"
          value={data.totalTrips}
          color="bg-blue-500"
        />
        <StatCard
          icon={Clock}
          title="Avg Trip Duration"
          value={data.avgTripDuration}
          color="bg-indigo-500"
          suffix=" min"
        />
        <StatCard
          icon={Clock}
          title="Total Trip Time"
          value={Math.floor(data.totalTripTime / 60)}
          color="bg-teal-500"
          suffix=" hrs"
          subtitle={`${data.totalTripTime % 60} min`}
        />
        <StatCard
          icon={Star}
          title="Audio Quality"
          value={data.audioQualityStats.avg_rating}
          color="bg-yellow-500"
          suffix="/5"
          subtitle={`${data.audioQualityStats.total_ratings} ratings`}
        />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Most Played POIs */}
        <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4 flex items-center">
            <Volume2 className="h-5 w-5 mr-2" />
            Most Played POIs
          </h3>
          {isLoading ? (
            <div className="h-80 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.mostPlayedPOIs} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'rgb(31 41 55)',
                      border: '1px solid rgb(75 85 99)',
                      borderRadius: '8px',
                      color: 'white'
                    }}
                    formatter={(value, name) => [`${value} plays`, 'Plays']}
                    labelFormatter={(label) => `POI: ${label}`}
                  />
                  <Bar dataKey="plays" fill="#00A8E8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Most Triggered Points */}
        <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4 flex items-center">
            <Target className="h-5 w-5 mr-2" />
            Most Triggered Points
          </h3>
          {isLoading ? (
            <div className="h-80 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.mostTriggeredPoints} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis 
                    dataKey="poi_name" 
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'rgb(31 41 55)',
                      border: '1px solid rgb(75 85 99)',
                      borderRadius: '8px',
                      color: 'white'
                    }}
                    formatter={(value, name) => [`${value} triggers`, 'Triggers']}
                  />
                  <Bar dataKey="triggers" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* User Growth */}
        {/* <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4 flex items-center">
            <TrendingUp className="h-5 w-5 mr-2" />
            User Growth
          </h3>
          {isLoading ? (
            <div className="h-80 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.userGrowth}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    tickFormatter={(date) => new Date(date).toLocaleDateString()}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'rgb(31 41 55)',
                      border: '1px solid rgb(75 85 99)',
                      borderRadius: '8px',
                      color: 'white'
                    }}
                    labelFormatter={(date) => new Date(date).toLocaleDateString()}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="users" 
                    stroke="#10B981" 
                    fill="#10B981" 
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div> */}

        {/* Monthly User Growth */}
        <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4 flex items-center">
            <Users className="h-5 w-5 mr-2" />
            New Users by Month
          </h3>
          {isLoading ? (
            <div className="h-80 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthlyUserGrowth} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis 
                    dataKey="month" 
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'rgb(31 41 55)',
                      border: '1px solid rgb(75 85 99)',
                      borderRadius: '8px',
                      color: 'white'
                    }}
                    formatter={(value, name) => [`${value} new users`, 'New Users']}
                    labelFormatter={(label) => `Month: ${label}`}
                  />
                  <Bar dataKey="newUsers" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Platform Distribution */}
        <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
            Trips by Platform
          </h3>
          {isLoading ? (
            <div className="h-80 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.tripsByPlatform}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="trips"
                    label={(entry: any) => `${entry.payload?.platform || 'Unknown'}: ${entry.value}`}
                  >
                    {data.tripsByPlatform.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'rgb(31 41 55)',
                      border: '1px solid rgb(75 85 99)',
                      borderRadius: '8px',
                      color: 'white'
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Additional Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Cities */}
        <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
            Top Cities by POI Count
          </h3>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {data.topCities.slice(0, 8).map((city, index) => (
                <div key={city.city} className="flex items-center justify-between">
                  <div className="flex items-center">
                    <span className="text-sm font-medium text-gray-900 dark:text-white w-4 mr-3">
                      {index + 1}.
                    </span>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {city.city}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-tuggi-blue">
                    {city.pois} POIs
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Feedback Overview */}
        <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
            User Feedback Overview
          </h3>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {data.feedbackStats.slice(0, 8).map((feedback, index) => (
                <div key={feedback.feedback_type} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">
                    {feedback.feedback_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm font-semibold text-tuggi-orange">
                    {feedback.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}