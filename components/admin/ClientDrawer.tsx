'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ClientDetails } from './ClientDetails'

interface ClientDrawerProps {
  clientId: string | null
  isOpen: boolean
  onClose: () => void
}

export function ClientDrawer({ clientId, isOpen, onClose }: ClientDrawerProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!mounted) return null

  return (
    <>
      {/* Overlay */}
      <div 
        className={cn(
          "fixed inset-0 bg-black/40 backdrop-blur-sm z-50 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />
      
      {/* Drawer - Large premium width to match POI details (85%) */}
      <div 
        className={cn(
          "fixed top-0 right-0 h-full w-[85%] lg:w-[85%] max-w-[1600px] bg-white dark:bg-gray-950 z-50 shadow-2xl transition-transform duration-500 ease-out transform flex flex-col border-l border-gray-200 dark:border-gray-800 rounded-l-[2rem]",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 sticky top-0 z-10 rounded-tl-[2rem]">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
            Client Details
          </h2>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors text-gray-500"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto bg-gray-50/50 dark:bg-gray-950/50">
          {clientId && (
            <div className="py-8">
               <ClientDetails clientId={clientId} isDrawer={true} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
