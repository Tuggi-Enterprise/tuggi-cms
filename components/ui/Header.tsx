'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/app/providers'
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
  Users,
  UserCog,
  Smartphone
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TuggiLogo } from './TuggiLogo'

const navigation = [
  // Main
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    category: 'main'
  },
  
  // POI Management
  {
    name: 'Browse POIs',
    href: '/pois',
    icon: MapPin,
    category: 'pois'
  },
  {
    name: 'POI Migration',
    href: '/poi-migration',
    icon: ArrowRightLeft,
    category: 'pois'
  },
  {
    name: 'OSM Importer',
    href: '/osm-importer',
    icon: Database,
    category: 'pois'
  },
  {
    name: 'POI Fetching',
    href: '/poi-importer',
    icon: Upload,
    category: 'pois'
  },
  
  // Trigger Points
  {
    name: 'Generation',
    href: '/trigger-points-generation',
    icon: Target,
    category: 'trigger_points'
  },
  {
    name: 'Single Test',
    href: '/trigger-points-single',
    icon: Target,
    category: 'trigger_points'
  },
  
  // Users Management
  {
    name: 'CMS Team',
    href: '/users/cms',
    icon: UserCog,
    category: 'users'
  },
  {
    name: 'App Users',
    href: '/users/app',
    icon: Smartphone,
    category: 'users'
  },
  
  // Analytics / Visualization
  {
    name: 'Trail Map',
    href: '/trail-visualization',
    icon: Route,
    category: 'visualization'
  },
]

interface HeaderProps {
  className?: string
}

export function Header({ className }: HeaderProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const pathname = usePathname()
  const supabase = useSupabaseClient()
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDropdown && !(event.target as Element).closest('.dropdown-container')) {
        setOpenDropdown(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openDropdown])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const renderNavItem = (item: any, isActive: boolean, onClick?: () => void, showCategory?: boolean) => (
    <Link
      key={item.name}
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
                  key={item.name}
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
          {/* Logo */}
          <div className="flex-shrink-0">
            <TuggiLogo size="sm" showText={true} />
          </div>

                    {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center space-x-2">
            {/* Dashboard */}
            {navigation.filter(item => item.category === 'main').map((item) => {
              const isActive = pathname === item.href
              return renderNavItem(item, isActive)
            })}

            {/* POIs - Dropdown */}
            {(() => {
              const poiItems = navigation.filter(item => item.category === 'pois')
              return renderDropdown('pois', poiItems, 'POIs')
            })()}

            {/* Trigger Points - Dropdown */}
            {(() => {
              const triggerPointsItems = navigation.filter(item => item.category === 'trigger_points')
              return renderDropdown('trigger_points', triggerPointsItems, 'Trigger Points')
            })()}

            {/* Users - Dropdown */}
            {(() => {
              const userItems = navigation.filter(item => item.category === 'users')
              return renderDropdown('users', userItems, 'Users')
            })()}

            {/* Trail Map - Single item */}
            {navigation.filter(item => item.category === 'visualization').map((item) => {
              const isActive = pathname === item.href
              return renderNavItem(item, isActive)
            })}
          </nav>

          {/* Right side actions */}
          <div className="flex items-center space-x-1">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-all duration-300 hover:scale-105 hover:shadow-sm"
              title="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4 text-gray-600 dark:text-gray-400 transition-transform duration-300 hover:rotate-12" />
              ) : (
                <Moon className="h-4 w-4 text-gray-600 dark:text-gray-400 transition-transform duration-300 hover:rotate-12" />
              )}
            </button>

            {/* Logout button */}
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-300 hover:scale-105 hover:shadow-sm text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
              title="Logout"
            >
              <LogOut className="h-4 w-4 transition-transform duration-300 hover:translate-x-0.5" />
            </button>

            {/* Mobile menu button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-all duration-300 hover:scale-105"
            >
              {isMobileMenuOpen ? (
                <X className="h-4 w-4 text-gray-600 dark:text-gray-400 transition-transform duration-300 rotate-90" />
              ) : (
                <Menu className="h-4 w-4 text-gray-600 dark:text-gray-400 transition-transform duration-300" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMobileMenuOpen && (
          <div className="lg:hidden border-t border-tuggi-border/50 dark:border-gray-700/50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm animate-in slide-in-from-top-2 duration-300">
            <nav className="px-2 pt-2 pb-3 space-y-4">
              {/* Dashboard */}
              <div>
                <h4 className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Dashboard
                </h4>
                <div className="space-y-1">
                  {navigation.filter(item => item.category === 'main').map((item) => {
                    const isActive = pathname === item.href
                    return renderNavItem(item, isActive, () => setIsMobileMenuOpen(false), false)
                  })}
                </div>
              </div>

              {/* POIs */}
              <div>
                <h4 className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  POIs
                </h4>
                <div className="space-y-1">
                  {navigation.filter(item => item.category === 'pois').map((item) => {
                    const isActive = pathname === item.href
                    return renderNavItem(item, isActive, () => setIsMobileMenuOpen(false), false)
                  })}
                </div>
              </div>

              {/* Trigger Points */}
              <div>
                <h4 className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Trigger Points
                </h4>
                <div className="space-y-1">
                  {navigation.filter(item => item.category === 'trigger_points').map((item) => {
                    const isActive = pathname === item.href
                    return renderNavItem(item, isActive, () => setIsMobileMenuOpen(false), false)
                  })}
                </div>
              </div>

              {/* Users */}
              <div>
                <h4 className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Users
                </h4>
                <div className="space-y-1">
                  {navigation.filter(item => item.category === 'users').map((item) => {
                    const isActive = pathname === item.href
                    return renderNavItem(item, isActive, () => setIsMobileMenuOpen(false), false)
                  })}
                </div>
              </div>

              {/* Visualization */}
              <div>
                <h4 className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Visualization
                </h4>
                <div className="space-y-1">
                  {navigation.filter(item => item.category === 'visualization').map((item) => {
                    const isActive = pathname === item.href
                    return renderNavItem(item, isActive, () => setIsMobileMenuOpen(false), false)
                  })}
                </div>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  )
}
