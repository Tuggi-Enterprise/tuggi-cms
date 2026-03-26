
'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Target, Users, Smartphone, Globe, ShieldCheck, Database } from 'lucide-react';
import { AudienceFilters, NotificationService } from '@/lib/services/notification-service';
import { cn } from '@/lib/utils';

interface AudienceFilterProps {
  filters: AudienceFilters;
  onChange: (filters: AudienceFilters) => void;
}

export function AudienceFilter({ filters, onChange }: AudienceFilterProps) {
  const [estimate, setEstimate] = useState<number | null>(null);
  const [totalBase, setTotalBase] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch Total Base on mount
  useEffect(() => {
    const fetchTotalBase = async () => {
      try {
        const count = await NotificationService.estimateAudience({});
        setTotalBase(count);
      } catch (e) {
        console.error('Failed to fetch total base', e);
      }
    };
    fetchTotalBase();
  }, []);

  // Debounce estimate calculation
  useEffect(() => {
    const fetchEstimate = async () => {
      setLoading(true);
      try {
        const count = await NotificationService.estimateAudience(filters);
        setEstimate(count);
      } catch (error) {
        console.error('Failed to estimate audience', error);
        setEstimate(null);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchEstimate, 500);
    return () => clearTimeout(timer);
  }, [filters]);

  const updateFilter = (key: keyof AudienceFilters, value: any) => {
    const newFilters = { ...filters, [key]: value };
    if (value === 'all' || value === '' || value === undefined) {
      delete newFilters[key];
    }
    onChange(newFilters);
  };

  return (
    <Card className="rounded-2xl border-gray-200 dark:border-gray-800 shadow-sm border-t-4 border-t-tuggi-purple overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-bold flex justify-between items-center group">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-tuggi-purple" />
            Target Audience
          </div>
          <div className={cn(
            "px-3 py-1 rounded-full text-[10px] font-bold transition-all duration-300 tracking-widest",
            loading ? "bg-gray-100 text-gray-400 animate-pulse" : "bg-tuggi-purple/10 text-tuggi-purple"
          )}>
            {loading ? 'CALCULATING...' : (estimate !== null ? `${estimate.toLocaleString()} RECIPIENTS` : 'UNKNOWN')}
          </div>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-5">
        
        {/* Statistics Summary */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700">
             <div className="flex items-center gap-2 mb-1">
                <Database className="h-3 w-3 text-gray-400" />
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-none">Push Base</p>
             </div>
             <p className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
                {totalBase !== null ? totalBase.toLocaleString() : '---'}
             </p>
          </div>
          <div className="p-4 bg-tuggi-purple/5 rounded-2xl border border-tuggi-purple/10">
             <div className="flex items-center gap-2 mb-1">
                <Users className="h-3 w-3 text-tuggi-purple" />
                <p className="text-[9px] font-bold text-tuggi-purple/60 uppercase tracking-widest leading-none">Targeted</p>
             </div>
             <p className="text-lg font-bold text-tuggi-purple leading-tight">
                {estimate !== null ? estimate.toLocaleString() : '---'}
             </p>
          </div>
        </div>

        {/* Filters */}
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
              <Smartphone className="h-3 w-3" />
              Platform
            </Label>
            <Select 
              value={filters.last_platform || 'all'} 
              onValueChange={(val) => updateFilter('last_platform', val)}
            >
              <SelectItem value="all">All Platforms</SelectItem>
              <SelectItem value="ios">Apple iOS</SelectItem>
              <SelectItem value="android">Google Android</SelectItem>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
              <ShieldCheck className="h-3 w-3" />
              Subscription Tier
            </Label>
            <Select 
              value={filters.subscription_tier_id || 'all'}
              onValueChange={(val) => updateFilter('subscription_tier_id', val)}
            >
              <SelectItem value="all">Every User</SelectItem>
              <SelectItem value="19ed18ca-c285-4d60-85cd-7e6b4810aa44">Free Plan</SelectItem>
              <SelectItem value="pro">Premium Plan</SelectItem>
            </Select>
          </div>

          <div className="space-y-2">
              <Label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                <Globe className="h-3 w-3" />
                User Language
              </Label>
              <Select 
                value={filters.language || 'all'}
                onValueChange={(val) => updateFilter('language', val)}
              >
                <SelectItem value="all">Any Language</SelectItem>
                <SelectItem value="pt-br">Portuguese</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="fr">French</SelectItem>
              </Select>
          </div>

          <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-950 rounded-xl border border-gray-100 dark:border-gray-800 transition-all hover:bg-gray-50">
            <Checkbox 
              id="onboarding" 
              className="h-5 w-5 rounded-md border-tuggi-purple"
              checked={filters.onboarding_completed === true}
              onCheckedChange={(checked) => updateFilter('onboarding_completed', checked === true ? true : undefined)}
            />
            <Label htmlFor="onboarding" className="text-sm font-bold text-gray-700 dark:text-gray-300 cursor-pointer">
              Active Users Only
              <span className="block text-[10px] font-normal text-gray-400">Onboarding completed</span>
            </Label>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
