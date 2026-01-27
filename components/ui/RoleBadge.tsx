'use client'

import { cn } from '@/lib/utils'

// ============================================================================
// ROLE BADGE COMPONENT
// Shows user role with color coding
// ============================================================================

interface RoleBadgeProps {
  role: string
  className?: string
}

export const RoleBadge = ({ role, className }: RoleBadgeProps) => {
  const colors: Record<string, string> = {
    admin: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    editor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    viewer: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
    client: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
  }
  
  return (
    <span className={cn(
      'px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider inline-flex items-center',
      colors[role.toLowerCase()] || colors.viewer,
      className
    )}>
      {role}
    </span>
  )
}

export default RoleBadge
