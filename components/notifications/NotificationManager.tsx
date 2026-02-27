
'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Bell, Send, Layout, History, Sparkles, Clock, Target, Eye, User, Search, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { AudienceFilter } from './AudienceFilter';
import { TemplateManager } from './TemplateManager';
import { useCmsUser } from '@/lib/hooks/useCmsUser';
import { NotificationService, NotificationPayload, AudienceFilters } from '@/lib/services/notification-service';
import { dashboardService } from '@/lib/services/dashboard-service';

export function NotificationManager() {
  const [activeTab, setActiveTab] = useState('compose');
  const [notification, setNotification] = useState<NotificationPayload>({
    title: '',
    body: '',
    data: {},
    imageUrl: ''
  });
  const [filters, setFilters] = useState<AudienceFilters>({});
  const [scheduleAt, setScheduleAt] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  
  // Test Mode State
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const { canEdit, isViewer } = useCmsUser();

  const t = useTranslations('Navigation');

  // Load users for Test Mode
  useEffect(() => {
    if (activeTab === 'test') {
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

  const handleSend = async () => {
    try {
      if (activeTab === 'test' && !selectedUser) {
        alert('Please select a user to send the test notification.');
        return;
      }

      setIsSending(true);
      const isScheduled = !!scheduleAt && activeTab !== 'test'; // Don't allow scheduling for tests
      
      const payload: any = {
        type: activeTab === 'test' ? 'user' : 'broadcast',
        notification,
        priority: 'high' // Fast delivery for tests
      };

      if (activeTab === 'test' && selectedUser) {
        payload.userIds = [selectedUser.id];
      }

      if (isScheduled) {
        await NotificationService.schedule({
          ...payload,
          scheduleAt
        });
        alert('Notification Scheduled Successfully!');
      } else {
        await NotificationService.sendImmediate(payload);
        alert(activeTab === 'test' ? `Test notification sent to ${selectedUser.nickname || selectedUser.full_name}!` : 'Notification Sent Successfully!');
      }
      
      // Don't reset notification in test mode to allow quick iterations
      if (activeTab !== 'test') {
        setNotification({ title: '', body: '', data: {}, imageUrl: '' });
        setScheduleAt('');
      }

    } catch (error) {
      console.error(error);
      alert('Failed to send notification. Please check your configuration.');
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
    { id: 'compose', label: 'Compose', icon: Send },
    { id: 'templates', label: 'Templates', icon: Layout },
    { id: 'test', label: 'Test Mode', icon: User },
    { id: 'history', label: 'History', icon: History },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 dark:text-white flex items-center gap-3">
            <div className="p-2 bg-tuggi-blue/10 rounded-xl">
              <Bell className="h-8 w-8 text-tuggi-blue" />
            </div>
            {t('notifications')}
          </h1>
          <p className="text-gray-500 mt-2 font-medium">Create, schedule and manage push notifications for your application users.</p>
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
        {(activeTab === 'compose' || activeTab === 'test') && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in slide-in-from-bottom-4 duration-500">
            {/* Left Column: Compose */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* User Selector for Test Mode */}
              {activeTab === 'test' && (
                <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm border-t-4 border-t-tuggi-purple">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <Search className="h-5 w-5 text-tuggi-purple" />
                      Select Target User for Test
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input 
                        placeholder="Search by nickname, name or email..." 
                        className="pl-10 rounded-xl"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                      {isLoadingUsers ? (
                        [1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-50 dark:bg-gray-800 animate-pulse rounded-xl" />)
                      ) : filteredUsers.map(user => (
                        <button
                          key={user.id}
                          onClick={() => setSelectedUser(user)}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-xl border transition-all text-left group",
                            selectedUser?.id === user.id 
                              ? "bg-tuggi-purple/10 border-tuggi-purple shadow-sm" 
                              : "bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 hover:border-tuggi-purple/30"
                          )}
                        >
                          <div className={cn(
                            "h-10 w-10 rounded-full flex items-center justify-center font-bold text-white shadow-sm transition-transform group-hover:scale-110",
                            selectedUser?.id === user.id ? "bg-tuggi-purple" : "bg-gray-200 dark:bg-gray-700 text-gray-400"
                          )}>
                            {(user.nickname || user.full_name || '?')[0].toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm truncate">{user.nickname || user.full_name || 'No Name'}</p>
                            <p className="text-[10px] text-gray-400 truncate uppercase tracking-tighter">
                              {user.last_platform || 'No Platform'} • {user.language || '---'}
                            </p>
                          </div>
                          {selectedUser?.id === user.id && <CheckCircle2 className="h-5 w-5 text-tuggi-purple shrink-0" />}
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden border-t-4 border-t-tuggi-blue">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg font-bold flex items-center gap-2 text-gray-800 dark:text-gray-100">
                    <Sparkles className="h-5 w-5 text-tuggi-blue" />
                    Notification Content
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-2">
                    <Label className="font-bold text-gray-700 dark:text-gray-300">Title</Label>
                    <Input 
                      className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue"
                      value={notification.title} 
                      onChange={(e) => setNotification({...notification, title: e.target.value})}
                      placeholder="e.g. Test push incoming! 🔔"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="font-bold text-gray-700 dark:text-gray-300">Message Body</Label>
                    <Textarea 
                      className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue min-h-[120px]"
                      value={notification.body}
                      onChange={(e) => setNotification({...notification, body: e.target.value})}
                      placeholder="Enter the main content of your notification..."
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="font-bold text-gray-700 dark:text-gray-300">Image URL (Optional)</Label>
                    <Input 
                      className="rounded-xl border-gray-200 dark:border-gray-700 focus:ring-tuggi-blue focus:border-tuggi-blue"
                      value={notification.imageUrl}
                      onChange={(e) => setNotification({...notification, imageUrl: e.target.value})}
                      placeholder="https://example.com/image.png"
                    />
                  </div>
                </CardContent>
              </Card>

              {activeTab !== 'test' && (
                <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm border-t-4 border-t-tuggi-orange">
                  <CardHeader className="pb-4">
                      <CardTitle className="text-lg font-bold flex items-center gap-2 text-gray-800 dark:text-gray-100">
                        <Clock className="h-5 w-5 text-tuggi-orange" />
                        Scheduling Settings
                      </CardTitle>
                  </CardHeader>
                  <CardContent>
                      <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                          <div className="grid gap-2 w-full md:w-auto">
                            <Label className="font-bold text-gray-700 dark:text-gray-300">Scheduled Date & Time</Label>
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
                                {scheduleAt ? 'Scheduled for ' + new Date(scheduleAt).toLocaleString() : 'Will be sent immediately'}
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
               {activeTab !== 'test' ? (
                 <AudienceFilter filters={filters} onChange={setFilters} />
               ) : (
                 <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm border-t-4 border-t-tuggi-purple overflow-hidden">
                    <CardHeader>
                      <CardTitle className="text-lg font-bold flex items-center gap-2">
                        <User className="h-5 w-5 text-tuggi-purple" />
                        Test Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                       <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700">
                          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Target Recipient</p>
                          {selectedUser ? (
                            <div className="flex items-center gap-3">
                               <div className="h-10 w-10 bg-tuggi-purple rounded-xl flex items-center justify-center text-white font-black text-lg">
                                  {(selectedUser.nickname || selectedUser.full_name || '?')[0].toUpperCase()}
                               </div>
                               <div>
                                  <p className="font-black text-gray-900 dark:text-white leading-none">{selectedUser.nickname || selectedUser.full_name}</p>
                                  <p className="text-xs text-tuggi-purple font-bold mt-1">Direct Push Enabled</p>
                               </div>
                            </div>
                          ) : (
                            <p className="text-sm font-bold text-gray-400 italic">No user selected</p>
                          )}
                       </div>
                       <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase px-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-tuggi-purple animate-pulse" />
                          Test Mode Bypass Scheduling
                       </div>
                    </CardContent>
                 </Card>
               )}
               
               <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-lg border-t-4 border-t-tuggi-green">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <Eye className="h-5 w-5 text-tuggi-green" />
                      Live Preview
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="border border-gray-100 dark:border-gray-800 rounded-3xl p-5 bg-white dark:bg-gray-950 shadow-inner">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="h-10 w-10 bg-tuggi-blue rounded-xl flex items-center justify-center text-white font-black text-xl">T</div>
                          <div>
                            <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Tuggi App</p>
                            <p className="text-[10px] text-gray-400 uppercase">Now</p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="font-black text-gray-900 dark:text-white text-base leading-tight">{notification.title || 'Notification Title'}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400 leading-snug">{notification.body || 'Type a message to see how it looks on your users devices...'}</p>
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
                            "w-full rounded-2xl font-black text-lg py-6 shadow-xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]",
                            activeTab === 'test' ? "bg-tuggi-purple hover:bg-purple-600" :
                            scheduleAt ? "bg-tuggi-orange hover:bg-orange-600" : "bg-tuggi-blue hover:bg-blue-600"
                          )}
                          onClick={handleSend}
                          disabled={isSending || !notification.title || !notification.body || (activeTab === 'test' && !selectedUser)}
                      >
                        {isSending ? (
                          <div className="flex items-center gap-2">
                            <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Sending...
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Send className="h-5 w-5" />
                            {activeTab === 'test' ? 'Send Test Push' : scheduleAt ? 'Schedule' : 'Send Now'}
                          </div>
                        )}
                      </Button>
                    )}
                    <p className="text-[10px] text-center text-gray-400 uppercase tracking-widest font-bold">Secure Delivery via Firebase FCM</p>
                  </CardContent>
               </Card>
            </div>
          </div>
        )}

        {activeTab === 'templates' && (
          <div className="animate-in slide-in-from-bottom-4 duration-500">
            <TemplateManager onLoadTemplate={(t: any) => {
                setNotification({
                    title: t.title,
                    body: t.body,
                    imageUrl: t.image_url,
                    data: t.data || {}
                });
                setActiveTab('compose');
            }} />
          </div>
        )}
        
        {activeTab === 'history' && (
          <div className="animate-in slide-in-from-bottom-4 duration-500">
            <Card className="rounded-2xl border-gray-200 dark:border-gray-800 p-12 flex flex-col items-center justify-center text-center">
                <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-full mb-4">
                  <History className="h-12 w-12 text-gray-300" />
                </div>
                <CardTitle className="text-2xl font-black text-gray-900 dark:text-white">Notification History</CardTitle>
                <p className="text-gray-500 mt-2 max-w-sm">We are working on a detailed history and analytics view for your sent notifications. Stay tuned!</p>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
