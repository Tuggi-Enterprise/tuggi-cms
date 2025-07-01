'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { MapPin, CheckCircle, FileText, TrendingUp, AlertCircle, RefreshCw } from 'lucide-react'

interface DashboardStats {
  totalPOIs: number
  approvedPOIs: number
  totalDescriptions: number
  cityDistribution: Array<{ city: string; count: number }>
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
    cityDistribution: []
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const supabase = useSupabaseClient()

  const fetchDashboardData = useCallback(async () => {
    try {
      setError(null)
      setIsLoading(true)

      // Parallel queries for better performance
      const [
        totalPOIsResult,
        approvedPOIsResult,
        totalDescriptionsResult,
        cityDataResult
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
          .from('attraction_description')
          .select('*', { count: 'exact', head: true }),

        // Fetch city distribution
        supabase
          .schema('core')
          .from('attractions')
          .select('city')
          .not('city', 'is', null)
      ])

      // Extract counts with better error handling
      const totalPOIs = totalPOIsResult.count ?? 0
      const approvedPOIs = approvedPOIsResult.count ?? 0
      const totalDescriptions = totalDescriptionsResult.count ?? 0
      const cityData = cityDataResult.data ?? []

      const cityDistribution = cityData.reduce((acc: Record<string, number>, item) => {
        if (item.city) {
          acc[item.city] = (acc[item.city] || 0) + 1
        }
        return acc
      }, {})

      const cityDistributionArray = Object.entries(cityDistribution)
        .map(([city, count]) => ({ city, count: count as number }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10) // Top 10 cities

      const newStats = {
        totalPOIs,
        approvedPOIs,
        totalDescriptions,
        cityDistribution: cityDistributionArray
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