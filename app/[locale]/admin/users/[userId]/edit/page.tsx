import UserEditPage from '@/app/admin/users/[userId]/edit/page'

export default async function LocalizedUserEditPage({
  params
}: {
  params: Promise<{ userId: string }>
}) {
  const resolvedParams = await params
  return <UserEditPage params={resolvedParams} />
}
