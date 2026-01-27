import { Header } from '@/components/ui/Header'

export default function UsersLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Header />
      {children}
    </>
  )
}
