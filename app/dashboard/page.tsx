'use client'

import { useState, useEffect } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { MapPin, CheckCircle, FileText, TrendingUp } from 'lucide-react'

interface DashboardStats {
  totalPOIs: number
  approvedPOIs: number
  totalDescriptions: number
  cityDistribution: Array<{ city: string; count: number }>
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#F97316']

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalPOIs: 0,
    approvedPOIs: 0,
    totalDescriptions: 0,
    cityDistribution: []
  })
  const [isLoading, setIsLoading] = useState(true)
  const supabase = useSupabaseClient()

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      // Fetch total POIs
      const { count: totalPOIs } = await supabase
        .schema('core')
        .from('attractions')
        .select('*', { count: 'exact', head: true })

      // Fetch approved POIs
      const { count: approvedPOIs } = await supabase
        .schema('core')
        .from('attractions')
        .select('*', { count: 'exact', head: true })
        .eq('approved', true)

      // Fetch total descriptions
      const { count: totalDescriptions } = await supabase
        .schema('core')
        .from('attraction_description')
        .select('*', { count: 'exact', head: true })

      // Fetch city distribution
      const { data: cityData } = await supabase
        .schema('core')
        .from('attractions')
        .select('city')
        .not('city', 'is', null)

      const cityDistribution = cityData?.reduce((acc: Record<string, number>, item) => {
        acc[item.city] = (acc[item.city] || 0) + 1
        return acc
      }, {})

      const cityDistributionArray = Object.entries(cityDistribution || {})
        .map(([city, count]) => ({ city, count: count as number }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10) // Top 10 cities

      setStats({
        totalPOIs: totalPOIs || 0,
        approvedPOIs: approvedPOIs || 0,
        totalDescriptions: totalDescriptions || 0,
        cityDistribution: cityDistributionArray
      })
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const StatCard = ({ icon: Icon, title, value, color }: {
    icon: any
    title: string
    value: number
    color: string
  }) => (
    <div className="tuggi-card p-6">
      <div className="flex items-center">
        <div className={`p-3 rounded-full ${color}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
        <div className="ml-4">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {title}
          </p>
          <p className="text-2xl font-bold text-tuggi-text dark:text-white">
            {isLoading ? '...' : value.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-tuggi-text dark:text-white">
          Dashboard
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Overview of your POI management system
        </p>
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
          value={stats.totalPOIs > 0 ? Math.round((stats.approvedPOIs / stats.totalPOIs) * 100) : 0}
          color="bg-purple-500"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart - City Distribution */}
        <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
            POIs by City
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.cityDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis 
                  dataKey="city" 
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
                    borderRadius: '6px',
                    color: 'white'
                  }}
                />
                <Bar dataKey="count" fill="#00A8E8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie Chart - Approval Status */}
        <div className="tuggi-card p-6">
          <h3 className="text-lg font-semibold text-tuggi-text dark:text-white mb-4">
            Approval Status
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Approved', value: stats.approvedPOIs },
                    { name: 'Pending', value: stats.totalPOIs - stats.approvedPOIs }
                  ]}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  <Cell fill="#10B981" />
                  <Cell fill="#FF6F00" />
                </Pie>
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'rgb(31 41 55)',
                    border: '1px solid rgb(75 85 99)',
                    borderRadius: '6px',
                    color: 'white'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
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
            className="flex items-center p-4 bg-tuggi-blue/10 rounded-lg hover:bg-tuggi-blue/20 transition-colors border border-tuggi-blue/20"
          >
            <MapPin className="h-8 w-8 text-tuggi-blue mr-3" />
            <div>
              <p className="font-medium text-tuggi-text dark:text-white">Add New POI</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Create a new point of interest</p>
            </div>
          </a>
          
          <a
            href="/pois?filter=pending"
            className="flex items-center p-4 bg-tuggi-orange/10 rounded-lg hover:bg-tuggi-orange/20 transition-colors border border-tuggi-orange/20"
          >
            <CheckCircle className="h-8 w-8 text-tuggi-orange mr-3" />
            <div>
              <p className="font-medium text-tuggi-text dark:text-white">Review Pending</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Approve or reject POIs</p>
            </div>
          </a>
          
          <a
            href="/analytics"
            className="flex items-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors border border-green-200 dark:border-green-700"
          >
            <TrendingUp className="h-8 w-8 text-green-600 dark:text-green-400 mr-3" />
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