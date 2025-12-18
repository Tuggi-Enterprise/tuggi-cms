'use client'

import { ClientRegistrationForm } from '@/components/clients/ClientRegistrationForm'

export default function ClientRegistrationWrapper() {
  return (
    <ClientRegistrationForm
      onSuccess={(message) => {
        alert('✅ ' + message)
      }}
      onError={(error) => {
        alert('❌ ' + error)
      }}
    />
  )
}
