'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Users, TrendingUp, Crown, QrCode, Plus, RefreshCw, AlertCircle, Copy, Check, Pencil } from 'lucide-react'
import { StatCard } from '@/components/ui/StatCard'
import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { ClientQrCode } from '@/components/admin/clients/shared/ClientQrCode'
import { CoordinatorChildModal } from '@/components/clients/coordinator/CoordinatorChildModal'
import { cn } from '@/lib/utils'

const TUGGI = { blue: '#00A8E8', orange: '#FF6F00', green: '#10B981', purple: '#8B5CF6' }

/** Uma linha de core.coordinator_child_breakdown. Só agregados — sem PII, por decisão de produto. */
interface ChildRow {
  client_id: string
  company_name: string | null
  slug: string | null
  status: string | null
  is_root: boolean
  qr_url: string | null
  signups: number
  mau_30d: number
  premium_users: number
  last_signup_at: string | null
}

interface SeriesPoint { month: string; signups: number; cumulative: number }

export function CoordinatorOverview() {
  const [children, setChildren] = useState<ChildRow[]>([])
  const [series, setSeries] = useState<SeriesPoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qrFor, setQrFor] = useState<ChildRow | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // undefined = fechado; null = criar; string = editar aquele childId.
  const [editModal, setEditModal] = useState<string | null | undefined>(undefined)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/coordinator/children')
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Falha ao carregar')
      setChildren(json.children || [])
      setSeries(json.timeseries || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Consolidado = coordenador + filhas. Bate com dashboard_user_analytics(<root>), que
  // agrega pelo mesmo core.client_scope_ids.
  const totals = useMemo(() => children.reduce(
    (acc, c) => ({
      signups: acc.signups + Number(c.signups || 0),
      mau: acc.mau + Number(c.mau_30d || 0),
      premium: acc.premium + Number(c.premium_users || 0),
    }),
    { signups: 0, mau: 0, premium: 0 }
  ), [children])

  const companies = useMemo(() => children.filter(c => !c.is_root), [children])

  const copyUrl = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    } catch { /* clipboard indisponível — o link segue visível na tela */ }
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">Não foi possível carregar seu painel</p>
          <p className="mt-1 text-xs">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Minha rede</h1>
          <p className="mt-1 text-sm text-gray-500">
            Cadastros no app atribuídos às empresas do seu guarda-chuva
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition-all hover:bg-gray-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => setEditModal(null)}
            className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-3 py-2 text-xs font-bold text-white shadow-md transition-all hover:bg-black"
          >
            <Plus className="h-3.5 w-3.5" />
            Nova empresa
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Building2} label="Empresas" value={companies.length} color={TUGGI.blue} isLoading={isLoading} />
        <StatCard icon={Users} label="Cadastros" value={totals.signups} color={TUGGI.green} isLoading={isLoading} />
        <StatCard icon={TrendingUp} label="Ativos (30d)" value={totals.mau} color={TUGGI.orange} isLoading={isLoading} />
        <StatCard icon={Crown} label="Premium" value={totals.premium} color={TUGGI.purple} isLoading={isLoading} />
      </div>

      <WidgetCard>
        <SectionHeader icon={Building2} iconColor={TUGGI.blue} title="Empresas do guarda-chuva" />

        {isLoading ? (
          <div className="space-y-2 py-4">
            {[0, 1, 2].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />)}
          </div>
        ) : children.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">Nenhuma empresa no seu guarda-chuva ainda.</p>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left dark:border-gray-800">
                  {['Empresa', 'Cadastros', 'Ativos 30d', 'Premium', 'Último', 'QR'].map((h, i) => (
                    <th key={h} className={cn(
                      'px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-400',
                      i > 0 && i < 5 && 'text-right'
                    )}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {children.map(c => (
                  <tr key={c.client_id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/50">
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {c.company_name || '(sem nome)'}
                        </span>
                        {/* O coordenador aparece na própria lista: ele também tem QR e capta direto. */}
                        {c.is_root && (
                          <span className="rounded-full bg-tuggi-blue/10 px-2 py-0.5 text-[10px] font-bold text-tuggi-blue">
                            você
                          </span>
                        )}
                      </div>
                      {c.slug && <span className="font-mono text-[10px] text-gray-400">/d/{c.slug}</span>}
                    </td>
                    <td className="px-2 py-3 text-right font-bold text-gray-900 dark:text-white">{c.signups}</td>
                    <td className="px-2 py-3 text-right text-gray-600 dark:text-gray-300">{c.mau_30d}</td>
                    <td className="px-2 py-3 text-right text-gray-600 dark:text-gray-300">{c.premium_users}</td>
                    <td className="px-2 py-3 text-right text-xs text-gray-400">
                      {c.last_signup_at ? new Date(c.last_signup_at).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Só filhas são editáveis aqui; o próprio coordenador se edita no painel admin/perfil. */}
                        {!c.is_root && (
                          <button
                            type="button"
                            onClick={() => setEditModal(c.client_id)}
                            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-tuggi-blue dark:hover:bg-gray-800"
                            title="Editar empresa"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setQrFor(c)}
                          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-tuggi-blue dark:hover:bg-gray-800"
                          title="Ver QR code"
                        >
                          <QrCode className="h-4 w-4" />
                        </button>
                        {c.qr_url && (
                          <button
                            type="button"
                            onClick={() => copyUrl(c.qr_url!, c.client_id)}
                            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-tuggi-blue dark:hover:bg-gray-800"
                            title="Copiar link"
                          >
                            {copied === c.client_id
                              ? <Check className="h-4 w-4 text-green-600" />
                              : <Copy className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WidgetCard>

      {series.length > 0 && (
        <WidgetCard>
          <SectionHeader icon={TrendingUp} iconColor={TUGGI.blue} title="Cadastros por mês" />
          <div className="flex items-end gap-1 pt-2" style={{ height: 120 }}>
            {series.map(p => {
              const max = Math.max(...series.map(s => s.signups), 1)
              return (
                <div key={p.month} className="group flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-gray-400 opacity-0 transition-opacity group-hover:opacity-100">
                    {p.signups}
                  </span>
                  <div
                    className="w-full rounded-t bg-tuggi-blue/80 transition-all group-hover:bg-tuggi-blue"
                    style={{ height: `${Math.max((p.signups / max) * 90, 3)}px` }}
                  />
                  <span className="text-[9px] text-gray-400">{p.month.slice(5)}</span>
                </div>
              )
            })}
          </div>
        </WidgetCard>
      )}

      {qrFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setQrFor(null)}
        >
          <div className="w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            {/* Reuso literal do componente do CMS — o QR do coordenador é o mesmo do admin. */}
            <ClientQrCode clientId={qrFor.client_id} slug={qrFor.slug ?? undefined} />
            <button
              type="button"
              onClick={() => setQrFor(null)}
              className="mx-auto mt-3 block rounded-xl bg-white/90 px-4 py-2 text-xs font-bold text-gray-700"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {editModal !== undefined && (
        <CoordinatorChildModal
          childId={editModal ?? undefined}
          isOpen
          onClose={() => setEditModal(undefined)}
          onSaved={() => { load() }}
        />
      )}
    </div>
  )
}
