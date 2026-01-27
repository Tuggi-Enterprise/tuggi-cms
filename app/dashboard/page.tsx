'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts'
import { 
  MapPin, CheckCircle, FileText, TrendingUp, AlertCircle, RefreshCw, 
  Globe, Users, Activity, Database, Zap, Volume2,
  Clock, Play, Navigation, Map, Eye, Headphones, Layers, AlertTriangle,
  Target, FolderOpen, Package, Plus
} from 'lucide-react'
import { dashboardService, DashboardStats, UserWithSessions, HeatmapPoint, InventoryDetails } from '@/lib/services/dashboard-service'

// Lazy load TrailMap para performance
const TrailMap = dynamic(
  () => import('@/components/trail-visualization/TrailMap').then(mod => mod.TrailMap),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800 rounded-2xl">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tuggi-blue mx-auto mb-4" />
          <p className="text-gray-500">Loading map...</p>
        </div>
      </div>
    )
  }
)

// ============================================================================
// CORES TUGGI BRAND
// ============================================================================

const TUGGI_COLORS = {
  blue: '#00A8E8',
  orange: '#FF6F00',
  green: '#10B981',
  purple: '#8B5CF6',
  red: '#EF4444',
  background: '#F7F9FA',
  text: '#1A1A1A',
  border: '#D9D9D9'
}

const FUNNEL_COLORS = {
  approved: TUGGI_COLORS.green,
  pending: TUGGI_COLORS.orange, 
  homolog: TUGGI_COLORS.purple
}

const EMPTY_STATS: DashboardStats = {
  totalPOIs: 0,
  approvedPOIs: 0,
  pendingPOIs: 0,
  homologPOIs: 0,
  totalInventory: 0,
  approvalRate: 0,
  withDescriptionPT: 0,
  withDescriptionEN: 0,
  withDescriptionES: 0,
  withAudio: 0,
  contentCoverage: 0,
  totalUsers: 0,
  activeUsers30d: 0,
  totalTrips: 0,
  totalKmDriven: 0,
  totalPOIVisits: 0,
  totalAudioPlays: 0,
  avgTripDuration: '0 min',
  tripsByPlatform: [],
  mauHistory: [],
  userGrowth: [],
  cityDistribution: [],
  mostVisitedCities: [],
  topVisitedPOIs: [],
  recentVisitedPOIs: [],
  lastUpdated: new Date(),
  source: 'database'
}

const EMPTY_INVENTORY: InventoryDetails = {
  coreTotal: 0,
  coreApproved: 0,
  corePending: 0,
  coreWithCoordinates: 0,
  coreWithTriggerPoints: 0,
  coreMissingTriggerPoints: 0,
  homologTotal: 0,
  homologProcessed: 0,
  homologPending: 0,
  poisWithAnyDescription: 0,
  poisWithAllLanguages: 0,
  poisWithAudio: 0,
  poisMissingContent: 0,
  topCities: [],
  categoriesBreakdown: [],
  recentCoreAdditions: 0,
  recentHomologAdditions: 0
}

// ============================================================================
// COMPONENT: Premium Stat Card
// ============================================================================

interface StatCardProps {
  icon: any
  title: string
  value: string | number
  subtitle?: string
  color: string
  isLoading?: boolean
  size?: 'normal' | 'compact'
}

const StatCard = ({ icon: Icon, title, value, subtitle, color, isLoading, size = 'normal' }: StatCardProps) => (
  <div className={`group relative overflow-hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 ${size === 'compact' ? 'p-4' : 'p-6'} hover:border-tuggi-blue/30 transition-all duration-300 hover:shadow-xl hover:shadow-tuggi-blue/10 hover:-translate-y-1`}>
    <div className={`absolute -top-20 -right-20 w-40 h-40 opacity-10 blur-3xl group-hover:opacity-20 transition-opacity duration-500`} style={{ backgroundColor: color }} />
    
    <div className="relative z-10">
      <div className="flex items-center justify-between mb-3">
        <div className={`${size === 'compact' ? 'p-2' : 'p-3'} rounded-xl`} style={{ backgroundColor: `${color}20` }}>
          <Icon className={`${size === 'compact' ? 'h-4 w-4' : 'h-6 w-6'}`} style={{ color }} />
        </div>
      </div>
      
      <p className={`${size === 'compact' ? 'text-[10px]' : 'text-xs'} font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1`}>{title}</p>
      
      {isLoading ? (
        <div className={`${size === 'compact' ? 'h-6 w-16' : 'h-10 w-24'} bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse`} />
      ) : (
        <>
          <p className={`${size === 'compact' ? 'text-2xl' : 'text-4xl'} font-black text-gray-900 dark:text-white tracking-tight`}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {subtitle && (
            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>
          )}
        </>
      )}
    </div>
  </div>
)

