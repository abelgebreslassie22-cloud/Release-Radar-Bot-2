import React, { useState } from 'react';
import { Menu, Search, RefreshCw, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '../ui/Toast';

interface TopbarProps {
  onMenuClick: () => void;
  lastScan: string | null;
  scanInterval: number;
}

export default function Topbar({ onMenuClick, lastScan, scanInterval }: TopbarProps) {
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);

  const triggerScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    toast('Manual scan triggered in background', 'default');
    try {
      await fetch('/api/scan', { method: 'POST' });
      setTimeout(() => {
        window.dispatchEvent(new Event('scan-triggered'));
      }, 1500);
    } catch (e) {
      toast('Failed to trigger scan', 'error');
    } finally {
      setTimeout(() => setIsScanning(false), 2000); // Visual cooldown
    }
  };

  return (
    <header className="h-16 bg-white/80 backdrop-blur-md border-b border-gray-200/60 sticky top-0 z-30 flex items-center justify-between px-4 sm:px-8">
      <div className="flex items-center gap-4">
        <button 
          onClick={onMenuClick}
          className="lg:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          aria-label="Toggle menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-xs font-medium text-gray-600">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
          Last Scan: {lastScan ? formatDistanceToNow(new Date(lastScan), { addSuffix: true }) : 'Never'} 
          <span className="text-gray-300 mx-1">|</span>
          Interval: {scanInterval}m
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative hidden md:block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input 
            type="text" 
            placeholder="Search releases..." 
            aria-label="Search releases"
            className="pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all w-64"
          />
        </div>
        <button 
          onClick={triggerScan}
          disabled={isScanning}
          aria-label="Trigger manual scan"
          className={`p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors group ${isScanning ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <RefreshCw className={`w-5 h-5 transition-transform duration-500 ${isScanning ? 'animate-spin text-indigo-600' : 'group-hover:rotate-180'}`} />
        </button>
      </div>
    </header>
  );
}
