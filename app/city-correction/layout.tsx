import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Correção de Cidades | Tuggi CMS',
  description: 'Sistema automático para correção de cidades incorretas nos POIs usando geocoding reverso gratuito',
}

export default function CityCorrectionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
