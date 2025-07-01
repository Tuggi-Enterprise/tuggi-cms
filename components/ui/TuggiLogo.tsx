import { cn } from '@/lib/utils'

interface TuggiLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showText?: boolean
  className?: string
}

const sizeClasses = {
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-12 w-12 text-lg',
  xl: 'h-20 w-20 text-2xl'
}

const textSizeClasses = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-xl',
  xl: 'text-4xl'
}

export function TuggiLogo({ 
  size = 'md', 
  showText = true, 
  className 
}: TuggiLogoProps) {
  return (
    <div className={cn('flex items-center space-x-3', className)}>
      {/* Logo Icon */}
      <div className={cn(
        'bg-tuggi-blue rounded-xl flex items-center justify-center shadow-lg',
        sizeClasses[size]
      )}>
        <span className={cn('text-white font-bold', textSizeClasses[size])}>
          T
        </span>
      </div>
      
      {/* Logo Text */}
      {showText && (
        <div className="flex flex-col">
          <span className={cn(
            'font-bold text-tuggi-text dark:text-white leading-tight',
            textSizeClasses[size]
          )}>
            Tuggi
          </span>
          {size !== 'sm' && (
            <span className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
              CMS
            </span>
          )}
        </div>
      )}
    </div>
  )
} 