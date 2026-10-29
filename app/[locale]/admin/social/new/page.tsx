import { SocialPostEditorPageContent } from '@/components/admin/social/SocialPostEditorPageContent'
import { SocialMessagesProvider } from '@/lib/i18n/social-messages'

/** Server component on purpose: see `SocialMessagesProvider`. */
export default function LocalizedAdminSocialNewPage() {
  return (
    <SocialMessagesProvider>
      <SocialPostEditorPageContent postId={null} />
    </SocialMessagesProvider>
  )
}