// ============================================================================
// COMPONENT: Tab Button
// ============================================================================

type DashboardTab = 'overview' | 'content' | 'users' | 'territorial' | 'heatmap'

const TabButton = ({ 
  id, 
  label, 
  icon: Icon, 
  active, 
  onClick 
}: { 
  id: DashboardTab
  label: string
  icon: any
  active: boolean
  onClick: () => void
}) => (
  <button
    onClick={onClick}
    className={`flex items-center px-5 py-3 rounded-xl font-bold text-sm transition-all duration-300 ${
      active 
        ? 'bg-tuggi-blue text-white shadow-lg shadow-tuggi-blue/30 scale-105' 
        : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
    }`}
  >
    <Icon className={`h-4 w-4 mr-2 ${active ? 'animate-pulse' : ''}`} />
    {label}
  </button>
)

// ============================================================================
// COMPONENT: Recent Visit Card
// ============================================================================

const RecentVisitCard = ({ visit }: { visit: DashboardStats['recentVisitedPOIs'][0] }) => (
  <div className="flex items-center p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-tuggi-blue/30 transition-all group">
    <div className="flex-shrink-0 mr-4">
      <div className={`flex items-center justify-center w-10 h-10 rounded-full ${visit.audio_played ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
        {visit.audio_played ? (
          <Headphones className="h-5 w-5 text-green-500" />
        ) : (
          <Eye className="h-5 w-5 text-gray-400" />
        )}
      </div>
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-bold text-gray-900 dark:text-white truncate">{visit.poi_name}</p>
      <p className="text-xs text-gray-500">{visit.poi_city}, {visit.poi_country}</p>
    </div>
    <div className="text-right ml-4">
      <p className="text-xs text-gray-400">@{visit.user_nickname}</p>
      <p className="text-[10px] text-gray-500">
        {new Date(visit.visit_timestamp).toLocaleString('pt-BR', { 
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' 
        })}
      </p>
    </div>
  </div>
)

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS)
  const [inventory, setInventory] = useState<InventoryDetails>(EMPTY_INVENTORY)
  const [users, setUsers] = useState<UserWithSessions[]>([])
  const [heatmapData, setHeatmapData] = useState<HeatmapPoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [isLoadingHeatmap, setIsLoadingHeatmap] = useState(false)
  const [isLoadingInventory, setIsLoadingInventory] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch dashboard data
  const fetchData = useCallback(async () => {
    try {
      setError(null)
      setIsLoading(true)
      
      const result = await dashboardService.getDashboardData()
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to load dashboard')
      }
      
      setStats(result.data)
      console.log('✅ Dashboard loaded:', result.data)
    } catch (err) {
      console.error('Dashboard error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Load users when Users tab is active
  useEffect(() => {
    if (activeTab === 'users') {
      const loadUsers = async () => {
        setIsLoadingUsers(true)
        const result = await dashboardService.getUsersWithSessions(50)
        if (result.success && result.data) {
          setUsers(result.data as UserWithSessions[])
        }
        setIsLoadingUsers(false)
      }
      loadUsers()
    }
  }, [activeTab])

  // Load inventory details when Content tab is active
  useEffect(() => {
    if (activeTab === 'content' && inventory.coreTotal === 0) {
      const loadInventory = async () => {
        setIsLoadingInventory(true)
        const result = await dashboardService.getInventoryDetails()
        if (result.success && result.data) {
          setInventory(result.data)
        }
        setIsLoadingInventory(false)
      }
      loadInventory()
    }
  }, [activeTab, inventory.coreTotal])

  // Load heatmap when Heatmap tab is active
  useEffect(() => {
    if (activeTab === 'heatmap' && heatmapData.length === 0) {
      const loadHeatmap = async () => {
        setIsLoadingHeatmap(true)
        const result = await dashboardService.getHeatmapData(5000)
        if (result.success && result.data) {
          setHeatmapData(result.data)
        }
        setIsLoadingHeatmap(false)
      }
      loadHeatmap()
    }
  }, [activeTab, heatmapData.length])

  // Initial load + refresh interval
  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Prepare chart data
  const funnelData = [
    { name: 'Approved', value: stats.approvedPOIs, color: FUNNEL_COLORS.approved },
    { name: 'Pending', value: stats.pendingPOIs, color: FUNNEL_COLORS.pending },
    { name: 'Homolog', value: stats.homologPOIs, color: FUNNEL_COLORS.homolog }
  ]

  const contentQualityData = [
    { language: 'PT-BR', count: stats.withDescriptionPT, fill: TUGGI_COLORS.green },
    { language: 'EN', count: stats.withDescriptionEN, fill: TUGGI_COLORS.blue },
    { language: 'ES', count: stats.withDescriptionES, fill: TUGGI_COLORS.orange }
  ]

  // Error State
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-8 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Dashboard Error</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">{error}</p>
          <button
            onClick={fetchData}
            className="px-6 py-3 bg-tuggi-blue text-white rounded-xl font-bold hover:bg-blue-600 transition-colors"
          >
            <RefreshCw className="h-4 w-4 inline mr-2" />
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8">
      {/* ================================================================ */}
      {/* HEADER */}
      {/* ================================================================ */}
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl lg:text-4xl font-black text-gray-900 dark:text-white tracking-tight flex items-center">
            <Activity className="h-8 w-8 mr-3" style={{ color: TUGGI_COLORS.blue }} />
            Tuggi <span className="ml-2" style={{ color: TUGGI_COLORS.blue }}>Analytics</span>
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            Real-time intelligence • <code className="text-tuggi-blue">{stats.totalPOIVisits.toLocaleString()}</code> visits tracked
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center px-4 py-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse mr-2" />
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
              {stats.source === 'cache' ? 'Cached' : 'Live'}
            </span>
          </div>
          
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center px-4 py-2 bg-tuggi-blue/10 border border-tuggi-blue/30 text-tuggi-blue rounded-xl font-bold text-sm hover:bg-tuggi-blue/20 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Sync
          </button>
        </div>
      </header>

      {/* ================================================================ */}
      {/* TAB NAVIGATION */}
      {/* ================================================================ */}
      <nav className="flex flex-wrap gap-2 mb-8 p-1 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 w-fit">
        <TabButton id="overview" label="Overview" icon={Globe} active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
        <TabButton id="content" label="Inventory" icon={Layers} active={activeTab === 'content'} onClick={() => setActiveTab('content')} />
        <TabButton id="users" label="Users" icon={Users} active={activeTab === 'users'} onClick={() => setActiveTab('users')} />
        <TabButton id="territorial" label="Territorial" icon={MapPin} active={activeTab === 'territorial'} onClick={() => setActiveTab('territorial')} />
        <TabButton id="heatmap" label="Heatmap" icon={Map} active={activeTab === 'heatmap'} onClick={() => setActiveTab('heatmap')} />
      </nav>

      {/* ================================================================ */}
      {/* TAB: OVERVIEW */}
      {/* ================================================================ */}
      {activeTab === 'overview' && (
        <div className="space-y-8 animate-in fade-in duration-500">
          {/* KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard icon={Database} title="Total Inventory" value={stats.totalInventory} subtitle={`${stats.totalPOIs} core + ${stats.homologPOIs} homolog`} color={TUGGI_COLORS.blue} isLoading={isLoading} />
            <StatCard icon={CheckCircle} title="Approved POIs" value={stats.approvedPOIs} subtitle={`${stats.approvalRate}% approval rate`} color={TUGGI_COLORS.green} isLoading={isLoading} />
            <StatCard icon={Users} title="Active Users" value={stats.activeUsers30d} subtitle={`of ${stats.totalUsers} total users`} color={TUGGI_COLORS.purple} isLoading={isLoading} />
            <StatCard icon={Zap} title="Total Trips" value={stats.totalTrips} subtitle={`${stats.totalKmDriven.toLocaleString()} km driven`} color={TUGGI_COLORS.orange} isLoading={isLoading} />
          </div>

          {/* Row: MAU + Funnel + Recent Visits (Grid 3) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* MAU Chart */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
                <TrendingUp className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
                Monthly Active Users
              </h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.mauHistory}>
                    <defs>
                      <linearGradient id="mauGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={TUGGI_COLORS.blue} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={TUGGI_COLORS.blue} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
                    <Area type="monotone" dataKey="count" stroke={TUGGI_COLORS.blue} fill="url(#mauGradient)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Inventory Funnel */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
                <Database className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
                Inventory Funnel
              </h3>
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={funnelData} innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                      {funnelData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {funnelData.map((item) => (
                  <div key={item.name} className="text-center">
                    <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ backgroundColor: item.color }} />
                    <p className="text-[9px] font-bold text-gray-500 uppercase">{item.name}</p>
                    <p className="text-sm font-black text-gray-900 dark:text-white">{item.value.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Visits */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
                <Play className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.orange }} />
                Últimas Visitas
              </h3>
              <div className="space-y-2 max-h-[280px] overflow-y-auto custom-scrollbar">
                {stats.recentVisitedPOIs.length > 0 ? (
                  stats.recentVisitedPOIs.slice(0, 5).map((visit) => (
                    <RecentVisitCard key={visit.visit_id} visit={visit} />
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Eye className="h-12 w-12 mx-auto mb-2 opacity-30" />
                    <p>Nenhuma visita registrada</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Row: Engagement Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <StatCard icon={Eye} title="POI Visits" value={stats.totalPOIVisits} color={TUGGI_COLORS.blue} />
            <StatCard icon={Headphones} title="Audio Plays" value={stats.totalAudioPlays} color={TUGGI_COLORS.green} />
            <StatCard icon={Clock} title="Avg Duration" value={stats.avgTripDuration} color={TUGGI_COLORS.purple} />
            <StatCard icon={MapPin} title="Cities Covered" value={stats.mostVisitedCities.length} color={TUGGI_COLORS.orange} />
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: CONTENT / INVENTORY */}
      {/* ================================================================ */}
      {activeTab === 'content' && (
        <div className="space-y-8 animate-in slide-in-from-right duration-500">
          {/* Core Inventory Stats */}
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
              <Database className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
              Core Inventory
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatCard icon={Package} title="Total Core" value={inventory.coreTotal} color={TUGGI_COLORS.blue} isLoading={isLoadingInventory} size="compact" />
              <StatCard icon={CheckCircle} title="Approved" value={inventory.coreApproved} color={TUGGI_COLORS.green} isLoading={isLoadingInventory} size="compact" />
              <StatCard icon={Clock} title="Pending" value={inventory.corePending} color={TUGGI_COLORS.orange} isLoading={isLoadingInventory} size="compact" />
              <StatCard icon={MapPin} title="With Coords" value={inventory.coreWithCoordinates} color={TUGGI_COLORS.blue} isLoading={isLoadingInventory} size="compact" />
              <StatCard icon={Target} title="With Triggers" value={inventory.coreWithTriggerPoints} color={TUGGI_COLORS.green} isLoading={isLoadingInventory} size="compact" />
              <StatCard icon={AlertTriangle} title="Missing Triggers" value={inventory.coreMissingTriggerPoints} color={TUGGI_COLORS.red} isLoading={isLoadingInventory} size="compact" />
            </div>
          </div>

          {/* Homolog Stats */}
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
              <FolderOpen className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.purple }} />
              Homolog Pipeline
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Layers} title="Total Homolog" value={inventory.homologTotal} color={TUGGI_COLORS.purple} isLoading={isLoadingInventory} size="compact" />
              <StatCard icon={CheckCircle} title="Processed" value={inventory.homologProcessed} color={TUGGI_COLORS.green} isLoading={isLoadingInventory} size="compact" />
              <StatCard icon={Clock} title="Pending Process" value={inventory.homologPending} color={TUGGI_COLORS.orange} isLoading={isLoadingInventory} size="compact" />
              <StatCard icon={Plus} title="New (7d)" value={inventory.recentHomologAdditions} subtitle="Last 7 days" color={TUGGI_COLORS.blue} isLoading={isLoadingInventory} size="compact" />
            </div>
          </div>

          {/* Content Quality */}
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
              <FileText className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.green }} />
              Content Quality
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={FileText} title="With Any Description" value={inventory.poisWithAnyDescription} color={TUGGI_COLORS.green} isLoading={isLoadingInventory} size="compact" />
              <StatCard icon={Globe} title="All 3 Languages" value={inventory.poisWithAllLanguages} color={TUGGI_COLORS.blue} isLoading={isLoadingInventory} size="compact" />
              <StatCard icon={Volume2} title="With Audio" value={inventory.poisWithAudio} color={TUGGI_COLORS.purple} isLoading={isLoadingInventory} size="compact" />
              <StatCard icon={AlertTriangle} title="Missing Content" value={inventory.poisMissingContent} color={TUGGI_COLORS.red} isLoading={isLoadingInventory} size="compact" />
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Descriptions by Language */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6">Descriptions by Language</h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={contentQualityData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} />
                    <YAxis type="category" dataKey="language" tick={{ fill: '#374151', fontSize: 12, fontWeight: 'bold' }} axisLine={false} width={60} />
                    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Top Cities by POI Count */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
                <MapPin className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
                Top Cidades por POIs
              </h3>
              <div className="space-y-3 max-h-[250px] overflow-y-auto custom-scrollbar">
                {inventory.topCities.length > 0 ? inventory.topCities.map((city, index) => (
                  <div key={city.city} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="text-xs font-black text-gray-400 w-5">{index + 1}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{city.city}</span>
                      <span className="text-[10px] text-gray-500 ml-2">({city.country})</span>
                    </div>
                    <span className="font-black text-tuggi-blue">{city.count}</span>
                  </div>
                )) : (
                  <div className="text-center py-8 text-gray-500">Loading...</div>
                )}
              </div>
            </div>
          </div>

          {/* Categories Breakdown */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
              <Layers className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.purple }} />
              Categories Breakdown
            </h3>
            <div className="flex flex-wrap gap-2">
              {inventory.categoriesBreakdown.map((cat) => (
                <div key={cat.category} className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">{cat.category}</span>
                  <span className="px-2 py-0.5 bg-tuggi-blue/20 text-tuggi-blue text-xs font-black rounded-full">{cat.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: USERS */}
      {/* ================================================================ */}
      {activeTab === 'users' && (
        <div className="space-y-8 animate-in slide-in-from-right duration-500">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard icon={Users} title="Total Users" value={stats.totalUsers} color={TUGGI_COLORS.blue} />
            <StatCard icon={Activity} title="Active (30d)" value={stats.activeUsers30d} color={TUGGI_COLORS.green} />
            <StatCard icon={Zap} title="Total Trips" value={stats.totalTrips} color={TUGGI_COLORS.purple} />
            <StatCard icon={Clock} title="Avg Duration" value={stats.avgTripDuration} color={TUGGI_COLORS.orange} />
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="p-6 border-b border-gray-200 dark:border-gray-800">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
                <Users className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
                Community Profiles
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 text-xs font-bold text-gray-500 uppercase tracking-widest">
                    <th className="p-4 text-left">User</th>
                    <th className="p-4 text-left">Country</th>
                    <th className="p-4 text-left">Platform</th>
                    <th className="p-4 text-right">Trips</th>
                    <th className="p-4 text-right">POI Visits</th>
                    <th className="p-4 text-right">KM</th>
                    <th className="p-4 text-left">Last Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {isLoadingUsers ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="p-4"><div className="h-10 w-32 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                        <td className="p-4"><div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                        <td className="p-4"><div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                        <td className="p-4"><div className="h-4 w-8 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                        <td className="p-4"><div className="h-4 w-8 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                        <td className="p-4"><div className="h-4 w-12 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                        <td className="p-4"><div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                      </tr>
                    ))
                  ) : users.map((user) => (
                    <tr key={user.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center">
                          <div className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold mr-3" style={{ background: `linear-gradient(135deg, ${TUGGI_COLORS.blue}, ${TUGGI_COLORS.purple})` }}>
                            {user.full_name?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-white">{user.full_name || 'Anonymous'}</p>
                            <p className="text-xs text-gray-500">@{user.nickname || 'none'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">
                          {user.country || 'Global'}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          user.last_platform === 'ios' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 
                          user.last_platform === 'android' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 
                          'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                        }`}>
                          {user.last_platform || 'Unknown'}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-black text-gray-900 dark:text-white">{user.trip_count || 0}</span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-black text-tuggi-blue">{user.poi_visits_count || 0}</span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-medium text-gray-600 dark:text-gray-400">{Math.round(user.total_km || 0)}</span>
                      </td>
                      <td className="p-4 text-sm text-gray-500">
                        {user.last_trip_at ? new Date(user.last_trip_at).toLocaleDateString() : 
                         user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: TERRITORIAL */}
      {/* ================================================================ */}
      {activeTab === 'territorial' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in slide-in-from-bottom duration-500">
          {/* Most Visited Cities */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center">
              <Navigation className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
              Top Cidades Visitadas
            </h3>
            <div className="space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
              {stats.mostVisitedCities.length > 0 ? (
                stats.mostVisitedCities.map((city, index) => (
                  <div key={`${city.city}-${index}`} className="group">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center">
                        <span className="text-xs font-black text-gray-400 w-6">{index + 1}</span>
                        <span className="font-bold text-gray-900 dark:text-white">{city.city}</span>
                      </div>
                      <span className="text-sm font-black" style={{ color: TUGGI_COLORS.blue }}>{city.visit_count}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                      <span>{city.unique_visitors} visitantes • {city.audio_plays} áudios</span>
                      <span>{city.country}</span>
                    </div>
                    <div className="h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full transition-all duration-1000"
                        style={{ 
                          width: `${Math.min(100, (city.visit_count / (stats.mostVisitedCities[0]?.visit_count || 1)) * 100)}%`,
                          background: `linear-gradient(90deg, ${TUGGI_COLORS.blue}, ${TUGGI_COLORS.green})`
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                stats.cityDistribution.slice(0, 15).map((city, index) => (
                  <div key={city.city} className="group">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center">
                        <span className="text-xs font-black text-gray-400 w-6">{index + 1}</span>
                        <span className="font-bold text-gray-900 dark:text-white truncate">{city.city}</span>
                      </div>
                      <span className="text-sm font-black" style={{ color: TUGGI_COLORS.blue }}>{city.poi_count} POIs</span>
                    </div>
                    <div className="h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full transition-all duration-1000" style={{ width: `${Math.min(100, (city.poi_count / (stats.cityDistribution[0]?.poi_count || 1)) * 100)}%`, backgroundColor: TUGGI_COLORS.blue }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Top POIs */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center">
              <Play className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.orange }} />
              Top POIs Mais Visitados
            </h3>
            <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar">
              {stats.topVisitedPOIs.length > 0 ? (
                stats.topVisitedPOIs.map((poi, index) => (
                  <div key={poi.poi_id} className="flex items-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-tuggi-blue/30 transition-all">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-tuggi-blue/10 flex items-center justify-center mr-3">
                      <span className="text-sm font-black text-tuggi-blue">{index + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900 dark:text-white truncate">{poi.poi_name}</p>
                      <p className="text-xs text-gray-500">{poi.city}, {poi.country}</p>
                    </div>
                    <div className="text-right ml-3">
                      <div className="flex items-center text-tuggi-blue">
                        <Eye className="h-4 w-4 mr-1" />
                        <span className="font-black">{poi.total_visits}</span>
                      </div>
                      <p className="text-[10px] text-gray-400">{poi.audio_plays} áudios</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <Play className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>Nenhum dado de visitas disponível</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB: HEATMAP */}
      {/* ================================================================ */}
      {activeTab === 'heatmap' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
                <Map className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
                Mapa de Calor - Trilhas dos Usuários
              </h3>
              <div className="text-xs text-gray-500">
                {heatmapData.length.toLocaleString()} pontos • Últimos 90 dias
              </div>
            </div>
            <div className="h-[600px]">
              {isLoadingHeatmap ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tuggi-blue mx-auto mb-4" />
                    <p className="text-gray-500">Carregando dados do heatmap...</p>
                  </div>
                </div>
              ) : (
                <TrailMap
                  center={{ lat: -23.5505, lng: -46.6333 }}
                  zoom={10}
                  height="600px"
                  showHeatMap={true}
                  showTrails={false}
                  heatMapData={heatmapData}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}