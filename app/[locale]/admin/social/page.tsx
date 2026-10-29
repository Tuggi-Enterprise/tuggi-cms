import { SocialAgendaPageContent } from '@/components/admin/social/SocialAgendaPageContent'
import { SocialMessagesProvider } from '@/lib/i18n/social-messages'

/** Server component on purpose: see `SocialMessagesProvider`. */
export default function LocalizedAdminSocialPage() {
  return (
    <SocialMessagesProvider>
      <SocialAgendaPageContent />
    </SocialMessagesProvider>
  )
}
