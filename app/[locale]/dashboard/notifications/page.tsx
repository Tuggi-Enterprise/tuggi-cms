
'use client';

import { NotificationManager } from '@/components/notifications/NotificationManager';

export default function NotificationsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8 flex flex-col">
      <NotificationManager />
    </div>
  );
}
