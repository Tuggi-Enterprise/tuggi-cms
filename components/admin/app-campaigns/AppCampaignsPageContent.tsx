'use client'

/**
 * /admin/app-campaigns (#1192): the operator writes, turns on and turns off the campaigns of the app
 * (map carousel, launch sheet, Explore card) without SQL and without an app release.
 *
 * Same shape as /admin/coupons: a table with the on/off switch per row, and one drawer that creates
 * and edits. Page gate: `resolveAccess` (proxy, admin only). API gate: `withAuth({ roles: ['admin'] })`.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/Container'
import type { AppCampaign, CampaignError } from '@/lib/campaigns/app-campaigns'
import { AppCampaignsList } from './AppCampaignsList'
import { AppCampaignFormDrawer } from './AppCampaignFormDrawer'
import { useCampaignErrorText } from './useCampaignErrorText'

export function AppCampaignsPageContent() {
  const t = useTranslations('AppCampaigns')
  const errorText = useCampaignErrorText()
  const [campaigns, setCampaigns] = useState<AppCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<AppCampaign | null>(null)

  // No state set before the first await: the list stays on screen while it reloads.
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/app-campaigns')
      const data = await res.json()
      if (!res.ok) {
        setError(errorText(data.error as CampaignError | undefined))
        return
      }
      setCampaigns(data.campaigns ?? [])
      setError(null)
    } catch {
      setError(t('errors.network'))
    } finally {
      setLoading(false)
    }
  }, [errorText, t])

  useEffect(() => {
    load()
  }, [load])

  const toggle = async (campaign: AppCampaign) => {
    setTogglingId(campaign.id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/app-campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !campaign.is_active }),
      })
      const data = await res.json()
      // Reloaded either way: a coupon_sync_failed still changed the campaign.
      await load()
      if (!res.ok) setError(errorText(data.error as CampaignError | undefined))
    } catch {
      setError(t('errors.network'))
    } finally {
      setTogglingId(null)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setDrawerOpen(true)
  }

  const openEdit = (campaign: AppCampaign) => {
    setEditing(campaign)
    setDrawerOpen(true)
  }

  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <AppCampaignsList
          campaigns={campaigns}
          loading={loading}
          error={error}
          togglingId={togglingId}
          onCreate={openCreate}
          onEdit={openEdit}
          onToggle={toggle}
        />
      </Container>
      {drawerOpen && (
        // Keyed so every open starts from the row it edits, with no reset effect.
        <AppCampaignFormDrawer
          key={editing?.id ?? 'new'}
          campaign={editing}
          onClose={() => setDrawerOpen(false)}
          onSaved={load}
        />
      )}
    </div>
  )
}
