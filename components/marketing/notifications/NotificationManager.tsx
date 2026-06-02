
'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Bell, Send, Layout, History, Sparkles, Clock, Target, Eye, User, Search, CheckCircle2, Zap } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { AudienceFilter } from '../shared/AudienceFilter';
import { TemplateManager } from './TemplateManager';
import { NotificationHistory } from './NotificationHistory';
import { useCmsUser } from '@/lib/hooks/useCmsUser';
import { NotificationService, NotificationPayload, AudienceFilters } from '@/lib/services/notification-service';
import { dashboardService } from '@/lib/services/dashboard-service';

export function NotificationManager() {
  const [activeTab, setActiveTab] = useState('broadcast');
  const [notification, setNotification] = useState<NotificationPayload>({
    title: '',
    body: '',
    data: {},
    imageUrl: '',
    badge: undefined // Added badge to initial state
  });
  const [deepLink, setDeepLink] = useState(''); // New state for deepLink
  const [isHighPriority, setIsHighPriority] = useState(true); // New state for priority
  const [filters, setFilters] = useState<AudienceFilters>({});
  const [scheduleAt, setScheduleAt] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  
  // Direct Push State
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<any[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const { canEdit, isViewer } = useCmsUser();

  const t = useTranslations('Pages.Notifications');

  // Load users for Direct Push
  useEffect(() => {
    if (activeTab === 'direct') {
      const fetchUsers = async () => {
        setIsLoadingUsers(true);
        try {
          const result = await dashboardService.getProfiles(50);
          if (result.success) setUsers(result.data || []);
        } catch (e) {
          console.error(e);
        } finally {
          setIsLoadingUsers(false);
        }
      };
      fetchUsers();
    }
  }, [activeTab]);

  const toggleUserSelection = (user: any) => {
    setSelectedUsers(prev => {
      const isSelected = prev.find(u => u.id === user.id);
      if (isSelected) {
        return prev.filter(u => u.id !== user.id);
      } else {
        return [...prev, user];
      }
    });
  };

  const handleSend = async () => {
    try {
      if (activeTab === 'direct' && selectedUsers.length === 0) {
        alert(t('alerts.select_client'));
        return;
      }

      setIsSending(true);
      const isScheduled = !!scheduleAt && activeTab !== 'direct'; // Don't allow scheduling for direct messages for now
      
      const payload: any = {
        type: activeTab === 'direct' ? 'user' : 'broadcast',
        notification: { // Modified to include deepLink in data
          ...notification,
          data: {
            ...notification.data,
            ...(deepLink ? { url: deepLink } : {})
          }
        },
        priority: isHighPriority ? 'high' : 'normal' // Set priority based on state
      };

      if (activeTab === 'direct' && selectedUsers.length > 0) {
        payload.userIds = selectedUsers.map(u => u.id); // Kept original mapping to IDs
      }

      if (isScheduled) {
        await NotificationService.schedule({
          ...payload,
          scheduleAt: new Date(scheduleAt).toISOString() // Ensure scheduleAt is ISO string
        });
        alert(t('alerts.success_scheduled'));
      } else {
        const response = await NotificationService.sendImmediate(payload);
        
        // If it was a direct push, verify if tokens were actually found
        if (activeTab === 'direct' && response.result?.success === 0 && response.result?.failure === 0) {
          alert(t('alerts.no_tokens_found'));
        } else {
          const targetLabel = activeTab === 'direct' 
            ? t('alerts.success_direct', { count: selectedUsers.length })
            : t('alerts.success_broadcast');
          alert(targetLabel);
        }
      }
      
      if (activeTab !== 'direct') {
        setNotification({ title: '', body: '', data: {}, imageUrl: '', badge: undefined }); // Reset badge
        setDeepLink(''); // Reset deepLink
        setIsHighPriority(true); // Reset priority
        setScheduleAt('');
      } else {
        // Reset selection after send in direct mode
        setSelectedUsers([]);
      }

    } catch (error) {
      console.error(error);
      alert(t('alerts.error_send'));
    } finally {
      setIsSending(false);
    }
  };

  const filteredUsers = users.filter(u => 
    (u.nickname?.toLowerCase().includes(userSearch.toLowerCase())) ||
    (u.full_name?.toLowerCase().includes(userSearch.toLowerCase())) ||
    (u.email?.toLowerCase().includes(userSearch.toLowerCase()))
  );

  const tabs = [
    { id: 'broadcast', label: t('tabs.broadcast'), icon: Send },
    { id: 'direct', label: t('tabs.direct'), icon: User },
    { id: 'templates', label: t('tabs.templates'), icon: Layout },
    { id: 'history', label: t('tabs.history'), icon: History },
  ];

  const activeTabId = activeTab === 'compose' ? 'broadcast' : activeTab; // Handle legacy state if any

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3 tracking-tight">
            <div className="p-2 bg-tuggi-blue/10 rounded-xl">
              <Bell className="h-8 w-8 text-tuggi-blue" />
            </div>
            {t('title')}
          </h1>
          <p className="text-gray-500 mt-1 font-medium">{t('subtitle')}</p>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800/50 p-1.5 rounded-2xl w-fit border border-gray-200 dark:border-gray-700">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-xl transition-all duration-300",
                activeTab === tab.id 
                  ? "bg-white dark:bg-gray-700 shadow-lg text-tuggi-blue scale-105" 
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50"
              )}
            >
              <Icon className={cn("h-4 w-4", activeTab === tab.id ? "text-tuggi-blue" : "text-gray-400")} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="mt-2 text-gray-900 dark:text-gray-100">
        {(activeTab === 'broadcast' || activeTab === 'direct') && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in slide-in-from-bottom-4 duration-500">
            {/* Left Column: Compose */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* User Selector for Direct Push */}
              {activeTab === 'direct' && (
                <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm border-t-4 border-t-tuggi-purple">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-bold flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Search className="h-5 w-5 text-tuggi-purple" />
                        {t('direct.title')}
                      </div>
                      {selectedUsers.length > 0 && (
                        <div className="px-3 py-1 bg-tuggi-purple text-white text-[10px] rounded-full font-bold animate-in zoom-in">
                          {selectedUsers.length} {t('direct.selected')}
                        </div>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input 
                        placeholder={t('direct.search_placeholder')}
                        className="pl-10 rounded-xl"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                      {isLoadingUsers ? (
                        [1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-50 dark:bg-gray-800 animate-pulse rounded-xl" />)
                      ) : filteredUsers.map(user => {
                        const isSelected = selectedUsers.some(u => u.id === user.id);
                        return (
                          <button
                            key={user.id}
                            onClick={() => toggleUserSelection(user)}
                            className={cn(
                              "flex items-center gap-3 p-3 rounded-xl border transition-all text-left group",
                              isSelected 
                                ? "bg-tuggi-purple/10 border-tuggi-purple shadow-sm" 
                                : "bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 hover:border-tuggi-purple/30"
                            )}
                          >
                            <div className={cn(
                              "h-10 w-10 rounded-full flex items-center justify-center font-bold text-white shadow-sm transition-transform group-hover:scale-110",
                              isSelected ? "bg-tuggi-purple" : "bg-gray-200 dark:bg-gray-700 text-gray-400"
                            )}>
                              {(user.nickname || user.full_name || '?')[0].toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-sm truncate">{user.nickname || user.full_name || 'No Name'}</p>
                              <p className="text-[10px] text-gray-400 truncate uppercase tracking-tighter">
                                {user.last_platform || 'No Platform'} • {user.language || '---'}
                              </p>
                            </div>
                            {isSelected && <CheckCircle2 className="h-5 w-5 text-tuggi-purple shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Advanced Settings Card */}
              <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden border-t-4 border-t-tuggi-blue">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg font-bold flex items-center gap-2 text-gray-800 dark:text-gray-100">
                    <Zap className="h-5 w-5 text-tuggi-blue" />
                    {t('advanced.title')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-2">
                    <Label className="font-bold text-gray-700 dark:text-gray-300">{t('advanced.label_link')}</Label>
                    <Input 
                      className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue"
                      value={deepLink} 
                      onChange={(e) => setDeepLink(e.target.value)}
                      placeholder={t('advanced.placeholder_link')}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                    <div className="space-y-0.5">
                      <Label className="font-bold text-gray-700 dark:text-gray-300">{t('advanced.label_priority')}</Label>
                      <p className="text-sm text-gray-500">{t('advanced.priority_hint')}</p>
                    </div>
                    <Checkbox 
                      checked={isHighPriority}
                      onCheckedChange={(checked) => setIsHighPriority(!!checked)}
                      className="h-6 w-6 rounded-md border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden border-t-4 border-t-tuggi-blue">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg font-bold flex items-center gap-2 text-gray-800 dark:text-gray-100">
                    <Sparkles className="h-5 w-5 text-tuggi-blue" />
                    {t('content.title')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-2">
                    <Label className="font-bold text-gray-700 dark:text-gray-300">{t('content.label_title')}</Label>
                    <Input 
                      className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue"
                      value={notification.title} 
                      onChange={(e) => setNotification({...notification, title: e.target.value})}
                      placeholder={t('content.placeholder_title')}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="font-bold text-gray-700 dark:text-gray-300">{t('content.label_body')}</Label>
                    <Textarea 
                      className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue min-h-[120px]"
                      value={notification.body}
                      onChange={(e) => setNotification({...notification, body: e.target.value})}
                      placeholder={t('content.placeholder_body')}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label className="font-bold text-gray-700 dark:text-gray-300">{t('content.label_image')}</Label>
                      <Input 
                        className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue"
                        value={notification.imageUrl}
                        onChange={(e) => setNotification({...notification, imageUrl: e.target.value})}
                        placeholder="https://example.com/image.png"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label className="font-bold text-gray-700 dark:text-gray-300">{t('content.label_badge')}</Label>
                      <Input 
                        type="number"
                        className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue"
                        value={notification.badge !== undefined ? notification.badge : ''}
                        onChange={(e) => setNotification({
                          ...notification, 
                          badge: e.target.value === '' ? undefined : parseInt(e.target.value)
                        })}
                        placeholder={t('content.placeholder_badge')}
                        min="0"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {activeTab !== 'direct' && (
                <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm border-t-4 border-t-tuggi-orange">
                  <CardHeader className="pb-4">
                      <CardTitle className="text-lg font-bold flex items-center gap-2 text-gray-800 dark:text-gray-100">
                        <Clock className="h-5 w-5 text-tuggi-orange" />
                        {t('scheduling.title')}
                      </CardTitle>
                  </CardHeader>
                  <CardContent>
                      <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                          <div className="grid gap-2 w-full md:w-auto">
                            <Label className="font-bold text-gray-700 dark:text-gray-300">{t('scheduling.label_date')}</Label>
                            <Input 
                                type="datetime-local" 
                                className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-orange focus:border-tuggi-orange w-full"
                                value={scheduleAt}
                                onChange={(e) => setScheduleAt(e.target.value)}
                            />
                          </div>
                          <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700 flex-1 w-full">
                            <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">
                              Status: <span className={cn("ml-1", scheduleAt ? "text-tuggi-orange" : "text-tuggi-green")}>
                                {scheduleAt ? t('scheduling.status_scheduled') + new Date(scheduleAt).toLocaleString() : t('scheduling.status_immediate')}
                              </span>
                            </p>
                          </div>
                      </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right Column */}
            <div className="space-y-8">
               {activeTab !== 'direct' ? (
                 <AudienceFilter filters={filters} onChange={setFilters} />
               ) : (
                 <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm border-t-4 border-t-tuggi-purple overflow-hidden">
                    <CardHeader>
                      <CardTitle className="text-lg font-bold flex items-center gap-2">
                        <User className="h-5 w-5 text-tuggi-purple" />
                        {t('direct.target_summary')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                       <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{t('direct.recipients_label')}</p>
                          {selectedUsers.length > 0 ? (
                            <div className="space-y-3">
                               {selectedUsers.slice(0, 3).map(user => (
                                 <div key={user.id} className="flex items-center gap-3">
                                    <div className="h-8 w-8 bg-tuggi-purple rounded-lg flex items-center justify-center text-white font-bold text-xs">
                                       {(user.nickname || user.full_name || '?')[0].toUpperCase()}
                                    </div>
                                    <div>
                                       <p className="font-bold text-gray-900 dark:text-white leading-none text-sm">{user.nickname || user.full_name}</p>
                                    </div>
                                 </div>
                               ))}
                               {selectedUsers.length > 3 && (
                                 <p className="text-xs font-bold text-gray-400 pl-11">+ {selectedUsers.length - 3} more clients</p>
                                )}
                            </div>
                          ) : (
                            <p className="text-sm font-bold text-gray-400 italic">{t('direct.no_clients')}</p>
                          )}
                       </div>
                       <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase px-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-tuggi-purple animate-pulse" />
                          {t('direct.bypass_hint')}
                       </div>
                    </CardContent>
                 </Card>
               )}
               
               <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-lg border-t-4 border-t-tuggi-green">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <Eye className="h-5 w-5 text-tuggi-green" />
                      {t('preview.title')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="border border-gray-100 dark:border-gray-800 rounded-3xl p-5 bg-white dark:bg-gray-950 shadow-inner">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="h-10 w-10 bg-tuggi-blue rounded-xl flex items-center justify-center text-white font-bold text-xl">T</div>
                          <div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('preview.app_name')}</p>
                            <p className="text-[10px] text-gray-400 uppercase">{t('preview.now')}</p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="font-bold text-gray-900 dark:text-white text-base leading-tight">{notification.title || t('preview.placeholder_title')}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400 leading-snug">{notification.body || t('preview.placeholder_body')}</p>
                        </div>
                        {notification.imageUrl && (
                            <div className="mt-4 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800">
                              <img src={notification.imageUrl} alt="Preview" className="w-full h-40 object-cover bg-gray-100" />
                            </div>
                        )}
                    </div>

                    {canEdit && (
                      <Button 
                          size="lg"
                          className={cn(
                            "w-full rounded-2xl font-bold text-lg py-6 shadow-xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]",
                            activeTab === 'direct' ? "bg-tuggi-purple hover:bg-purple-600" :
                            scheduleAt ? "bg-tuggi-orange hover:bg-orange-600" : "bg-tuggi-blue hover:bg-blue-600"
                          )}
                          onClick={handleSend}
                          disabled={isSending || !notification.title || !notification.body || (activeTab === 'direct' && selectedUsers.length === 0)}
                      >
                        {isSending ? (
                          <div className="flex items-center gap-2">
                            <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            {t('actions.sending')}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Send className="h-5 w-5" />
                            {activeTab === 'direct' ? t('actions.send_direct') : scheduleAt ? t('actions.schedule') : t('actions.send_now')}
                          </div>
                        )}
                      </Button>
                    )}
                    <p className="text-[10px] text-center text-gray-400 uppercase tracking-widest font-bold">{t('actions.footer')}</p>
                  </CardContent>
               </Card>
            </div>
          </div>
        )}
        {(activeTabId === 'templates') && (
          <div className="animate-in slide-in-from-bottom-4 duration-500">
            <TemplateManager onLoadTemplate={(t: any) => {
                setNotification({
                    title: t.title,
                    body: t.body,
                    imageUrl: t.image_url,
                    data: t.data || {}
                });
                setActiveTab('broadcast');
            }} />
          </div>
        )}
        
        {activeTabId === 'history' && (
          <div className="animate-in slide-in-from-bottom-4 duration-500">
            <NotificationHistory />
          </div>
        )}
      </div>
    </div>
  );
}
