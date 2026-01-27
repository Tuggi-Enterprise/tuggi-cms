import { Metadata } from 'next'

export const metadata: Metadata = {
    title: 'Client Registration - Tuggi CMS',
    description: 'Register your business as a client'
}

export default function ClientRegistrationLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return <>{children}</>
}
