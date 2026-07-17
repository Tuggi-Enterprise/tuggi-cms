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
  const [clientIds, setClientIds] = useState<string[]>([])
  const [isCoordinator, setIsCoordinator] = useState(false)
  const [coordinatorClientId, setCoordinatorClientId] = useState<string | null>(null)
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
          setClientIds(data.user?.clientIds || [])
          setIsCoordinator(Boolean(data.user?.isCoordinator))
          setCoordinatorClientId(data.user?.coordinatorClientId || null)
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
  // NB: 'super_admin' é inalcançável — o CHECK de core.cms_users.role só aceita
  // ('admin','editor','viewer','client'). Mantido só para não mudar comportamento aqui.
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
    /** @deprecated cms_users.client_id está NULL em todo client — use clientIds. */
    clientId,
    /** Vínculo real (core.client_cms_users + clients.cms_user_id). */
    clientIds,
    /** Capacidade explícita (core.clients.is_coordinator), não derivada de ter filhas. */
    isCoordinator,
    coordinatorClientId,
    enabledModules,
    hasEvents,
    hasPlaces,
    hasModule,
  }
}
