import React, { useEffect, useState } from 'react';
import { Activity, Film, Clock, ServerCrash, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';

export default function DashboardView({ onNavigate }: { onNavigate: (view: string) => void }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(console.error);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Dashboard</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Watchlist Items" value={stats?.watchlistCount || 0} icon={<Film className="w-5 h-5 text-indigo-500" />} />
        <StatCard title="Total Releases" value={stats?.releaseCount || 0} icon={<Activity className="w-5 h-5 text-emerald-500" />} />
        <StatCard 
          title="Last Scan" 
          value={stats?.lastScan ? formatDistanceToNow(new Date(stats.lastScan), { addSuffix: true }) : 'Never'} 
          icon={<Clock className="w-5 h-5 text-orange-500" />} 
        />
        <StatCard 
          title="System Health" 
          value={stats?.error ? "Error" : "Healthy"} 
          icon={stats?.error ? <ServerCrash className="w-5 h-5 text-red-500" /> : <CheckCircle2 className="w-5 h-5 text-blue-500" />} 
          valueColor={stats?.error ? "text-red-600" : "text-gray-900"}
        />
      </div>

      {stats?.error && (
        <Card className="border-red-100 bg-red-50/50">
          <CardContent className="p-6">
            <div className="flex items-start gap-4 text-red-600">
              <ServerCrash className="w-6 h-6 mt-1" />
              <div>
                <h3 className="font-semibold text-lg">System Error</h3>
                <p className="mt-1 text-red-500/80">{stats.error}</p>
                <p className="mt-2 text-sm text-red-500/80">Please check your Render configuration and ensure PostgreSQL is running.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {!stats?.error && stats?.providerType === 'NONE' && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="p-6">
            <div className="flex items-start gap-4 text-orange-700">
              <AlertCircle className="w-6 h-6 mt-1" />
              <div>
                <h3 className="font-semibold text-lg">No Active Provider</h3>
                <p className="mt-1 text-orange-600/90">Scanner is running but no active data provider is configured.</p>
                <button onClick={() => onNavigate('settings')} className="mt-3 text-sm font-medium underline text-orange-700 hover:text-orange-900">
                  Configure Provider in Settings
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!stats?.error && stats?.providerType === 'TMDB' && (
        <Card className="border-indigo-200 bg-indigo-50/60 shadow-xs">
          <CardContent className="p-6">
            <div className="flex items-start gap-4 text-indigo-900">
              <CheckCircle2 className="w-6 h-6 mt-1 text-indigo-600 shrink-0" />
              <div>
                <h3 className="font-semibold text-lg">Active Provider: TMDB Digital & TV Premiere Monitor</h3>
                <p className="mt-1 text-indigo-700/90 text-sm leading-relaxed">
                  The bot monitors your watchlist against The Movie Database for digital (VOD/streaming) premiere dates, 4K/Blu-ray availability, and live TV broadcast schedules. Alerts are automatically sent to Telegram when titles premiere.
                </p>
                <button onClick={() => onNavigate('settings')} className="mt-3 text-sm font-semibold underline text-indigo-800 hover:text-indigo-950">
                  Manage Provider Settings
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!stats?.error && stats?.providerType === 'RSS' && (
        <Card className="border-indigo-200 bg-indigo-50/50">
          <CardContent className="p-6">
            <div className="flex items-start gap-4 text-indigo-900">
              <CheckCircle2 className="w-6 h-6 mt-1 text-indigo-600" />
              <div>
                <h3 className="font-semibold text-lg">Active Provider: Custom RSS Feed</h3>
                <p className="mt-1 text-indigo-700/90">The bot monitors your configured RSS feed for new releases and sends immediate Telegram notifications.</p>
                <button onClick={() => onNavigate('settings')} className="mt-3 text-sm font-medium underline text-indigo-800 hover:text-indigo-950">
                  Manage Provider Settings
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!stats?.error && stats?.providerType === 'MOCK' && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-6">
            <div className="flex items-start gap-4 text-blue-700">
              <Info className="w-6 h-6 mt-1" />
              <div>
                <h3 className="font-semibold text-lg">Development Mode</h3>
                <p className="mt-1 text-blue-600/90">The application is currently using the Mock Provider for testing purposes.</p>
                <button onClick={() => onNavigate('settings')} className="mt-3 text-sm font-medium underline text-blue-700 hover:text-blue-900">
                  Configure Real Provider
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Placeholder for today's releases if we want to expand */}
      {!stats?.error && (
        <div className="pt-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card onClick={() => onNavigate('watchlist')} className="hover:border-indigo-200 cursor-pointer group">
              <CardContent className="p-6 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">Add to Watchlist</div>
                  <div className="text-sm text-gray-500 mt-1">Start tracking a new movie or series</div>
                </div>
                <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                  <Film className="w-5 h-5 text-indigo-600" />
                </div>
              </CardContent>
            </Card>
            <Card onClick={() => onNavigate('releases')} className="hover:border-emerald-200 cursor-pointer group">
              <CardContent className="p-6 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900 group-hover:text-emerald-600 transition-colors">View Latest Releases</div>
                  <div className="text-sm text-gray-500 mt-1">Check out what was recently found</div>
                </div>
                <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                  <Activity className="w-5 h-5 text-emerald-600" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, icon, valueColor = "text-gray-900" }: { title: string, value: string | number, icon: React.ReactNode, valueColor?: string }) {
  return (
    <Card className="group hover:-translate-y-1 hover:shadow-md transition-all duration-300">
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gray-50 rounded-xl group-hover:scale-110 transition-transform duration-300">
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
            <p className={`text-2xl font-bold tracking-tight ${valueColor}`}>{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
