import { SocialPostEditorPageContent } from '@/components/admin/social/SocialPostEditorPageContent'
import { SocialMessagesProvider } from '@/lib/i18n/social-messages'

/** Server component on purpose: see `SocialMessagesProvider`. */
export default async function LocalizedAdminSocialPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <SocialMessagesProvider>
      <SocialPostEditorPageContent postId={id} />
    </SocialMessagesProvider>
  )
}
