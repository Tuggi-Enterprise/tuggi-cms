import { requireAccess } from '@/lib/navigation/server-guard'
import { ClientDashboard } from '@/components/clients/ClientDashboard'

export const metadata = {
  title: 'My Clients - Tuggi CMS'
}

/**
 * ESTA PÁGINA DIZIA QUE ACEITAVA `client`, E NENHUM `client` JAMAIS CHEGOU AQUI.
 *
 * O teste era uma comparação de papel com literal, escrita à mão — a segunda definição de
 * "quem entra", divergente da régua desde 2026-07-17, quando `/dashboard` saiu de
 * `ALLOWED_CLIENT_PATHS` e o portão passou a mandar todo `client` de `/dashboard/*` para
 * `/clients/dashboard`. A comparação com literal não abria porta nenhuma: só fazia o arquivo
 * mentir sobre o público dele (#733, CLAUDE.md §6).
 *
 * Agora a pergunta é uma só, e é a mesma do proxy e do layout. Se a decisão de produto for
 * que o parceiro deve ter esta tela, ela não volta por um `if` aqui: volta por
 * `ALLOWED_CLIENT_PATHS` — e, por BR-CMS-002, sob `/clients/`, que é a árvore dele.
 */
export default async function MyClientsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  await requireAccess('/dashboard/my-clients', locale)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">My Clients</h1>
        <p className="text-gray-600 mt-2">Manage your clients and linked users</p>
      </div>

      <ClientDashboard />
    </div>
  )
}
