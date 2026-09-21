import React, { useState, useEffect } from 'react';
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import DashboardView from './components/views/DashboardView';
import WatchlistView from './components/views/WatchlistView';
import ReleasesView from './components/views/ReleasesView';
import CategoryView from './components/views/CategoryView';
import SettingsView from './components/views/SettingsView';
import HealthView from './components/views/HealthView';
import LogsView from './components/views/LogsView';
import MediaDetailView from './components/views/MediaDetailView';
import { ToastProvider } from './components/ui/Toast';

export default function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [stats, setStats] = useState<any>(null);

  const parseRoute = () => {
    const hash = window.location.hash;
    if (hash.startsWith('#/media/')) {
      const key = decodeURIComponent(hash.replace('#/media/', ''));
      setSelectedGroupKey(key);
      setCurrentView('media-detail');
    } else if (hash.startsWith('#/')) {
      const viewName = hash.replace('#/', '');
      if (viewName) {
        setCurrentView(viewName);
        setSelectedGroupKey(null);
      }
    }
  };

  const navigateTo = (view: string, key?: string) => {
    if (view === 'media-detail' && key) {
      window.location.hash = `#/media/${encodeURIComponent(key)}`;
    } else {
      window.location.hash = `#/${view}`;
    }
  };

  const fetchStats = () => {
    fetch('/api/dashboard')
      .then(res => res.json())
      .then(setStats)
      .catch(() => {});
  };

  useEffect(() => {
    parseRoute();
    window.addEventListener('hashchange', parseRoute);

    fetchStats();
    const timer = setInterval(fetchStats, 5000);

    const handleRefresh = () => fetchStats();
    window.addEventListener('app-refresh-stats', handleRefresh);
    window.addEventListener('settings-updated', handleRefresh);
    window.addEventListener('scan-triggered', handleRefresh);

    return () => {
      window.removeEventListener('hashchange', parseRoute);
      clearInterval(timer);
      window.removeEventListener('app-refresh-stats', handleRefresh);
      window.removeEventListener('settings-updated', handleRefresh);
      window.removeEventListener('scan-triggered', handleRefresh);
    };
  }, []);

  const renderView = () => {
    if (currentView === 'media-detail' && selectedGroupKey) {
      return (
        <MediaDetailView 
          groupKey={selectedGroupKey} 
          onBack={() => navigateTo('releases')} 
        />
      );
    }

    switch (currentView) {
      case 'dashboard': return <DashboardView onNavigate={(v) => navigateTo(v)} />;
      case 'watchlist': return <WatchlistView />;
      case 'releases': return <ReleasesView onSelectMedia={(key) => navigateTo('media-detail', key)} />;
      case 'movies': return <CategoryView category="Movie" onSelectMedia={(key) => navigateTo('media-detail', key)} />;
      case 'series': return <CategoryView category="Series" onSelectMedia={(key) => navigateTo('media-detail', key)} />;
      case 'anime': return <CategoryView category="Anime" onSelectMedia={(key) => navigateTo('media-detail', key)} />;
      case 'animation': return <CategoryView category="Animation" onSelectMedia={(key) => navigateTo('media-detail', key)} />;
      case 'documentaries': return <CategoryView category="Documentary" onSelectMedia={(key) => navigateTo('media-detail', key)} />;
      case 'settings': return <SettingsView />;
      case 'health': return <HealthView />;
      case 'logs': return <LogsView />;
      default: return <DashboardView onNavigate={(v) => navigateTo(v)} />;
    }
  };

  return (
    <ToastProvider>
      <div className="min-h-screen bg-[#FDFDFD] font-sans flex text-gray-900 selection:bg-indigo-100 selection:text-indigo-900">
        <Sidebar 
          currentView={currentView} 
          setCurrentView={(v) => navigateTo(v)}
          isMobileOpen={isMobileMenuOpen}
          setIsMobileOpen={setIsMobileMenuOpen}
        />
        
        <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
          <Topbar 
            onMenuClick={() => setIsMobileMenuOpen(true)} 
            lastScan={stats?.lastScan}
            scanInterval={stats?.scanInterval || 10}
          />
          <div className="flex-1 overflow-y-auto p-4 sm:p-8">
            <div className="max-w-[1600px] mx-auto">
              {renderView()}
            </div>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
