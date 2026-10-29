import { Suspense } from 'react'
import { SocialPageContent } from '@/components/admin/social/SocialPageContent'
import { SocialMessagesProvider } from '@/lib/i18n/social-messages'

/** Server component on purpose: see `SocialMessagesProvider`. The content reads the URL, hence `Suspense`. */
export default function LocalizedAdminSocialPage() {
  return (
    <SocialMessagesProvider>
      <Suspense>
        <SocialPageContent />
      </Suspense>
    </SocialMessagesProvider>
  )
}
