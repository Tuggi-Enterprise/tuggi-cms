'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2, Users, TrendingUp, Crown, QrCode, Plus, RefreshCw, AlertCircle,
  Copy, Check, Pencil, Network, Percent, CalendarClock, Trophy,
} from 'lucide-react'
import { StatCard } from '@/components/ui/StatCard'
import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { ClientQrCode } from '@/components/admin/clients/shared/ClientQrCode'
import { CoordinatorChildModal } from '@/components/clients/coordinator/CoordinatorChildModal'
import { cn } from '@/lib/utils'

const TUGGI = { blue: '#00A8E8', orange: '#FF6F00', green: '#10B981', purple: '#8B5CF6', slate: '#64748B' }

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
interface Root { id: string; company_name: string | null; slug: string | null }

export function CoordinatorOverview() {
  const [roots, setRoots] = useState<Root[]>([])
  const [rootId, setRootId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [children, setChildren] = useState<ChildRow[]>([])
  const [series, setSeries] = useState<SeriesPoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qrFor, setQrFor] = useState<ChildRow | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // undefined = fechado; null = criar; string = editar aquele childId.
  const [editModal, setEditModal] = useState<string | null | undefined>(undefined)

  // Descobre os guarda-chuvas visíveis. Coordenador: o seu. Admin: todos (com seletor).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/coordinator/roots')
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || 'Falha ao carregar')
        setIsAdmin(Boolean(json.isAdmin))
        setRoots(json.roots || [])
        setRootId(json.roots?.[0]?.id ?? null)
        if (!json.roots || json.roots.length === 0) setIsLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro desconhecido')
        setIsLoading(false)
      }
    })()
  }, [])

  const load = useCallback(async () => {
    if (!rootId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/coordinator/children?root=${encodeURIComponent(rootId)}`)
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
  }, [rootId])

  useEffect(() => { load() }, [load])

  // Consolidado = coordenador + filhas. Bate com dashboard_user_analytics(<root>).
  const totals = useMemo(() => children.reduce(
    (acc, c) => ({
      signups: acc.signups + Number(c.signups || 0),
      mau: acc.mau + Number(c.mau_30d || 0),
      premium: acc.premium + Number(c.premium_users || 0),
    }),
    { signups: 0, mau: 0, premium: 0 }
  ), [children])

  const companies = useMemo(() => children.filter(c => !c.is_root), [children])

  // Métricas derivadas para enriquecer a dash.
  const premiumRate = totals.signups > 0 ? (totals.premium / totals.signups) * 100 : 0
  const activeRate = totals.signups > 0 ? (totals.mau / totals.signups) * 100 : 0
  const avgPerCompany = companies.length > 0 ? totals.signups / companies.length : 0
  const thisMonth = series.length > 0 ? series[series.length - 1].signups : 0
  const topCompany = useMemo(
    () => [...children].sort((a, b) => Number(b.signups) - Number(a.signups))[0] ?? null,
    [children]
  )

  const copyUrl = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    } catch { /* clipboard indisponível — o link segue visível na tela */ }
  }

  const selectedRoot = roots.find(r => r.id === rootId) ?? null

  // ---- Estados de borda ----
  if (error) {
    return (
      <div className="min-h-screen bg-[#F0F2F5] p-4 dark:bg-gray-950 lg:p-6">
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Não foi possível carregar seu painel</p>
            <p className="mt-1 text-xs">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!isLoading && roots.length === 0) {
    return (
      <div className="min-h-screen bg-[#F0F2F5] p-4 dark:bg-gray-950 lg:p-6">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Nenhum guarda-chuva de afiliados configurado</p>
            <p className="mt-1 text-xs">
              {isAdmin
                ? 'Marque um cliente como coordenador (core.clients.is_coordinator = true) para gerenciar a rede dele aqui.'
                : 'Sua conta ainda não é um coordenador de afiliados. Fale com a Tuggi.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-[#F0F2F5] p-4 animate-in fade-in duration-500 dark:bg-gray-950 lg:p-6">
      {/* ===== Header da página ===== */}
      <header className="flex flex-col gap-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-tuggi-blue/10 p-3">
            <Network className="h-6 w-6 text-tuggi-blue" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Minha rede</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {selectedRoot?.company_name
                ? `Guarda-chuva de ${selectedRoot.company_name}`
                : 'Cadastros no app atribuídos às empresas do seu guarda-chuva'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {roots.length > 1 && (
            <select
              value={rootId ?? ''}
              onChange={e => setRootId(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-tuggi-blue/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              {roots.map(r => (
                <option key={r.id} value={r.id}>{r.company_name || r.slug || r.id}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => setEditModal(null)}
            className="inline-flex items-center gap-2 rounded-xl bg-tuggi-blue px-3 py-2 text-xs font-bold text-white shadow-md shadow-tuggi-blue/20 transition-all hover:bg-tuggi-blue/90 active:scale-[0.98]"
          >
            <Plus className="h-3.5 w-3.5" />
            Nova empresa
          </button>
        </div>
      </header>

      {/* ===== KPIs ===== */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Building2} label="Empresas" value={companies.length} color={TUGGI.blue} isLoading={isLoading}
          subtitle={`${avgPerCompany.toFixed(1)} cadastros/empresa`} />
        <StatCard icon={Users} label="Cadastros" value={totals.signups} color={TUGGI.green} isLoading={isLoading}
          subtitle={`+${thisMonth} este mês`} />
        <StatCard icon={TrendingUp} label="Ativos (30d)" value={totals.mau} color={TUGGI.orange} isLoading={isLoading}
          subtitle={`${activeRate.toFixed(0)}% da base`} />
        <StatCard icon={Crown} label="Premium" value={totals.premium} color={TUGGI.purple} isLoading={isLoading}
          subtitle={`${premiumRate.toFixed(0)}% de conversão`} />
        <StatCard icon={Percent} label="Conversão premium" value={`${premiumRate.toFixed(1)}%`} color={TUGGI.purple} isLoading={isLoading} />
        <StatCard icon={Trophy} label="Top empresa" value={topCompany?.company_name?.split(' ')[0] || '—'} color={TUGGI.slate} isLoading={isLoading}
          subtitle={topCompany ? `${topCompany.signups} cadastros` : undefined} />
      </div>

      {/* ===== Duas colunas: Empresas | Cadastros ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Coluna EMPRESAS */}
        <div className="lg:col-span-7">
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
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left dark:border-gray-800">
                      {['Empresa', 'Cadastros', 'Ativos', 'Premium', 'Último', 'QR'].map((h, i) => (
                        <th key={h} className={cn(
                          'px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-400',
                          i > 0 && i < 5 && 'text-right'
                        )}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {children.map(c => (
                      <tr key={c.client_id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 dark:border-gray-800/50 dark:hover:bg-gray-800/30">
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {c.company_name || '(sem nome)'}
                            </span>
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
                            {!c.is_root && (
                              <button type="button" onClick={() => setEditModal(c.client_id)}
                                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-tuggi-blue dark:hover:bg-gray-800"
                                title="Editar empresa">
                                <Pencil className="h-4 w-4" />
                              </button>
                            )}
                            <button type="button" onClick={() => setQrFor(c)}
                              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-tuggi-blue dark:hover:bg-gray-800"
                              title="Ver QR code">
                              <QrCode className="h-4 w-4" />
                            </button>
                            {c.qr_url && (
                              <button type="button" onClick={() => copyUrl(c.qr_url!, c.client_id)}
                                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-tuggi-blue dark:hover:bg-gray-800"
                                title="Copiar link">
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
        </div>

        {/* Coluna CADASTROS */}
        <div className="flex flex-col gap-4 lg:col-span-5">
          <WidgetCard>
            <SectionHeader icon={TrendingUp} iconColor={TUGGI.green} title="Cadastros por mês" />
            {series.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">Sem cadastros no período.</p>
            ) : (
              <div className="flex items-end gap-1 pt-2" style={{ height: 140 }}>
                {series.map(p => {
                  const max = Math.max(...series.map(s => s.signups), 1)
                  return (
                    <div key={p.month} className="group flex flex-1 flex-col items-center gap-1">
                      <span className="text-[10px] font-bold text-gray-500 opacity-0 transition-opacity group-hover:opacity-100">
                        {p.signups}
                      </span>
                      <div className="w-full rounded-t bg-tuggi-blue/80 transition-all group-hover:bg-tuggi-blue"
                        style={{ height: `${Math.max((p.signups / max) * 100, 3)}px` }} />
                      <span className="text-[9px] text-gray-400">{p.month.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </WidgetCard>

          <WidgetCard>
            <SectionHeader icon={Users} iconColor={TUGGI.orange} title="Resumo dos cadastros" />
            <dl className="space-y-3">
              <Row icon={Users} label="Total de cadastros" value={totals.signups} color={TUGGI.green} />
              <Row icon={TrendingUp} label="Ativos nos últimos 30 dias" value={`${totals.mau} (${activeRate.toFixed(0)}%)`} color={TUGGI.orange} />
              <Row icon={Crown} label="Assinantes premium" value={`${totals.premium} (${premiumRate.toFixed(0)}%)`} color={TUGGI.purple} />
              <Row icon={CalendarClock} label="Cadastros este mês" value={thisMonth} color={TUGGI.blue} />
              {topCompany && (
                <Row icon={Trophy} label="Empresa com mais cadastros"
                  value={`${topCompany.company_name ?? '—'} · ${topCompany.signups}`} color={TUGGI.slate} />
              )}
            </dl>
          </WidgetCard>
        </div>
      </div>

      {/* ===== Footer ===== */}
      <footer className="mt-auto flex flex-col items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white px-6 py-4 text-[11px] text-gray-400 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:flex-row">
        <p>
          Dados agregados e anônimos — sem informações pessoais dos usuários finais.
        </p>
        <p className="font-mono">
          Tuggi · Programa de afiliados{selectedRoot?.slug ? ` · /d/${selectedRoot.slug}` : ''}
        </p>
      </footer>

      {/* ===== Modais ===== */}
      {qrFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setQrFor(null)}>
          <div className="w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            <ClientQrCode clientId={qrFor.client_id} slug={qrFor.slug ?? undefined} />
            <button type="button" onClick={() => setQrFor(null)}
              className="mx-auto mt-3 block rounded-xl bg-white/90 px-4 py-2 text-xs font-bold text-gray-700">
              Fechar
            </button>
          </div>
        </div>
      )}

      {editModal !== undefined && (
        <CoordinatorChildModal
          childId={editModal ?? undefined}
          parentId={isAdmin ? rootId : null}
          isOpen
          onClose={() => setEditModal(undefined)}
          onSaved={() => { load() }}
        />
      )}
    </div>
  )
}

/** Linha de resumo (ícone + rótulo + valor) — usada na coluna de cadastros. */
function Row({ icon: Icon, label, value, color }: {
  icon: typeof Users; label: string; value: string | number; color: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        <Icon className="h-4 w-4 shrink-0" style={{ color }} />
        {label}
      </div>
      <span className="text-sm font-bold text-gray-900 dark:text-white">{value}</span>
    </div>
  )
}
