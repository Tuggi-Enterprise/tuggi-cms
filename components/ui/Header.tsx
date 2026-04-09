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
  Crown
} from 'lucide-react'
import { cn } from '@/lib/utils'
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
    { name: t('overview'), href: '/dashboard', icon: LayoutDashboard, category: 'main' },
    { name: t('realtime'), href: '/dashboard/realtime', icon: Activity, category: 'main' },
    { name: t('pois'), href: '/pois', icon: MapPin, category: 'pois' },
    { name: t('custom_routes'), href: '/routes', icon: Route, category: 'pois' },
    { name: t('inventory'), href: '/dashboard/reports/inventory', icon: Database, category: 'reports' },
    { name: t('territorial'), href: '/dashboard/reports/territorial', icon: Globe, category: 'reports' },
    { name: t('heatmap'), href: '/dashboard/reports/heatmap', icon: Map, category: 'reports' },
    { name: t('users'), href: '/dashboard/reports/users', icon: Users, category: 'reports' },
    { name: t('engagement'), href: '/dashboard/reports/engagement', icon: Activity, category: 'reports' },
    { name: t('content_coverage'), href: '/dashboard/reports/content-coverage', icon: FileText, category: 'reports' },
    { name: t('premium'), href: '/dashboard/reports/premium', icon: Crown, category: 'reports' },
    { name: t('poi_migration'), href: '/poi-processing', icon: ArrowRightLeft, category: 'poi_management' },
    { name: t('osm_importer'), href: '/osm-importer', icon: Database, category: 'poi_management' },
    { name: t('poi_fetching'), href: '/poi-importer', icon: Upload, category: 'poi_management' },
    { name: t('tp_single_test'), href: '/trigger-points-single', icon: Target, category: 'poi_management' },
    { name: t('cms_team'), href: '/users/cms', icon: UserCog, category: 'users' },
    { name: t('app_users'), href: '/users/app', icon: Smartphone, category: 'users' },
    { name: t('trail_map'), href: '/trail-visualization', icon: Route, category: 'pois' },
    { name: t('clients'), href: '/admin/clients', icon: Settings, category: 'admin' },
    { name: t('users'), href: '/admin/users', icon: Users, category: 'admin' },
    { name: t('poi_trigger_map'), href: '/admin/poi-trigger-map', icon: Map, category: 'admin' },
    { name: 'Audit Logs', href: '/admin/audit-logs', icon: Activity, category: 'admin' },
    { name: t('notifications'), href: '/dashboard/notifications', icon: Bell, category: 'admin' },
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
  const isAdmin = mounted && (userRole === 'admin' || userRole === 'super_admin' || true) // Forced true for dev

  useEffect(() => {
    setMounted(true)
    const fetchRole = async () => {
      try {
        const res = await fetch('/api/auth/check')
        if (res.ok) {
          const data = await res.json()
          setUserRole(data.user?.role || null)
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
                City OS
              </span>
            </div>
          </div>

          <nav className="hidden lg:flex items-center space-x-2">
            {renderDropdown('main', navigation.filter(item => item.category === 'main'), t('dashboard'))}
            {renderDropdown('pois', navigation.filter(item => item.category === 'pois'), t('pois'))}
            {renderDropdown('poi_management', navigation.filter(item => item.category === 'poi_management'), t('poi_management'))}
            <div className="h-6 w-px bg-gray-200 dark:bg-gray-800 mx-2" />
            {renderDropdown('reports', navigation.filter(item => item.category === 'reports'), t('reports'))}
            {renderDropdown('users', navigation.filter(item => item.category === 'users'), t('users'))}
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
              {['dashboard', 'pois', 'poi_management', 'users', 'admin'].map(cat => {
                if (cat === 'admin' && !isAdmin) return null
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
