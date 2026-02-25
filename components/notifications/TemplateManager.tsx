
'use client';

import { useState, useEffect } from 'react';
import { useCmsUser } from '@/lib/hooks/useCmsUser';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Trash2, Edit, Check, X, FileEdit, Plus, Layout, MessageSquare, ImageIcon } from 'lucide-react';
import { NotificationService, NotificationTemplate } from '@/lib/services/notification-service';
import { cn } from '@/lib/utils';

interface TemplateManagerProps {
  onLoadTemplate: (template: NotificationTemplate) => void;
}

export function TemplateManager({ onLoadTemplate }: TemplateManagerProps) {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newMode, setNewMode] = useState(false);
  const { canEdit } = useCmsUser();
  
  const [formData, setFormData] = useState<Partial<NotificationTemplate>>({
      name: '',
      title: '',
      body: '',
      image_url: ''
  });

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const data = await NotificationService.getTemplates();
      setTemplates(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleSave = async () => {
    try {
        if (!formData.name || !formData.title || !formData.body) {
            alert('Please fill in all required fields (Name, Title, and Message Body)');
            return;
        }

        if (newMode) {
            await NotificationService.createTemplate(formData as any);
        } else if (editingId) {
            await NotificationService.updateTemplate(editingId, formData);
        }
        setNewMode(false);
        setEditingId(null);
        setFormData({ name: '', title: '', body: '', image_url: '' });
        fetchTemplates();
    } catch (error) {
        alert('Failed to save template. Please try again.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template? This action cannot be undone.')) return;
    try {
        await NotificationService.deleteTemplate(id);
        fetchTemplates();
    } catch (error) {
        alert('Failed to delete template');
    }
  };

  const startEdit = (t: NotificationTemplate) => {
      setEditingId(t.id);
      setNewMode(false);
      setFormData({
          name: t.name,
          title: t.title,
          body: t.body,
          image_url: t.image_url,
          data: t.data
      });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <Layout className="h-6 w-6 text-tuggi-blue" />
            Notification Templates
          </h2>
          <p className="text-sm text-gray-500 font-medium">Create reusable messages to save time during campaigns.</p>
        </div>
        {!newMode && !editingId && canEdit && (
          <Button 
            className="rounded-xl bg-tuggi-blue hover:bg-blue-600 font-bold px-6 py-5 shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
            onClick={() => { setNewMode(true); setEditingId(null); setFormData({}); }}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        )}
      </div>

      {(newMode || editingId) && (
          <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-xl border-t-4 border-t-tuggi-blue bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg font-black flex items-center gap-2">
                  <FileEdit className="h-5 w-5 text-tuggi-blue" />
                  {newMode ? 'Create New Template' : 'Edit Template'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="font-bold text-gray-700 dark:text-gray-300">Internal Name</Label>
                      <Input 
                        className="rounded-xl border-gray-200 dark:border-gray-700" 
                        placeholder="e.g. Welcome Message" 
                        value={formData.name || ''} 
                        onChange={e => setFormData({...formData, name: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold text-gray-700 dark:text-gray-300">Message Title</Label>
                      <Input 
                        className="rounded-xl border-gray-200 dark:border-gray-700" 
                        placeholder="e.g. Welcome to Tuggi! 👋" 
                        value={formData.title || ''} 
                        onChange={e => setFormData({...formData, title: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-gray-700 dark:text-gray-300">Message Body</Label>
                    <Textarea 
                      className="rounded-xl border-gray-200 dark:border-gray-700 min-h-[100px]" 
                      placeholder="Type the notification content..." 
                      value={formData.body || ''} 
                      onChange={e => setFormData({...formData, body: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-gray-700 dark:text-gray-300">Image URL (Optional)</Label>
                    <Input 
                      className="rounded-xl border-gray-200 dark:border-gray-700" 
                      placeholder="https://..." 
                      value={formData.image_url || ''} 
                      onChange={e => setFormData({...formData, image_url: e.target.value})}
                    />
                  </div>
                  
                  <div className="flex justify-end gap-3 pt-2">
                      <Button 
                        variant="outline" 
                        className="rounded-xl px-6 font-bold" 
                        onClick={() => { setNewMode(false); setEditingId(null); }}
                      >
                        Cancel
                      </Button>
                      {canEdit && (
                        <Button 
                          className="rounded-xl px-8 bg-tuggi-blue hover:bg-blue-600 font-bold" 
                          onClick={handleSave}
                        >
                          <Check className="h-4 w-4 mr-2" />
                          Save Template
                        </Button>
                      )}
                  </div>
              </CardContent>
          </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map(t => (
            <Card key={t.id} className="group rounded-2xl border-gray-100 dark:border-gray-800 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-tuggi-blue/30 overflow-hidden bg-white dark:bg-gray-900">
                <div className="h-1 bg-gray-100 dark:bg-gray-800 transition-colors group-hover:bg-tuggi-blue" />
                <CardHeader className="pb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="p-1 px-2 rounded-lg bg-tuggi-blue/10 text-tuggi-blue text-[10px] font-black uppercase tracking-widest">
                        Template
                      </div>
                    </div>
                    <CardTitle className="text-xl font-black text-gray-900 dark:text-white group-hover:text-tuggi-blue transition-colors">
                      {t.name}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 space-y-1">
                      <p className="text-sm font-black text-gray-800 dark:text-gray-200 line-clamp-1 flex items-center gap-1.5">
                        <MessageSquare className="h-3.5 w-3.5 text-gray-400" />
                        {t.title}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">{t.body}</p>
                    </div>
                    
                    {t.image_url && (
                        <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase">
                          <ImageIcon className="h-3 w-3" />
                          Contains Image Asset
                        </div>
                    )}
                    
                    <div className="flex justify-between items-center mt-4 pt-2 border-t border-gray-50 dark:border-gray-800">
                        <Button 
                          className="rounded-xl bg-gray-900 dark:bg-gray-100 dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-white text-xs font-black px-4" 
                          size="sm" 
                          onClick={() => onLoadTemplate(t)}
                        >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            LOAD
                        </Button>
                        <div className="flex gap-1">
                            {canEdit && (
                              <>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-400 hover:text-tuggi-blue" 
                                  onClick={() => startEdit(t)}
                                >
                                    <Edit className="h-4 w-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-8 w-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500" 
                                  onClick={() => handleDelete(t.id)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        ))}
      </div>
      
      {templates.length === 0 && !loading && !newMode && (
          <div className="text-center py-20 bg-gray-50 dark:bg-gray-900/50 rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
              <div className="p-4 bg-white dark:bg-gray-900 rounded-full w-fit mx-auto shadow-sm mb-4">
                <Layout className="h-12 w-12 text-gray-200" />
              </div>
              <p className="text-gray-900 dark:text-white font-black text-xl">No templates found</p>
              <p className="text-gray-500 max-w-xs mx-auto mt-1">Create your first template to quickly send common notifications.</p>
              {canEdit && (
                <Button 
                  variant="outline"
                  className="mt-6 rounded-xl font-bold border-gray-200 hover:bg-white"
                  onClick={() => setNewMode(true)}
                >
                  + Create Template
                </Button>
              )}
          </div>
      )}

      {loading && templates.length === 0 && (
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-[220px] bg-gray-100 dark:bg-gray-800 animate-pulse rounded-2xl" />
            ))}
         </div>
      )}
    </div>
  );
}
