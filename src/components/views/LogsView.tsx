import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../../utils/cn';

type LogLevel = 'INFO' | 'ERROR' | 'WARNING' | 'SUCCESS';

interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
  service: string;
  details: any;
  createdAt: string;
}

export default function LogsView() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = () => {
    fetch('/api/logs')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setLogs(data.reverse()); // Reverse to show oldest first like a terminal
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs();
    const timer = setInterval(fetchLogs, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleCopyLogs = () => {
    const text = logs.map(log => {
      const time = log.createdAt.replace('T', ' ').substring(0, 19);
      return `[${time}] [${log.level}] ${log.message} ${log.details ? JSON.stringify(log.details) : ''}`;
    }).join('\n');
    navigator.clipboard.writeText(text);
  };

  const handleClearLogs = () => {
    fetch('/api/logs', { method: 'DELETE' }).then(() => {
      setLogs([]);
    });
  };

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col rounded-xl overflow-hidden bg-[#0a0f1c] text-emerald-400 font-mono shadow-2xl border border-gray-800 animate-in fade-in zoom-in-95 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-[#060913] border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-gray-500 font-bold text-lg">&gt;_</span>
          <span className="text-sm font-bold text-gray-200 tracking-wide font-sans">Ingestion Daemon Live Terminal Output</span>
        </div>
        <div className="flex items-center gap-6 text-sm text-gray-400">
          <label className="flex items-center gap-2 cursor-pointer hover:text-gray-200 transition-colors">
            <input 
              type="checkbox" 
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded-sm bg-[#1a1f2e] border-gray-600 text-gray-300 focus:ring-0 focus:ring-offset-0 w-4 h-4 cursor-pointer"
            />
            Auto-Scroll
          </label>
          <button onClick={handleCopyLogs} className="hover:text-gray-200 transition-colors">
            [Copy Logs]
          </button>
          <button onClick={handleClearLogs} className="hover:text-gray-200 transition-colors">
            [Clear Logs]
          </button>
        </div>
      </div>

      {/* Terminal Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-2 text-[13px] leading-relaxed scroll-smooth" style={{ scrollbarColor: '#1f2937 transparent' }}>
        {loading && logs.length === 0 ? (
          <div className="text-gray-500 animate-pulse">Initializing terminal environment...</div>
        ) : logs.length === 0 ? (
          <div className="text-gray-500">No logs generated yet. Waiting for ingestion daemon...</div>
        ) : (
          logs.map(log => {
            const time = log.createdAt.replace('T', ' ').substring(0, 19);
            
            // Allow errors and warnings to be slightly visible, but default to terminal green
            let colorClass = 'text-emerald-400';
            if (log.level === 'ERROR') colorClass = 'text-red-400';
            else if (log.level === 'WARNING') colorClass = 'text-yellow-400';
            
            return (
              <div key={log.id} className={cn("break-all font-mono whitespace-pre-wrap", colorClass)}>
                <span>[{time}]</span> <span>[{log.level}]</span> {log.message}
                {log.details && (
                  <span className="ml-2 opacity-80">
                    {JSON.stringify(log.details)}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
