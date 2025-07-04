'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/app/providers'
import {
  LayoutDashboard,
  MapPin,
  Map,
  BarChart3,
  LogOut,
  Menu,
  X,
  Moon,
  Sun,
  Settings,
  Upload
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TuggiLogo } from './TuggiLogo'

const navigation = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    name: 'POI Management',
    href: '/pois',
    icon: MapPin,
  },
  {
    name: 'POI Fetchind',
    href: '/poi-importer',
    icon: Upload,
  },
  {
    name: 'Region Editor',
    href: '/regions',
    icon: Map,
  },
  {
    name: 'Analytics',
    href: '/analytics',
    icon: BarChart3,
  },
]

interface SidebarProps {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const pathname = usePathname()
  const supabase = useSupabaseClient()
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className={cn(
      'flex flex-col h-screen bg-white dark:bg-gray-900 border-r border-tuggi-border dark:border-gray-700 transition-all duration-300',
      isCollapsed ? 'w-16' : 'w-64',
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-tuggi-border dark:border-gray-700">
        <TuggiLogo 
          size="md" 
          showText={!isCollapsed}
          className={isCollapsed ? 'mx-auto' : ''}
        />
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {isCollapsed ? (
            <Menu className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          ) : (
            <X className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
                isActive
                  ? 'bg-tuggi-blue/10 text-tuggi-blue border-r-2 border-tuggi-blue'
                  : 'text-tuggi-text dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
                isCollapsed && 'justify-center'
              )}
              title={isCollapsed ? item.name : undefined}
            >
              <item.icon className={cn('h-5 w-5', !isCollapsed && 'mr-3')} />
              {!isCollapsed && <span>{item.name}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-tuggi-border dark:border-gray-700 p-3 space-y-1">
        <button
          onClick={toggleTheme}
          className={cn(
            'flex items-center w-full px-3 py-2 text-sm font-medium rounded-md text-tuggi-text dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors',
            isCollapsed && 'justify-center'
          )}
          title={isCollapsed ? 'Toggle theme' : undefined}
        >
          {theme === 'dark' ? (
            <Sun className={cn('h-5 w-5', !isCollapsed && 'mr-3')} />
          ) : (
            <Moon className={cn('h-5 w-5', !isCollapsed && 'mr-3')} />
          )}
          {!isCollapsed && <span>Toggle theme</span>}
        </button>
        
        <button
          onClick={handleLogout}
          className={cn(
            'flex items-center w-full px-3 py-2 text-sm font-medium rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors',
            isCollapsed && 'justify-center'
          )}
          title={isCollapsed ? 'Logout' : undefined}
        >
          <LogOut className={cn('h-5 w-5', !isCollapsed && 'mr-3')} />
          {!isCollapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  )
} 