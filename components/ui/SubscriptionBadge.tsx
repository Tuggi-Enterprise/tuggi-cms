'use client'

import { Crown, Apple, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// SUBSCRIPTION BADGE
// Shows user subscription tier (Free/Premium)
// ============================================================================

interface SubscriptionBadgeProps {
  isPremium: boolean
  tierName?: string | null
  className?: string
}

export const SubscriptionBadge = ({ isPremium, tierName, className }: SubscriptionBadgeProps) => {
  if (isPremium) {
    return (
      <span className={cn(
        "inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-yellow-400 to-orange-500 text-white shadow-sm",
        className
      )}>
        <Crown className="h-3 w-3 mr-1" />
        {tierName || 'Premium'}
      </span>
    )
  }
  
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
      className
    )}>
      Free
    </span>
  )
}

// ============================================================================
// PROVIDER ICON
// Shows subscription provider icon (Apple/Google/Stripe)
// ============================================================================

interface ProviderIconProps {
  provider: string | null
  className?: string
}

// PlayCircle icon for Google
const PlayCircle = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polygon points="10,8 16,12 10,16 10,8"/>
  </svg>
)

export const ProviderIcon = ({ provider, className }: ProviderIconProps) => {
  if (!provider) return null
  
  const iconClass = cn("h-3 w-3", className)
  
  switch (provider.toLowerCase()) {
    case 'apple':
      return <Apple className={cn(iconClass, "text-gray-600")} />
    case 'google':
      return <PlayCircle className={cn(iconClass, "text-green-600")} />
    case 'stripe':
      return <Zap className={cn(iconClass, "text-purple-600")} />
    default:
      return null
  }
}

// ============================================================================
// PLATFORM BADGE
// Shows device platform (iOS/Android)
// ============================================================================

interface PlatformBadgeProps {
  platform: string | null
  className?: string
}

export const PlatformBadge = ({ platform, className }: PlatformBadgeProps) => {
  const platformLower = platform?.toLowerCase()
  
  return (
    <span className={cn(
      "px-2 py-0.5 rounded text-xs font-bold",
      platformLower === 'ios' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 
      platformLower === 'android' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 
      'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
      className
    )}>
      {platform || 'N/A'}
    </span>
  )
}

export default SubscriptionBadge
