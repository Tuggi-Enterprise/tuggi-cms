import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Trigger Points Generation | Tuggi CMS',
  description: 'Generate trigger points for POIs by country and city',
}

export default function TriggerPointsGenerationLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
