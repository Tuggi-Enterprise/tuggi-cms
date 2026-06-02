'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/navigation';
import { Mail, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCmsUser } from '@/lib/hooks/useCmsUser';
import { isMarketingEnabled } from '@/lib/modules/marketing';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('Pages.Marketing');
  const pathname = usePathname();
  const router = useRouter();
  const { role, isLoading } = useCmsUser();

  // Gate do módulo (stub central). Quando a flag real existir, basta mudar
  // isMarketingEnabled — rotas e menu acompanham.
  const enabled = isMarketingEnabled(role);
  useEffect(() => {
    if (!isLoading && !enabled) router.replace('/dashboard');
  }, [isLoading, enabled, router]);

  if (!isLoading && !enabled) return null;

  const tabs = [
    { href: '/dashboard/marketing/newsletter', label: t('tabs.newsletter'), icon: Mail },
    { href: '/dashboard/marketing/notifications', label: t('tabs.push'), icon: Bell },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="px-6 lg:px-8 pt-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
          <nav className="mt-4 flex gap-1">
            {tabs.map((tab) => {
              const active = pathname.startsWith(tab.href);
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 -mb-px transition-colors',
                    active
                      ? 'border-tuggi-blue text-tuggi-blue'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  )}
                >
                  <Icon size={16} />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <div className="p-6 lg:p-8">{children}</div>
    </div>
  );
}
