import React, { useState, useEffect } from 'react';
import { 
  Save, 
  Clock, 
  Key, 
  MessageCircle, 
  AlertCircle, 
  Globe, 
  Database, 
  Bot, 
  CheckCircle2, 
  XCircle, 
  Sparkles, 
  FileCode2, 
  Eye, 
  EyeOff, 
  RefreshCw, 
  Zap, 
  ExternalLink,
  ShieldCheck,
  Film
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { Skeleton } from '../ui/Skeleton';

export default function SettingsView() {
  const [form, setForm] = useState({
    databaseUrl: '',
    telegramBotToken: '',
    telegramChatId: '',
    metadataApiKey: '',
    appUrl: '',
    scanInterval: 10,
    providerType: 'TMDB',
    providerUrl: '',
    debugMode: 0
  });

  const [envStatus, setEnvStatus] = useState<any>(null);
  const [rawEnvText, setRawEnvText] = useState('');
  const [configMode, setConfigMode] = useState<'form' | 'raw'>('form');
  
  const [showDbUrl, setShowDbUrl] = useState(false);
  const [showBotToken, setShowBotToken] = useState(false);
  const [showTmdbKey, setShowTmdbKey] = useState(false);

  const [loading, setLoading] = useState(true);
  const [savingAndConnecting, setSavingAndConnecting] = useState(false);
  const [testingDb, setTestingDb] = useState(false);
  const [testingBot, setTestingBot] = useState(false);
  const [testingTmdb, setTestingTmdb] = useState(false);
  const [testingTelegramMsg, setTestingTelegramMsg] = useState(false);

  const [connectionResults, setConnectionResults] = useState<any>(null);
  const { toast } = useToast();

  const loadData = async () => {
    try {
      const [settingsRes, envRes] = await Promise.all([
        fetch('/api/settings').then(r => r.json()).catch(() => ({})),
        fetch('/api/config/env-status').then(r => r.json()).catch(() => ({}))
      ]);

      setEnvStatus(envRes);

      const defaultAppUrl = 'https://release-radar-bot-2.onrender.com';
      let loadedAppUrl = settingsRes.appUrl || envRes.appUrl || '';
      if (!loadedAppUrl || loadedAppUrl.includes('jrnm.app') || loadedAppUrl.includes('ais-dev-') || loadedAppUrl.includes('ais-pre-') || loadedAppUrl.includes('release-radar-bot.onrender.com')) {
        loadedAppUrl = defaultAppUrl;
      }

      setForm({
        databaseUrl: '',
        telegramBotToken: '',
        telegramChatId: settingsRes.telegramChatId || envRes.telegramChatId || '',
        metadataApiKey: settingsRes.metadataApiKey || '',
        appUrl: loadedAppUrl,
        scanInterval: settingsRes.scanInterval || envRes.scanInterval || 10,
        providerType: settingsRes.providerType || envRes.providerType || 'TMDB',
        providerUrl: settingsRes.providerUrl || '',
        debugMode: settingsRes.debugMode || envRes.debugMode || 0
      });
    } catch (e) {
      console.error('Failed to load settings:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleParseRawEnv = () => {
    if (!rawEnvText.trim()) {
      toast('Please paste your .env content first.', 'error');
      return;
    }
    const lines = rawEnvText.split('\n');
    let updated = { ...form };
    let parsedCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key === 'DATABASE_URL') { updated.databaseUrl = val; parsedCount++; }
        if (key === 'TELEGRAM_BOT_TOKEN') { updated.telegramBotToken = val; parsedCount++; }
        if (key === 'TELEGRAM_CHAT_ID') { updated.telegramChatId = val; parsedCount++; }
        if (key === 'TMDB_API_KEY' || key === 'METADATA_API_KEY') { updated.metadataApiKey = val; parsedCount++; }
        if (key === 'APP_URL') { updated.appUrl = val; parsedCount++; }
        if (key === 'SCAN_INTERVAL') { updated.scanInterval = parseInt(val, 10) || 10; parsedCount++; }
        if (key === 'PROVIDER_TYPE') { updated.providerType = val; parsedCount++; }
        if (key === 'PROVIDER_URL') { updated.providerUrl = val; parsedCount++; }
      }
    }

    setForm(updated);
    setConfigMode('form');
    toast(`Successfully imported ${parsedCount} environment variables into the form!`, 'success');
  };

  const handleTestDatabase = async () => {
    if (!form.databaseUrl) {
      toast('Please enter a PostgreSQL Database URL first', 'error');
      return;
    }
    setTestingDb(true);
    try {
      const res = await fetch('/api/config/test-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseUrl: form.databaseUrl })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast('Database connected and schema verified successfully!', 'success');
        loadData();
      } else {
        toast(data.error || 'Failed to connect to database', 'error');
      }
    } catch (e: any) {
      toast(e.message || 'Database test failed', 'error');
    } finally {
      setTestingDb(false);
    }
  };

  const handleTestBotToken = async () => {
    if (!form.telegramBotToken) {
      toast('Please enter a Telegram Bot Token first', 'error');
      return;
    }
    setTestingBot(true);
    try {
      const res = await fetch('/api/config/test-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: form.telegramBotToken })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast(`Bot verified! Connected as @${data.bot.username} (${data.bot.first_name})`, 'success');
      } else {
        toast(data.error || 'Invalid Telegram Bot Token', 'error');
      }
    } catch (e: any) {
      toast(e.message || 'Bot test failed', 'error');
    } finally {
      setTestingBot(false);
    }
  };

  const handleTestTmdbKey = async () => {
    if (!form.metadataApiKey) {
      toast('Please enter a TMDB API Key first', 'error');
      return;
    }
    setTestingTmdb(true);
    try {
      const res = await fetch('/api/config/test-tmdb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: form.metadataApiKey })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast('TMDB API Key is valid and active!', 'success');
      } else {
        toast(data.error || 'Invalid TMDB API Key', 'error');
      }
    } catch (e: any) {
      toast(e.message || 'TMDB test failed', 'error');
    } finally {
      setTestingTmdb(false);
    }
  };

  const handleTestTelegramMessage = async () => {
    if (!form.telegramChatId) {
      toast('Please enter your Telegram Chat ID', 'error');
      return;
    }
    setTestingTelegramMsg(true);
    try {
      // First save current form
      await fetch('/api/config/connect-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      
      const res = await fetch('/api/telegram/test', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        toast('Test notification sent to Telegram!', 'success');
      } else {
        toast(data.error || 'Failed to send Telegram test message', 'error');
      }
    } catch (e: any) {
      toast(e.message || 'Error sending test message', 'error');
    } finally {
      setTestingTelegramMsg(false);
    }
  };

  const handleSaveAndConnectAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAndConnecting(true);
    setConnectionResults(null);

    try {
      const res = await fetch('/api/config/connect-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      setConnectionResults(data.results);

      if (data.success) {
        toast('All services connected and settings saved successfully!', 'success');
      } else {
        toast('Settings saved, but check the connection reports below.', 'warning');
      }

      window.dispatchEvent(new Event('settings-updated'));
      await loadData();
    } catch (e: any) {
      toast(e.message || 'Failed to connect services', 'error');
    } finally {
      setSavingAndConnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96" />
        </div>
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 pb-16">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Environment & System Settings</h2>
          <p className="text-gray-500 text-sm mt-1">Configure and connect your database, Telegram bot, and TMDB metadata.</p>
        </div>

        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-xl self-start">
          <button
            type="button"
            onClick={() => setConfigMode('form')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${configMode === 'form' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            Form Inputs
          </button>
          <button
            type="button"
            onClick={() => setConfigMode('raw')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${configMode === 'raw' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            Paste .env Content
          </button>
        </div>
      </div>

      {/* Connection Results Feedback Alert */}
      {connectionResults && (
        <div className="p-5 bg-white border border-gray-200 rounded-2xl shadow-sm space-y-3 animate-in fade-in">
          <div className="flex items-center gap-2 font-semibold text-gray-900">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <span>Connection Diagnostics</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <ResultItem title="Database" res={connectionResults.database} />
            <ResultItem title="Telegram Bot" res={connectionResults.telegram} />
            <ResultItem title="TMDB API" res={connectionResults.tmdb} />
            <ResultItem title="Scanner" res={connectionResults.scheduler} />
          </div>
        </div>
      )}

      {/* Raw .env Paste Mode */}
      {configMode === 'raw' ? (
        <Card className="border-indigo-100 bg-indigo-50/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-indigo-950">
              <FileCode2 className="w-5 h-5 text-indigo-600" />
              Quick Import from .env
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-gray-600">
              Paste your raw <code>.env</code> file content below. We will parse <code>DATABASE_URL</code>, <code>TELEGRAM_BOT_TOKEN</code>, <code>TMDB_API_KEY</code>, etc. and populate the form automatically.
            </p>
            <textarea
              rows={8}
              value={rawEnvText}
              onChange={e => setRawEnvText(e.target.value)}
              placeholder={`DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require\nTELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjkl\nTELEGRAM_CHAT_ID=123456789\nTMDB_API_KEY=your_tmdb_key_here\nAPP_URL=https://your-service.onrender.com`}
              className="w-full font-mono text-xs p-4 bg-gray-900 text-gray-100 rounded-xl border border-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfigMode('form')}>Cancel</Button>
              <Button type="button" onClick={handleParseRawEnv} className="gap-1.5">
                <Sparkles className="w-4 h-4" /> Import into Settings Form
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <form onSubmit={handleSaveAndConnectAll} className="space-y-6">
        {/* 1. Database Connection Card */}
        <Card className="border-gray-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5 text-indigo-600" />
                PostgreSQL Database Connection
              </CardTitle>
              {envStatus?.isDbConnected ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  <AlertCircle className="w-3.5 h-3.5" /> {envStatus?.hasDatabaseUrl ? 'Failing' : 'Not Configured'}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">
                Database URL (<code className="text-xs bg-gray-100 px-1 py-0.5 rounded font-mono">DATABASE_URL</code>)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                PostgreSQL connection string from Neon.tech, Supabase, or Render PostgreSQL.
              </p>
              
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showDbUrl ? 'text' : 'password'}
                    value={form.databaseUrl}
                    onChange={e => setForm({ ...form, databaseUrl: e.target.value })}
                    placeholder={envStatus?.databaseUrlMasked || 'postgresql://user:pass@host:5432/dbname?sslmode=require'}
                    className="w-full pl-3 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDbUrl(!showDbUrl)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showDbUrl ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestDatabase}
                  disabled={testingDb || !form.databaseUrl}
                  className="shrink-0 text-xs font-semibold gap-1.5"
                >
                  {testingDb ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />}
                  Test Connection
                </Button>
              </div>

              {envStatus?.dbError && !form.databaseUrl && (
                <p className="text-xs text-red-600 mt-1.5">
                  Current connection error: {envStatus.dbError}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 2. Telegram Bot Configuration */}
        <Card className="border-gray-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-600" />
                Telegram Bot Integration
              </CardTitle>
              {envStatus?.hasTelegramToken ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Bot Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  <AlertCircle className="w-3.5 h-3.5" /> Token Missing
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">
                Telegram Bot Token (<code className="text-xs bg-gray-100 px-1 py-0.5 rounded font-mono">TELEGRAM_BOT_TOKEN</code>)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Obtained from <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5">@BotFather <ExternalLink className="w-3 h-3" /></a> on Telegram.
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showBotToken ? 'text' : 'password'}
                    value={form.telegramBotToken}
                    onChange={e => setForm({ ...form, telegramBotToken: e.target.value })}
                    placeholder={envStatus?.telegramTokenMasked || '123456789:ABCdefGHIjklmnopqrstuvwxyz'}
                    className="w-full pl-3 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowBotToken(!showBotToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestBotToken}
                  disabled={testingBot || !form.telegramBotToken}
                  className="shrink-0 text-xs font-semibold gap-1.5"
                >
                  {testingBot ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5 text-indigo-600" />}
                  Verify Token
                </Button>
              </div>
            </div>

            <div className="pt-2 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-900 mb-1">
                Your Telegram Chat ID
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Message <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5">@userinfobot <ExternalLink className="w-3 h-3" /></a> to find your numeric ID, then send <code>/start</code> to your bot.
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  value={form.telegramChatId}
                  onChange={e => setForm({ ...form, telegramChatId: e.target.value })}
                  placeholder="e.g. 123456789"
                  className="w-full sm:max-w-md px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestTelegramMessage}
                  disabled={testingTelegramMsg || !form.telegramChatId}
                  className="shrink-0 text-xs font-semibold gap-1.5"
                >
                  {testingTelegramMsg ? 'Sending...' : 'Send Test Notification'}
                </Button>
              </div>
            </div>

            <div className="pt-2 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-900 mb-1 flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-indigo-600" />
                Application Public URL (<code className="text-xs bg-gray-100 px-1 py-0.5 rounded font-mono">APP_URL</code>)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Used in Telegram notification buttons to link directly to movie details on your web app.
              </p>
              <input
                type="url"
                value={form.appUrl}
                onChange={e => setForm({ ...form, appUrl: e.target.value })}
                placeholder="https://your-service-name.onrender.com"
                className="w-full sm:max-w-xl px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
              />
            </div>
          </CardContent>
        </Card>

        {/* 3. TMDB Metadata Card */}
        <Card className="border-gray-200">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Film className="w-5 h-5 text-indigo-600" />
              TMDB Metadata Integration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">
                TMDB API Key (v3) (<code className="text-xs bg-gray-100 px-1 py-0.5 rounded font-mono">TMDB_API_KEY</code>)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Fetches high-res posters, IMDb/TMDB ratings, plot overviews, and cast info from <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5">The Movie Database <ExternalLink className="w-3 h-3" /></a>.
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showTmdbKey ? 'text' : 'password'}
                    value={form.metadataApiKey}
                    onChange={e => setForm({ ...form, metadataApiKey: e.target.value })}
                    placeholder={envStatus?.metadataApiKeyMasked || 'e.g. 1a2b3c4d5e6f7g8h9i0j...'}
                    className="w-full pl-3 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTmdbKey(!showTmdbKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showTmdbKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestTmdbKey}
                  disabled={testingTmdb || !form.metadataApiKey}
                  className="shrink-0 text-xs font-semibold gap-1.5"
                >
                  {testingTmdb ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5 text-indigo-600" />}
                  Validate Key
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 4. Provider & Scanner Card */}
        <Card className="border-gray-200">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-indigo-600" />
              Scanner & Data Providers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  Data Provider
                </label>
                <select
                  value={form.providerType}
                  onChange={e => setForm({ ...form, providerType: e.target.value })}
                  className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                >
                  <option value="TMDB">Real-Time Download Radar + TMDB (Recommended)</option>
                  <option value="DOWNLOAD_RADAR">Download Availability Radar Only (Scene Torrents & Magnets)</option>
                  <option value="RSS">Custom RSS Feed</option>
                  <option value="MOCK">Mock Provider (Testing)</option>
                  <option value="NONE">Disabled</option>
                </select>
                <p className="text-xs text-gray-500 mt-1.5">
                  Tracks the exact moment movies and episodes drop online with 1080p/4K download & magnet links, seed counts, and official streaming dates.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  Scan Interval (Minutes)
                </label>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={form.scanInterval}
                  onChange={e => setForm({ ...form, scanInterval: parseInt(e.target.value, 10) || 10 })}
                  className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>
            </div>

            {form.providerType === 'TMDB' && (
              <div className="p-4 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-900 leading-relaxed">
                <strong className="font-semibold block mb-1 text-sm text-indigo-950">📡 TMDB Digital Premiere & TV Schedule Polling Active</strong>
                The bot directly monitors your watchlist against The Movie Database (TMDB). It detects official digital releases (VOD, Apple TV, Amazon Prime, Google Play), physical disc availability (4K UHD & Blu-ray), and live TV episode air dates. The moment an item reaches its premiere date, an instant notification is dispatched to Telegram.
              </div>
            )}

            {form.providerType === 'RSS' && (
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  RSS Feed URL
                </label>
                <input
                  type="url"
                  value={form.providerUrl}
                  onChange={e => setForm({ ...form, providerUrl: e.target.value })}
                  placeholder="https://example.com/rss"
                  className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Master Action Bar */}
        <div className="sticky bottom-4 z-20 bg-white/95 backdrop-blur-md p-4 rounded-2xl border border-gray-200 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-gray-500">
            Clicking <strong>Save & Connect All</strong> immediately applies your credentials and initializes the database and bot.
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => loadData()}
              className="text-xs"
            >
              Reset
            </Button>
            <Button
              type="submit"
              isLoading={savingAndConnecting}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white shadow-md text-sm font-semibold px-6 py-2.5 rounded-xl"
            >
              <Zap className="w-4 h-4 fill-white" />
              Save & Connect All Services
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ResultItem({ title, res }: { title: string; res?: any }) {
  if (!res) return null;
  const isOk = res.status === 'success';
  const isWarn = res.status === 'warning';
  const isErr = res.status === 'error';

  return (
    <div className={`p-3 rounded-xl border ${
      isOk ? 'bg-emerald-50/50 border-emerald-100 text-emerald-900' :
      isWarn ? 'bg-amber-50/50 border-amber-100 text-amber-900' :
      isErr ? 'bg-red-50/50 border-red-100 text-red-900' :
      'bg-gray-50 border-gray-100 text-gray-700'
    }`}>
      <div className="flex items-center gap-1.5 font-semibold">
        {isOk && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
        {isWarn && <AlertCircle className="w-3.5 h-3.5 text-amber-600" />}
        {isErr && <XCircle className="w-3.5 h-3.5 text-red-600" />}
        <span>{title}</span>
      </div>
      <p className="mt-1 text-[11px] opacity-80 truncate" title={res.message}>
        {res.message}
      </p>
    </div>
  );
}

