import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Activity, Server, Database, Bot, HelpCircle, ExternalLink, Key, Terminal, Settings, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';

export default function HealthView() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/health/status')
      .then(res => res.json())
      .then(data => {
        setHealth(data);
        setLoading(false);
      })
      .catch(() => {
        setHealth({ server: 'Healthy', database: 'Not Configured', scheduler: 'Healthy', telegram: 'Not Configured' });
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const needsConfig = health?.database !== 'Healthy' || health?.telegram !== 'Healthy';

  return (
    <div className="space-y-8 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">System Health</h2>
          <p className="text-gray-500 text-sm mt-1">Monitor the status of background services and connections.</p>
        </div>

        <Button
          onClick={() => { window.location.hash = '#/settings'; }}
          className="gap-2 self-start bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm text-xs font-semibold"
        >
          <Settings className="w-4 h-4" /> Open Environment Settings
        </Button>
      </div>

      {needsConfig && (
        <div className="p-5 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-start gap-3.5">
            <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-sm shrink-0 mt-0.5">
              <Zap className="w-5 h-5 fill-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Configure Database & Bot Directly in UI</h3>
              <p className="text-xs text-gray-600 mt-0.5 max-w-xl leading-relaxed">
                You can input your <code>DATABASE_URL</code>, <code>TELEGRAM_BOT_TOKEN</code>, and <code>TMDB_API_KEY</code> in the Settings page and click <strong>"Save & Connect"</strong> to automatically connect all services.
              </p>
            </div>
          </div>
          <Button
            onClick={() => { window.location.hash = '#/settings'; }}
            className="shrink-0 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 rounded-xl shadow"
          >
            Configure & Connect
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <HealthCard 
          title="Express Server" 
          status={health?.server === 'Healthy' ? 'ok' : 'error'} 
          icon={Server} 
          description="Main backend API and web server." 
        />
        <HealthCard 
          title="PostgreSQL Database" 
          status={health?.database === 'Healthy' ? 'ok' : (health?.database === 'Not Configured' ? 'warning' : 'error')} 
          icon={Database} 
          description={
            health?.database === 'Healthy' ? 'Connected and ready for operations.' :
            health?.database === 'Not Configured' ? 'DATABASE_URL env variable not configured.' :
            'Failed to connect to PostgreSQL instance.'
          } 
        />
        <HealthCard 
          title="Background Scheduler" 
          status={health?.scheduler === 'Healthy' ? 'ok' : 'error'} 
          icon={Activity} 
          description="Node-cron jobs actively scanning providers." 
        />
        <HealthCard 
          title="Telegram Bot" 
          status={health?.telegram === 'Healthy' ? 'ok' : (health?.telegram === 'Not Configured' ? 'warning' : 'error')} 
          icon={Bot} 
          description={health?.telegram === 'Not Configured' ? 'TELEGRAM_BOT_TOKEN environment variable not set.' : "Listening for commands & sending notifications."} 
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Data Providers</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-100">
            {health?.providers?.map((provider: any, i: number) => (
              <div key={i} className="p-4 sm:p-6 flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-gray-900">{provider.name}</h4>
                  <p className="text-sm text-gray-500">Last scanned: {provider.lastScan && provider.lastScan !== 'Never' ? new Date(provider.lastScan).toLocaleString() : 'Never'}</p>
                </div>
                <StatusBadge status={provider.status === 'Healthy' ? 'ok' : 'error'} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Setup Guide */}
      <Card className="border-indigo-100 bg-indigo-50/30">
        <CardHeader>
          <div className="flex items-center gap-2 text-indigo-900 font-semibold text-lg">
            <HelpCircle className="w-5 h-5 text-indigo-600" />
            <h3>Setup Guide: How to Get Required Credentials & Services</h3>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 text-sm text-gray-700">
          
          {/* Step 1: PostgreSQL */}
          <div className="bg-white p-5 rounded-xl border border-indigo-100/80 shadow-sm space-y-3">
            <div className="flex items-center gap-2 font-semibold text-gray-900">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-xs">1</span>
              <span>PostgreSQL Database (<code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-indigo-600 font-mono">DATABASE_URL</code>)</span>
            </div>
            <p className="text-gray-600 leading-relaxed">
              You can get a <strong>100% free PostgreSQL database</strong> in under 1 minute from any of these providers:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-gray-600">
              <li>
                <a href="https://neon.tech" target="_blank" rel="noopener noreferrer" className="text-indigo-600 font-medium hover:underline inline-flex items-center gap-1">
                  Neon.tech <ExternalLink className="w-3 h-3" />
                </a> — Instant free cloud serverless PostgreSQL database.
              </li>
              <li>
                <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 font-medium hover:underline inline-flex items-center gap-1">
                  Supabase.com <ExternalLink className="w-3 h-3" />
                </a> — Free hosted PostgreSQL database with full features.
              </li>
              <li>
                <a href="https://render.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 font-medium hover:underline inline-flex items-center gap-1">
                  Render PostgreSQL <ExternalLink className="w-3 h-3" />
                </a> — Managed PostgreSQL database on Render.
              </li>
            </ul>
            <div className="bg-gray-900 text-gray-100 p-3 rounded-lg font-mono text-xs overflow-x-auto">
              DATABASE_URL="postgresql://user:password@ep-example.neon.tech/neondb?sslmode=require"
            </div>
            <p className="text-xs text-gray-500">
              After getting your database URL, add it to your environment variables or <code className="bg-gray-100 px-1 rounded font-mono">.env</code> file and run <code className="bg-gray-100 px-1 rounded font-mono">npm run db:push</code> to initialize the schema!
            </p>
          </div>

          {/* Step 2: Telegram Bot */}
          <div className="bg-white p-5 rounded-xl border border-indigo-100/80 shadow-sm space-y-3">
            <div className="flex items-center gap-2 font-semibold text-gray-900">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-xs">2</span>
              <span>Telegram Bot (<code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-indigo-600 font-mono">TELEGRAM_BOT_TOKEN</code>)</span>
            </div>
            <ol className="list-decimal pl-5 space-y-1.5 text-gray-600">
              <li>Open Telegram and search for <strong>@BotFather</strong>.</li>
              <li>Send <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">/newbot</code> and follow the prompts to choose a name and username.</li>
              <li>Copy the HTTP API token provided by BotFather and set it as <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">TELEGRAM_BOT_TOKEN</code> in your environment.</li>
              <li>To get your <strong>Telegram Chat ID</strong>: message <strong>@userinfobot</strong> on Telegram to get your numeric ID, and paste it in the <strong>Settings</strong> tab!</li>
            </ol>
          </div>

          {/* Step 3: TMDB API Key */}
          <div className="bg-white p-5 rounded-xl border border-indigo-100/80 shadow-sm space-y-3">
            <div className="flex items-center gap-2 font-semibold text-gray-900">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-xs">3</span>
              <span>TMDB Metadata API Key</span>
            </div>
            <p className="text-gray-600">
              Visit <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" className="text-indigo-600 font-medium hover:underline inline-flex items-center gap-1">TMDB API Settings <ExternalLink className="w-3 h-3" /></a> to create a free developer account and generate a <strong>v3 API Key</strong>. Copy the key and enter it directly inside the <strong>Settings</strong> tab in this app.
            </p>
          </div>

        </CardContent>
      </Card>

    </div>
  );
}

function HealthCard({ title, status, icon: Icon, description }: { title: string, status: 'ok' | 'error' | 'warning', icon: any, description: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${
              status === 'ok' ? 'bg-emerald-50 text-emerald-600' :
              status === 'warning' ? 'bg-amber-50 text-amber-600' :
              'bg-red-50 text-red-600'
            }`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-gray-900">{title}</h4>
              <p className="text-sm text-gray-500 mt-1">{description}</p>
            </div>
          </div>
          <StatusBadge status={status} />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: 'ok' | 'error' | 'warning' }) {
  if (status === 'ok') {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100"><CheckCircle2 className="w-3.5 h-3.5" /> Healthy</span>
  }
  if (status === 'warning') {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100"><Activity className="w-3.5 h-3.5" /> Not Configured</span>
  }
  return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100"><XCircle className="w-3.5 h-3.5" /> Failing</span>
}
