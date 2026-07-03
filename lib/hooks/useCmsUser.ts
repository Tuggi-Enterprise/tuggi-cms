'use client'

import { useState, useEffect } from 'react'
import { isModuleEnabled, type ModuleId } from '@/lib/modules'
import { isEventsEnabled } from '@/lib/modules/events'
import { isPlacesEnabled } from '@/lib/modules/places'

/**
 * Simple hook that fetches the current CMS user's role + module entitlements and
 * exposes convenient boolean helpers.  Most components previously duplicated
 * this logic by calling `/api/auth/check` directly and managing
 * `cmsUserRole` themselves.
 */
export function useCmsUser() {
  const [role, setRole] = useState<string | null>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [enabledModules, setEnabledModules] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchRole = async () => {
      try {
        const res = await fetch('/api/auth/check')
        if (res.ok) {
          const data = await res.json()
          setRole(data.user?.role || null)
          setClientId(data.user?.clientId || null)
          setEnabledModules(data.user?.enabledModules || [])
        }
      } catch (err) {
        console.error('useCmsUser: failed to fetch role', err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchRole()
  }, [])

  const isViewer = role === 'viewer'
  const isClient = role === 'client'
  const isAdmin = role === 'admin' || role === 'super_admin'
  const canEdit = !!role && !isViewer

  // Module entitlements (admin is omnipotent — decided by the SSOT in lib/modules).
  const entitlements = { role, enabledModules }
  const hasEvents = isEventsEnabled(entitlements)
  const hasPlaces = isPlacesEnabled(entitlements)
  const hasModule = (mod: ModuleId) => isModuleEnabled(mod, entitlements)

  return {
    role,
    isViewer,
    isClient,
    isAdmin,
    canEdit,
    isLoading,
    clientId,
    enabledModules,
    hasEvents,
    hasPlaces,
    hasModule,
  }
}
