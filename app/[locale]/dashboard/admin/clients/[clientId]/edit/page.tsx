import ClientEditPage from '@/app/dashboard/admin/clients/[clientId]/edit/page'

export default async function LocalizedClientEditPage({
  params
}: {
  params: Promise<{ clientId: string }>
}) {
  const resolvedParams = await params
  return <ClientEditPage params={resolvedParams} />
}
