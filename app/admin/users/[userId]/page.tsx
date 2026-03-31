import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Clock, Navigation, MapPin, ChevronRight, Activity, User, Plane, Calendar } from 'lucide-react'
import { useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react'
import { Container } from '@/components/ui/Container'
import { UserPassportStats } from '@/components/admin/passport/UserPassportStats'
import { TripList } from '@/components/admin/passport/TripList'
import { TripExplorationMap } from '@/components/admin/passport/TripExplorationMap'
import { PassportService, PassportStats, TripExploration } from '@/lib/core/passport-service'
import { cn } from '@/lib/utils'

export default function AdminUserPassportPage({
  params: paramsPromise
}: {
  params: Promise<{ userId: string }>
}) {
  const params = React.use(paramsPromise)
  const userId = params.userId
  const router = useRouter()
  const { session, isLoading: sessionLoading } = useSessionContext()
  const supabase = useSupabaseClient()
  
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [userData, setUserData] = useState<any>(null)
  
  // Passport Data
  const [stats, setStats] = useState<PassportStats | null>(null)
  const [trips, setTrips] = useState<any[]>([])
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [exploration, setExploration] = useState<TripExploration | null>(null)
  const [bufferMeters, setBufferMeters] = useState(1000)
  const [isExplorationLoading, setIsExplorationLoading] = useState(false)

  // Auth & Initial Data
  useEffect(() => {
    const checkAuth = async () => {
      if (sessionLoading) return
      if (!session) {
        router.push('/login')
        return
      }

      try {
        const { data: cmsUser } = await supabase
          .schema('core')
          .from('cms_users')
          .select('role')
          .eq('email', session.user.email)
          .single()

        if (cmsUser?.role !== 'admin') {
          router.push('/unauthorized')
          return
        }

        // Fetch target user 
        const { data: targetUser } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single()

        setUserData(targetUser)
        setIsAuthorized(true)
        
        // Fetch Passport Stats
        const [pStats, uTrips] = await Promise.all([
          PassportService.getUserStats(supabase, userId),
          PassportService.getUserTrips(supabase, userId)
        ])
        
        setStats(pStats)
        setTrips(uTrips || [])
        
        // Select first trip by default if available
        if (uTrips && uTrips.length > 0) {
          setSelectedTripId(uTrips[0].trip_session_id)
        }

      } catch (error) {
        console.error('Passport Error:', error)
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [session, sessionLoading, router, supabase, userId])

  // Select Trip & Fetch Exploration
  useEffect(() => {
    if (!selectedTripId) return

    const fetchExploration = async () => {
      setIsExplorationLoading(true)
      const data = await PassportService.getTripExploration(supabase, selectedTripId, bufferMeters)
      setExploration(data)
      setIsExplorationLoading(false)
    }

    fetchExploration()
  }, [selectedTripId, bufferMeters])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50/50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-tuggi-blue mx-auto mb-6 shadow-xl shadow-tuggi-blue/20"></div>
          <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Authenticating Passport...</p>
        </div>
      </div>
    )
  }

  if (!isAuthorized) return null

  return (
    <div className="min-h-screen bg-gray-50/30 flex flex-col">
      {/* Premium Header */}
      <div className="bg-white/80 backdrop-blur-xl border-b border-gray-100 sticky top-0 z-50">
        <Container className="py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <nav className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
              <Link href="/admin/users" className="text-gray-400 hover:text-tuggi-blue transition-colors">Users</Link>
              <ChevronRight className="w-3 h-3 text-gray-300" />
              <span className="text-gray-900">User Passport</span>
            </nav>
            
            <div className="flex items-center gap-4">
              <div className="text-right hidden md:block">
                <h2 className="text-sm font-bold text-gray-900 leading-none mb-1">
                  {userData?.nickname || userData?.full_name || 'Individual Contributor'}
                </h2>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{userData?.email || userId}</p>
              </div>
              <div className="w-10 h-10 rounded-2xl bg-tuggi-blue/10 flex items-center justify-center border border-tuggi-blue/20">
                <User className="h-5 w-5 text-tuggi-blue" />
              </div>
            </div>
          </div>
        </Container>
      </div>

      <Container className="py-8 flex-1 flex flex-col">
        {/* Title Section */}
        <div className="flex items-center gap-4 mb-8">
           <div className="p-4 bg-orange-600 shadow-xl shadow-orange-600/20 rounded-[28px]">
              <Plane className="h-8 w-8 text-white" />
           </div>
           <div>
             <h1 className="text-4xl font-extrabold text-gray-900 tracking-tighter leading-tight">User Passport</h1>
             <p className="text-gray-400 font-bold text-xs uppercase tracking-widest mt-1">Gamification Analytics & Exploration History</p>
           </div>
        </div>

        {/* Global Stats Row */}
        <UserPassportStats stats={stats} />

        {/* Exploration Section */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 min-h-0 mt-4">
          {/* Left: Trip List */}
          <div className="lg:col-span-4 flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between mb-4 px-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-400" />
                <h3 className="font-bold text-gray-900 uppercase tracking-widest text-[10px]">Trip History</h3>
              </div>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{trips.length} Trips</span>
            </div>
            <TripList 
              trips={trips} 
              selectedTripId={selectedTripId} 
              onSelectTrip={(id) => setSelectedTripId(id)}
              isLoading={isLoading}
            />
          </div>

          {/* Right: Exploration Map */}
          <div className="lg:col-span-8 flex flex-col h-full min-h-[600px]">
            <TripExplorationMap 
              exploration={exploration}
              bufferMeters={bufferMeters}
              onBufferChange={(m) => setBufferMeters(m)}
              isLoading={isExplorationLoading}
            />
          </div>
        </div>
      </Container>
    </div>
  )
}
