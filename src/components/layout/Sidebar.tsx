import React, { useState } from 'react';
import { 
  Activity, 
  ListPlus, 
  Settings as SettingsIcon, 
  Film, 
  LayoutDashboard,
  Tv,
  MonitorPlay,
  Library,
  HeartPulse,
  Menu,
  X,
  ScrollText
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../utils/cn';

interface SidebarProps {
  currentView: string;
  setCurrentView: (view: string) => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
}

export default function Sidebar({ currentView, setCurrentView, isMobileOpen, setIsMobileOpen }: SidebarProps) {
  
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'watchlist', label: 'Watchlist', icon: ListPlus },
    { id: 'releases', label: 'Recent Releases', icon: Film },
    { id: 'movies', label: 'Movies', icon: Film },
    { id: 'series', label: 'Series', icon: Tv },
    { id: 'anime', label: 'Anime', icon: MonitorPlay },
    { id: 'animation', label: 'Animation', icon: Library },
    { id: 'documentaries', label: 'Documentaries', icon: Library },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
    { id: 'health', label: 'Health Status', icon: HeartPulse },
    { id: 'logs', label: 'Logs', icon: ScrollText },
  ];

  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:sticky top-0 h-screen w-64 bg-[#FDFDFD] border-r border-gray-200/60 flex flex-col z-50 transition-transform duration-300 ease-in-out shrink-0",
        isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <div className="h-16 px-6 border-b border-gray-100 flex items-center justify-between lg:justify-start gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-600/20">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Movie Radar</h1>
          </div>
          <button className="lg:hidden text-gray-500" onClick={() => setIsMobileOpen(false)} aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8 no-scrollbar">
          
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-3">Overview</div>
            <nav className="space-y-1">
              {navItems.slice(0, 3).map(item => (
                <NavItem 
                  key={item.id}
                  active={currentView === item.id} 
                  onClick={() => { setCurrentView(item.id); setIsMobileOpen(false); }} 
                  icon={item.icon} 
                  label={item.label} 
                />
              ))}
            </nav>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-3">Categories</div>
            <nav className="space-y-1">
              {navItems.slice(3, 8).map(item => (
                <NavItem 
                  key={item.id}
                  active={currentView === item.id} 
                  onClick={() => { setCurrentView(item.id); setIsMobileOpen(false); }} 
                  icon={item.icon} 
                  label={item.label} 
                />
              ))}
            </nav>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-3">System</div>
            <nav className="space-y-1">
              {navItems.slice(8).map(item => (
                <NavItem 
                  key={item.id}
                  active={currentView === item.id} 
                  onClick={() => { setCurrentView(item.id); setIsMobileOpen(false); }} 
                  icon={item.icon} 
                  label={item.label} 
                />
              ))}
            </nav>
          </div>
          
        </div>
      </aside>
    </>
  );
}

const NavItem: React.FC<{ active: boolean, onClick: () => void, icon: any, label: string }> = ({ active, onClick, icon: Icon, label }) => {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-all duration-200 group relative overflow-hidden",
        active ? "text-indigo-700 bg-indigo-50/80" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      )}
    >
      <Icon className={cn("w-5 h-5 transition-colors", active ? "text-indigo-600" : "text-gray-400 group-hover:text-gray-600")} strokeWidth={active ? 2.5 : 2} />
      <span className="relative z-10">{label}</span>
      {active && (
        <motion.div 
          layoutId="sidebar-active"
          className="absolute inset-0 bg-indigo-50/80 rounded-lg -z-0"
          initial={false}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
      )}
    </button>
  );
}
