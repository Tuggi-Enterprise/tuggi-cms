import { Header } from '@/components/ui/Header'
import { requireAccess } from '@/lib/navigation/server-guard'

/**
 * A ÁRVORE `/dashboard` INTEIRA É DA TUGGI, e isto é o que passa a valer no servidor.
 *
 * O que havia antes: nenhuma pergunta. A única barreira era `proxy.ts`, e o #732 acrescentou
 * às RPCs do painel dez colunas de rastro, estado de guia e produto comprado — dado de turista
 * identificado. Uma barreira só para esse dado é uma a menos do que ele precisa (#733).
 *
 * Quem decide continua sendo `resolveAccess`, não este arquivo: hoje isso significa admin
 * entra, `client` vai para o painel dele (`/clients/dashboard`, decidido em 2026-07-17 quando
 * `/dashboard` saiu de `ALLOWED_CLIENT_PATHS`) e `editor`/`viewer` não entram. Se a régua
 * mudar, esta tela muda junto — e é justamente o que `tests/api/dashboard-role-guard.test.ts`
 * trava, inclusive a parte que este arquivo assume: que a decisão de `/dashboard` vale para
 * toda rota abaixo dele.
 *
 * O LAYOUT NÃO É A ÚLTIMA BARREIRA, e a doc oficial do Next avisa por quê: por Partial
 * Rendering ele não re-renderiza a cada navegação de cliente
 * (`nextjs.org/docs/app/guides/authentication`, "Layouts and auth checks", consultada em
 * 2026-09-11). Quem cobre a navegação seguinte é `proxy.ts`, que roda em toda requisição; quem
 * cobre o DADO é o banco (`core.resolve_dashboard_scope`, `core.assert_platform_admin()` e o
 * aperto do #733). São três camadas independentes, e nenhuma dispensa a outra.
 */
export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  await requireAccess('/dashboard', locale)

  return (
    <div className="flex flex-col h-screen bg-tuggi-background dark:bg-gray-900">
      <Header />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
