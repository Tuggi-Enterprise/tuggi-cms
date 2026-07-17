'use client'

import { useState, useEffect } from 'react'
import { Link, usePathname, useRouter } from '@/navigation'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { useTheme } from '@/app/[locale]/providers'
import { useTranslations } from 'next-intl'
import {
  LayoutDashboard,
  MapPin,
  LogOut,
  Menu,
  X,
  Moon,
  Sun,
  Upload,
  Database,
  Target,
  ChevronDown,
  ArrowRightLeft,
  Route,
  Plane,
  Users,
  UserCog,
  Smartphone,
  CheckCircle,
  Sparkles,
  MessageSquare,
  Settings,
  Activity,
  FileText,
  Map,
  LayoutList,
  Globe,
  Bell,
  Crown,
  Gift,
  Mail,
  CalendarDays,
  Store,
  Network
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { isMarketingEnabled } from '@/lib/modules/marketing'
import { isEventsEnabled } from '@/lib/modules/events'
import { isPlacesEnabled } from '@/lib/modules/places'
import { TuggiLogo } from './TuggiLogo'
import { LanguageSwitcher } from './LanguageSwitcher'

export function Header({ className }: { className?: string }) {
  const t = useTranslations('Navigation');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const pathname = usePathname()
  const supabase = useSupabaseClient()
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()

  const navigation = [
    { name: t('realtime'), href: '/dashboard/realtime', icon: Activity, category: 'reports' },
    { name: t('pois'), href: '/pois', icon: MapPin, category: 'points' },
    { name: t('custom_routes'), href: '/routes', icon: Route, category: 'points' },
    { name: t('catalog'), href: '/dashboard/reports/catalog', icon: Database, category: 'reports' },
    { name: t('geography'), href: '/dashboard/reports/geography', icon: MapPin, category: 'reports' },
    { name: t('users'), href: '/dashboard/reports/users', icon: Users, category: 'reports' },
    { name: t('engagement'), href: '/dashboard/reports/engagement', icon: Activity, category: 'reports' },
    { name: t('poi_migration'), href: '/poi-processing', icon: ArrowRightLeft, category: 'admin' },
    { name: t('osm_importer'), href: '/osm-importer', icon: Database, category: 'admin' },
    { name: t('poi_fetching'), href: '/poi-importer', icon: Upload, category: 'admin' },
    { name: t('tp_single_test'), href: '/trigger-points-single', icon: Target, category: 'admin' },
    { name: t('cms_team'), href: '/users/cms', icon: UserCog, category: 'users' },
    { name: t('app_users'), href: '/users/app', icon: Smartphone, category: 'users' },
    { name: t('trail_map'), href: '/trail-visualization', icon: Route, category: 'points' },
    { name: t('clients'), href: '/admin/clients', icon: Settings, category: 'admin' },
    { name: t('users'), href: '/admin/users', icon: Users, category: 'admin' },
    { name: t('poi_trigger_map'), href: '/admin/poi-trigger-map', icon: Map, category: 'admin' },
    { name: 'Audit Logs', href: '/admin/audit-logs', icon: Activity, category: 'admin' },
    { name: 'Coupons', href: '/admin/coupons', icon: Gift, category: 'marketing' },
    // Módulo Marketing (gated). Push migrou de /dashboard/notifications.
    ...(isMarketingEnabled() ? [
      { name: t('newsletter'), href: '/dashboard/marketing/newsletter', icon: Mail, category: 'marketing' },
      { name: t('notifications'), href: '/dashboard/marketing/notifications', icon: Bell, category: 'marketing' },
    ] : []),
  ]

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDropdown && !(event.target as Element).closest('.dropdown-container')) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openDropdown])

  const [userRole, setUserRole] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [enabledModules, setEnabledModules] = useState<string[]>([])
  const [isCoordinator, setIsCoordinator] = useState(false)
  const isAdmin = mounted && (userRole === 'admin' || userRole === 'super_admin')
  // Module entitlements (mounted-gated to avoid hydration mismatch).
  const hasEvents = mounted && isEventsEnabled({ role: userRole, enabledModules })
  const hasPlaces = mounted && isPlacesEnabled({ role: userRole, enabledModules })

  useEffect(() => {
    setMounted(true)
    const fetchRole = async () => {
      try {
        const res = await fetch('/api/auth/check')
        if (res.ok) {
          const data = await res.json()
          setUserRole(data.user?.role || null)
          setEnabledModules(data.user?.enabledModules || [])
          setIsCoordinator(Boolean(data.user?.isCoordinator))
        }
      } catch (err) {
        console.error('Failed to fetch user role for header:', err)
      }
    }
    fetchRole()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const renderNavItem = (item: any, isActive: boolean, onClick?: () => void, showCategory?: boolean) => (
    <Link
      key={item.href}
      href={item.href}
      className={cn(
        'flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-all duration-300 relative group overflow-hidden',
        isActive
          ? 'bg-tuggi-blue/10 text-tuggi-blue shadow-sm ring-1 ring-tuggi-blue/20'
          : 'text-tuggi-text dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-tuggi-blue dark:hover:text-tuggi-blue hover:shadow-sm'
      )}
      onClick={onClick}
      title={showCategory ? `${item.name} (${item.category})` : item.name}
    >
      <item.icon className={cn(
        'h-4 w-4 mr-2 transition-all duration-300',
        isActive ? 'scale-110 text-tuggi-blue' : 'group-hover:scale-110 group-hover:text-tuggi-blue'
      )} />
      <span className="relative z-10">{item.name}</span>
      {isActive && (
        <div className="absolute inset-0 bg-gradient-to-r from-tuggi-blue/5 to-transparent" />
      )}
      {isActive && (
        <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-tuggi-blue rounded-full animate-pulse" />
      )}
    </Link>
  )

  const renderDropdown = (category: string, items: any[], categoryName: string) => {
    const isOpen = openDropdown === category
    const hasActiveItem = items.some(item => pathname === item.href)
    
    return (
      <div className="relative dropdown-container" key={category}>
        <button
          onClick={() => setOpenDropdown(isOpen ? null : category)}
          className={cn(
            'flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-all duration-300 relative group',
            hasActiveItem
              ? 'bg-tuggi-blue/10 text-tuggi-blue shadow-sm ring-1 ring-tuggi-blue/20'
              : 'text-tuggi-text dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-tuggi-blue dark:hover:text-tuggi-blue'
          )}
        >
          <span className="relative z-10">{categoryName}</span>
          <ChevronDown className={cn(
            'h-4 w-4 ml-2 transition-transform duration-300',
            isOpen ? 'rotate-180' : ''
          )} />
          {hasActiveItem && (
            <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-tuggi-blue rounded-full animate-pulse" />
          )}
        </button>
        
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-2 z-50 animate-in slide-in-from-top-2 duration-200">
            {items.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center px-4 py-2 text-sm transition-colors duration-200',
                    isActive
                      ? 'bg-tuggi-blue/10 text-tuggi-blue'
                      : 'text-tuggi-text dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-tuggi-blue dark:hover:text-tuggi-blue'
                  )}
                  onClick={() => setOpenDropdown(null)}
                >
                  <item.icon className="h-4 w-4 mr-3" />
                  <span>{item.name}</span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <header className={cn(
      'bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-tuggi-border/50 dark:border-gray-700/50 shadow-sm sticky top-0 z-50 transition-all duration-300',
      className
    )}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex-shrink-0 flex items-center">
            <TuggiLogo size="sm" showText={true} />
            <div className="flex items-center ml-2 pl-2 border-l border-gray-200 dark:border-gray-700">
              <span className="text-lg md:text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                Studio
              </span>
            </div>
          </div>

          <nav className="hidden lg:flex items-center space-x-2">
            {/* Dashboard: admin vê a Overview global; cliente comum vê o painel dele; o
                coordenador não vê (usa "Minha rede"). O middleware bloqueia /dashboard*
                para não-admin, então mostrar o link genérico só confundiria. */}
            {isAdmin
              ? renderNavItem({ name: t('dashboard'), href: '/dashboard', icon: LayoutDashboard, category: 'main' }, pathname === '/dashboard')
              : (!isCoordinator && renderNavItem({ name: t('dashboard'), href: '/clients/dashboard', icon: LayoutDashboard, category: 'main' }, pathname.startsWith('/clients/dashboard')))}
            {/* Painel de afiliados. Coordenador (client com is_coordinator) sempre vê; admin
                também, para dar suporte a qualquer guarda-chuva. */}
            {(isCoordinator || isAdmin) && renderNavItem(
              { name: 'Minha rede', href: '/clients/coordinator', icon: Network, category: 'main' },
              pathname.startsWith('/clients/coordinator')
            )}
            {/* Gestão de Pontos (POIs/Rotas): coordenador gerencia afiliados, não POIs —
                some inteiro para ele. Cliente comum gerencia POIs e continua vendo.
                /trail-visualization é admin-only; events/places seguem gated por módulo. */}
            {!isCoordinator && renderDropdown('points', [
              ...navigation.filter(item => item.category === 'points' && item.href === '/pois'),
              ...(hasEvents ? [{ name: t('events'), href: '/events', icon: CalendarDays, category: 'points' }] : []),
              ...(hasPlaces ? [{ name: t('places'), href: '/places', icon: Store, category: 'points' }] : []),
              ...navigation.filter(item => item.category === 'points' && item.href !== '/pois'
                && (isAdmin || item.href === '/routes')),
            ], t('points_management'))}
            {isAdmin && isMarketingEnabled() && renderDropdown('marketing', navigation.filter(item => item.category === 'marketing'), t('marketing'))}
            {/* reports e users são inteiramente /dashboard/* e /users/* — bloqueados para
                não-admin pelo middleware. Só admin. */}
            {isAdmin && <div className="h-6 w-px bg-gray-200 dark:bg-gray-800 mx-2" />}
            {isAdmin && renderDropdown('reports', navigation.filter(item => item.category === 'reports'), t('reports'))}
            {isAdmin && renderDropdown('users', navigation.filter(item => item.category === 'users'), t('users'))}
            {isAdmin && renderDropdown('admin', navigation.filter(item => item.category === 'admin'), t('admin'))}
          </nav>

          <div className="flex items-center space-x-1">
            <LanguageSwitcher />
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-all duration-300 hover:scale-105">
              {theme === 'dark' ? <Sun className="h-4 w-4 text-gray-600 dark:text-gray-400" /> : <Moon className="h-4 w-4 text-gray-600 dark:text-gray-400" />}
            </button>
            <button onClick={handleLogout} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-300 hover:scale-105 text-gray-600 dark:text-gray-400 hover:text-red-600">
              <LogOut className="h-4 w-4" />
            </button>
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-all duration-300">
              {isMobileMenuOpen ? <X className="h-4 w-4 text-gray-600 dark:text-gray-400" /> : <Menu className="h-4 w-4 text-gray-600 dark:text-gray-400" />}
            </button>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div className="lg:hidden border-t border-tuggi-border/50 dark:border-gray-700/50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm animate-in slide-in-from-top-2 duration-300">
            <nav className="px-2 pt-2 pb-3 space-y-4">
              <div className="space-y-1">
                {isAdmin
                  ? renderNavItem({ name: t('dashboard'), href: '/dashboard', icon: LayoutDashboard, category: 'main' }, pathname === '/dashboard', () => setIsMobileMenuOpen(false))
                  : (!isCoordinator && renderNavItem({ name: t('dashboard'), href: '/clients/dashboard', icon: LayoutDashboard, category: 'main' }, pathname.startsWith('/clients/dashboard'), () => setIsMobileMenuOpen(false)))}
                {(isCoordinator || isAdmin) && renderNavItem({ name: 'Minha rede', href: '/clients/coordinator', icon: Network, category: 'main' }, pathname.startsWith('/clients/coordinator'), () => setIsMobileMenuOpen(false))}
              </div>
              {!isCoordinator && (
                <div>
                  <h4 className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('points_management')}</h4>
                  <div className="space-y-1">
                    {renderNavItem({ name: t('pois'), href: '/pois', icon: MapPin, category: 'points' }, pathname.startsWith('/pois'), () => setIsMobileMenuOpen(false))}
                    {hasEvents && renderNavItem({ name: t('events'), href: '/events', icon: CalendarDays, category: 'points' }, pathname.startsWith('/events'), () => setIsMobileMenuOpen(false))}
                    {hasPlaces && renderNavItem({ name: t('places'), href: '/places', icon: Store, category: 'points' }, pathname.startsWith('/places'), () => setIsMobileMenuOpen(false))}
                    {navigation.filter(item => item.category === 'points' && item.href !== '/pois'
                      && (isAdmin || item.href === '/routes')).map(item => renderNavItem(item, pathname.startsWith(item.href), () => setIsMobileMenuOpen(false)))}
                  </div>
                </div>
              )}
              {['marketing', 'reports', 'users', 'admin'].map(cat => {
                // reports/users/admin/marketing são todos admin-only (middleware bloqueia
                // não-admin em /dashboard/*, /users/*, /admin/*).
                if (!isAdmin) return null
                if (cat === 'marketing' && !isMarketingEnabled()) return null
                return (
                  <div key={cat}>
                    <h4 className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t(cat) || cat}</h4>
                    <div className="space-y-1">
                      {navigation.filter(item => item.category === (cat === 'dashboard' ? 'main' : cat === 'admin' ? 'admin' : cat)).map(item => renderNavItem(item, pathname === item.href, () => setIsMobileMenuOpen(false)))}
                    </div>
                  </div>
                )
              })}
            </nav>
          </div>
        )}
      </div>
    </header>
  )
}
