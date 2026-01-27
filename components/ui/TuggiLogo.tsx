import { cn } from '@/lib/utils'

interface TuggiLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showText?: boolean
  className?: string
}

const heightClasses = {
  sm: 'h-8',
  md: 'h-10',
  lg: 'h-16',
  xl: 'h-24'
}

export function TuggiLogo({ 
  size = 'md', 
  showText = true, 
  className 
}: TuggiLogoProps) {
  
  if (showText) {
    return (
      <div className={cn('relative w-auto flex items-center', heightClasses[size], className)}>
        <img
          src="/tuggi-logo-full.png"
          alt="Tuggi"
          className="h-full w-auto object-contain"
        />
        {size !== 'sm' && (
          <span className="ml-3 text-xs md:text-sm font-medium text-gray-500 dark:text-gray-400 border-l border-gray-300 dark:border-gray-600 pl-3">
            CMS
          </span>
        )}
      </div>
    )
  }

  return (
    <div className={cn('relative aspect-square', heightClasses[size], className)}>
      <img
        src="/tuggi-icon.png"
        alt="Tuggi"
        className="h-full w-full object-contain"
      />
    </div>
  )
} 