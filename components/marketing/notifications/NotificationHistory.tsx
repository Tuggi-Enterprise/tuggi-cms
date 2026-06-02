
'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  History, 
  Send, 
  Users, 
  Hash, 
  Calendar, 
  CheckCircle2, 
  XCircle, 
  Clock,
  ArrowRight,
  RefreshCcw,
  Search,
  Filter
} from 'lucide-react';
import { NotificationService, NotificationLog } from '@/lib/services/notification-service';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

export function NotificationHistory() {
  const t = useTranslations('Pages.Notifications');
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const data = await NotificationService.getLogs();
      setLogs(data);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(log => 
    log.title.toLowerCase().includes(search.toLowerCase()) ||
    log.body.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <History className="h-6 w-6 text-tuggi-blue" />
            {t('tabs.history')}
          </h2>
          <p className="text-sm text-gray-500 font-medium">Track all previously sent notifications and their status.</p>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input 
              type="text"
              placeholder="Search history..."
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-tuggi-blue/20 outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button 
            variant="outline" 
            size="icon" 
            className="rounded-xl border-gray-200"
            onClick={fetchLogs}
            disabled={loading}
          >
            <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {loading && logs.length === 0 ? (
          [1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-2xl" />
          ))
        ) : filteredLogs.length > 0 ? (
          filteredLogs.map(log => (
            <Card key={log.id} className="rounded-2xl border-gray-100 dark:border-gray-800 hover:border-tuggi-blue/30 transition-all overflow-hidden group">
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row md:items-center">
                  {/* Status Sidebar */}
                  <div className={cn(
                    "w-2 hidden md:block self-stretch",
                    log.status === 'sent' ? "bg-tuggi-green" : 
                    log.status === 'failed' ? "bg-red-500" : "bg-tuggi-orange"
                  )} />
                  
                  {/* Content Area */}
                  <div className="flex-1 p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                    {/* Main Info */}
                    <div className="lg:col-span-4 space-y-1">
                      <div className="flex items-center gap-2">
                        {log.type === 'user' && <Users className="h-3.5 w-3.5 text-tuggi-purple" />}
                        {log.type === 'broadcast' && <Send className="h-3.5 w-3.5 text-tuggi-blue" />}
                        {log.type === 'topic' && <Hash className="h-3.5 w-3.5 text-tuggi-green" />}
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          {log.type}
                        </span>
                        <div className="h-1 w-1 rounded-full bg-gray-300" />
                        <span className="text-[10px] font-bold text-gray-400">
                          {new Date(log.sent_at || log.created_at).toLocaleString()}
                        </span>
                      </div>
                      <h3 className="font-bold text-gray-900 dark:text-white line-clamp-1 group-hover:text-tuggi-blue transition-colors">
                        {log.title}
                      </h3>
                      <p className="text-sm text-gray-500 line-clamp-1">{log.body}</p>
                    </div>

                    {/* Stats/Target */}
                    <div className="lg:col-span-5 flex flex-wrap gap-4">
                      <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-2 rounded-xl border border-gray-100 dark:border-gray-700 flex items-center gap-3">
                         <div className="h-8 w-8 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                            <Users className="h-4 w-4 text-gray-400" />
                         </div>
                         <div>
                            <p className="text-[9px] font-bold text-gray-400 uppercase leading-none">Recipients</p>
                            <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
                               {log.type === 'broadcast' ? 'All Users' : 
                                log.type === 'topic' ? `Topic: ${log.topic}` : 
                                `${log.user_ids?.length || 0} Clients`}
                            </p>
                         </div>
                      </div>
                      
                      {log.data && Object.keys(log.data).length > 0 && (
                        <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-2 rounded-xl border border-gray-100 dark:border-gray-700 flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                              <Filter className="h-4 w-4 text-gray-400" />
                          </div>
                          <div>
                              <p className="text-[9px] font-bold text-gray-400 uppercase leading-none">Payload</p>
                              <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
                                {Object.keys(log.data).length} Keys
                              </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Status Badge */}
                    <div className="lg:col-span-3 flex items-center justify-end gap-3">
                      <div className={cn(
                        "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        log.status === 'sent' ? "bg-tuggi-green/10 text-tuggi-green" : 
                        log.status === 'failed' ? "bg-red-500/10 text-red-500" : "bg-tuggi-orange/10 text-tuggi-orange"
                      )}>
                        {log.status === 'sent' && <CheckCircle2 className="h-3 w-3" />}
                        {log.status === 'failed' && <XCircle className="h-3 w-3" />}
                        {log.status === 'scheduled' && <Clock className="h-3 w-3" />}
                        {log.status}
                      </div>
                      
                      <Button variant="ghost" size="icon" className="rounded-lg h-9 w-9 text-gray-400 hover:text-tuggi-blue">
                         <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="text-center py-20 bg-gray-50 dark:bg-gray-900/50 rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
            <div className="p-4 bg-white dark:bg-gray-900 rounded-full w-fit mx-auto shadow-sm mb-4">
              <History className="h-12 w-12 text-gray-200" />
            </div>
            <p className="text-gray-900 dark:text-white font-bold text-xl">No history found</p>
            <p className="text-gray-500 max-w-xs mx-auto mt-1 font-medium">Sent notifications will appear here for you to track and analyze.</p>
          </div>
        )}
      </div>
    </div>
  );
}
