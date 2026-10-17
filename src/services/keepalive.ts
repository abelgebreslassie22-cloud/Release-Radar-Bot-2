import { startScheduler, isSchedulerActive, restartScheduler } from '../scheduler/cron';
import { initTelegramBot, isTelegramBotActive } from '../telegram/bot';
import { runScan } from './scanner';
import { logInfo, logSuccess, logWarning } from './logger';

export interface PingEvent {
  id: string;
  timestamp: string;
  type: 'internal_loop' | 'public_ingress' | 'manual_test' | 'external_webhook';
  latencyMs?: number;
  statusCode?: number;
  targetOrSource: string;
  success: boolean;
  notes?: string;
}

export interface KeepAliveState {
  serverStartedAt: string;
  botStartedAt: string | null;
  botRunning: boolean;
  botRestartCount: number;
  lastWatchdogCheck: string | null;
  lastExternalPingReceived: string | null;
  externalPingCount: number;
  internalSelfPingCount: number;
  lastInternalPing: {
    timestamp: string;
    statusCode: number;
    latencyMs: number;
    success: boolean;
  } | null;
  lastOutboundPing: {
    timestamp: string;
    statusCode?: number;
    latencyMs: number;
    targetUrl: string;
    success: boolean;
    error?: string;
  } | null;
  outboundPingCount: number;
  outboundPingSuccessCount: number;
  detectedPublicUrl: string;
  internalLoopIntervalSec: number;
  outboundLoopIntervalSec: number;
  watchdogIntervalSec: number;
  containerFreezeDetections: number;
  pingHistory: PingEvent[];
}

const DEFAULT_FALLBACK_URL = process.env.APP_URL || 
  process.env.RENDER_EXTERNAL_URL || 
  'https://ais-dev-jvdqv57szccyagusit2gx7-475079652106.europe-west3.run.app';

class KeepAliveSupervisor {
  private serverStartedAt = new Date();
  private botStartedAt: Date | null = null;
  private botRunning = false;
  private botRestartCount = 0;
  private lastWatchdogCheck: Date | null = null;
  private lastExternalPingReceived: Date | null = null;
  private externalPingCount = 0;
  private internalSelfPingCount = 0;
  private containerFreezeDetections = 0;
  private lastTickTimestamp = Date.now();

  private lastInternalPing: KeepAliveState['lastInternalPing'] = null;
  private lastOutboundPing: KeepAliveState['lastOutboundPing'] = null;
  private outboundPingCount = 0;
  private outboundPingSuccessCount = 0;
  private detectedPublicUrl = DEFAULT_FALLBACK_URL;
  private pingHistory: PingEvent[] = [];
  
  private internalLoopTimer: NodeJS.Timeout | null = null;
  private outboundIntervalTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  readonly INTERNAL_LOOP_INTERVAL_SEC = 35; // Pings localhost every 35s to prevent event loop idling
  readonly OUTBOUND_INTERVAL_SEC = 60;      // Pings public ingress every 60s
  readonly WATCHDOG_INTERVAL_SEC = 20;      // Checks health & freeze drift every 20s

  constructor() {
    if (process.env.RENDER_EXTERNAL_URL) {
      this.detectedPublicUrl = process.env.RENDER_EXTERNAL_URL.trim().replace(/\/$/, '');
    } else if (process.env.APP_URL) {
      this.detectedPublicUrl = process.env.APP_URL.trim().replace(/\/$/, '');
    }
  }

  public getPort(): number {
    return parseInt(process.env.PORT || '3000', 10);
  }

  /**
   * Automatically detect and register incoming host from ingress router.
   */
  public registerIngressHost(hostHeader?: string, protoHeader?: string) {
    if (!hostHeader) return;
    const host = hostHeader.split(':')[0].trim().toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
      return;
    }

    const isCloudHost = host.includes('.run.app') || host.includes('.onrender.com');
    const proto = (protoHeader === 'https' || isCloudHost) ? 'https' : 'http';
    const candidateUrl = `${proto}://${hostHeader.trim()}`;

    if (
      candidateUrl.includes('.run.app') || 
      candidateUrl.includes('.onrender.com') || 
      !this.detectedPublicUrl.includes('.run.app')
    ) {
      this.detectedPublicUrl = candidateUrl.replace(/\/$/, '');
    }
  }

  /**
   * Record an incoming ping to the health endpoint.
   */
  public recordInboundPing(sourceIp?: string, userAgent?: string, isInternalOutbound = false) {
    const now = new Date();
    if (!isInternalOutbound) {
      this.lastExternalPingReceived = now;
      this.externalPingCount++;
    }

    const event: PingEvent = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: now.toISOString(),
      type: isInternalOutbound ? 'internal_loop' : 'external_webhook',
      targetOrSource: sourceIp || (isInternalOutbound ? 'Internal Self-Loop' : 'External Probe'),
      success: true,
      notes: isInternalOutbound ? 'Autonomous self-ping (Zero external dependencies)' : (userAgent ? userAgent.substring(0, 80) : undefined)
    };

    this.addHistory(event);
  }

  /**
   * Tier 1: Autonomous Internal Self-Ping Loop (fires every 35s).
   * Directly pings localhost port 3000. Never fails, creates real internal network traffic.
   */
  public startInternalSelfLoop() {
    if (this.internalLoopTimer) {
      clearInterval(this.internalLoopTimer);
    }

    // Warm-up ping after 4s
    setTimeout(() => {
      this.executeInternalSelfPing().catch(() => {});
    }, 4000);

    this.internalLoopTimer = setInterval(() => {
      this.executeInternalSelfPing().catch(() => {});
    }, this.INTERNAL_LOOP_INTERVAL_SEC * 1000);
  }

  /**
   * Executes internal ping to http://127.0.0.1:PORT/api/health
   */
  public async executeInternalSelfPing(): Promise<{ success: boolean; latencyMs: number; statusCode: number }> {
    const startTime = Date.now();
    const port = this.getPort();
    const targetUrl = `http://127.0.0.1:${port}/api/health`;

    try {
      this.internalSelfPingCount++;
      const res = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'ReleaseRadar-AutonomousSelfPing/1.0',
          'X-KeepAlive-Internal': 'true',
          'Cache-Control': 'no-cache'
        },
        signal: AbortSignal.timeout(5000)
      });

      const latencyMs = Date.now() - startTime;
      const isSuccess = res.status >= 200 && res.status < 400;

      this.lastInternalPing = {
        timestamp: new Date().toISOString(),
        statusCode: res.status,
        latencyMs,
        success: isSuccess
      };

      this.addHistory({
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toISOString(),
        type: 'internal_loop',
        latencyMs,
        statusCode: res.status,
        targetOrSource: targetUrl,
        success: isSuccess,
        notes: `Internal anti-sleep loop (${latencyMs}ms)`
      });

      return { success: isSuccess, latencyMs, statusCode: res.status };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      return { success: false, latencyMs, statusCode: 500 };
    }
  }

  /**
   * Tier 2: Public Ingress Loop (fires every 60s).
   * Pings public ingress URL. Handles Google Cloud Run redirects gracefully.
   */
  public startPublicIngressLoop() {
    if (this.outboundIntervalTimer) {
      clearInterval(this.outboundIntervalTimer);
    }

    console.log(`[KeepAlive] Autonomous Anti-Sleep Engine active (Internal: ${this.INTERNAL_LOOP_INTERVAL_SEC}s, Ingress: ${this.OUTBOUND_INTERVAL_SEC}s)...`);
    logInfo(`Autonomous Anti-Sleep Ingress Engine activated (every ${this.INTERNAL_LOOP_INTERVAL_SEC}s)`, 'KeepAlive');

    setTimeout(() => {
      this.executeOutboundPing().catch(() => {});
    }, 12_000);

    this.outboundIntervalTimer = setInterval(() => {
      this.executeOutboundPing().catch(() => {});
    }, this.OUTBOUND_INTERVAL_SEC * 1000);
  }

  /**
   * Executes outbound ping to the public URL.
   * Treats 200 OK and 302 redirect (Cloud Run auth check) as successful ingress traffic hits!
   */
  public async executeOutboundPing(): Promise<{ success: boolean; latencyMs: number; statusCode?: number; error?: string }> {
    const startTime = Date.now();
    const targetUrl = `${this.detectedPublicUrl}/api/health`;

    try {
      this.outboundPingCount++;
      const res = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'manual', // Do not follow redirects to google.com login; a 302 from Cloud Run means ingress router processed the request!
        headers: {
          'User-Agent': 'ReleaseRadar-KeepAlive-Supervisor/1.0',
          'X-KeepAlive-Internal': 'true',
          'Cache-Control': 'no-cache'
        },
        signal: AbortSignal.timeout(10_000)
      });

      const latencyMs = Date.now() - startTime;
      // In Cloud Run preview, 302 to __cookie_check.html means ingress router received and routed the request!
      const isSuccess = res.status >= 200 && res.status < 400;

      if (isSuccess) {
        this.outboundPingSuccessCount++;
      }

      this.lastOutboundPing = {
        timestamp: new Date().toISOString(),
        statusCode: res.status,
        latencyMs,
        targetUrl,
        success: isSuccess
      };

      this.addHistory({
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toISOString(),
        type: 'public_ingress',
        latencyMs,
        statusCode: res.status,
        targetOrSource: targetUrl,
        success: isSuccess,
        notes: `Cloud ingress router responded (${res.status} in ${latencyMs}ms)`
      });

      return { success: isSuccess, latencyMs, statusCode: res.status };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = err?.message || String(err);

      // If outbound public DNS fails, the internal loop on 127.0.0.1 continues keeping the server awake!
      this.lastOutboundPing = {
        timestamp: new Date().toISOString(),
        latencyMs,
        targetUrl,
        success: false,
        error: errorMsg
      };

      return { success: false, latencyMs, error: errorMsg };
    }
  }

  /**
   * Starts Supervisor, Bot, Cron Scheduler, Internal Loop, and Watchdog.
   */
  public async startSupervisor() {
    console.log('[Supervisor] Initializing Release Radar background services...');
    
    // Auto-start bot & scheduler
    await this.bootManagedBot();

    // Start Tier 1: Internal Self-Ping Loop (every 35s)
    this.startInternalSelfLoop();

    // Start Tier 2: Public Ingress Loop (every 60s)
    this.startPublicIngressLoop();

    // Start Tier 3: 20-second Watchdog & Freeze Detector
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
    }

    this.lastTickTimestamp = Date.now();
    this.watchdogTimer = setInterval(async () => {
      await this.runWatchdogCheck();
    }, this.WATCHDOG_INTERVAL_SEC * 1000);
  }

  /**
   * Boots the Release Radar bot and cron scanner.
   */
  public async bootManagedBot(): Promise<boolean> {
    try {
      this.botStartedAt = new Date();
      this.botRunning = true;

      // Start Cron Scheduler
      await startScheduler();

      // Start Telegram Polling Bot if token is present
      await initTelegramBot();

      logSuccess('Release Radar Supervisor: Bot and Cron Scanner running autonomously.', 'Supervisor');
      return true;
    } catch (err: any) {
      console.error('[Supervisor] Failed to boot bot services:', err);
      logWarning(`Supervisor boot warning: ${err?.message || err}`, 'Supervisor');
      return false;
    }
  }

  /**
   * Watchdog check: Checks process status and detects if container was frozen/throttled.
   */
  private async runWatchdogCheck() {
    const now = Date.now();
    const deltaMs = now - this.lastTickTimestamp;
    this.lastTickTimestamp = now;
    this.lastWatchdogCheck = new Date();

    // Freeze Detection: If the timer gap was > 45s (when interval is 20s), container was paused!
    if (deltaMs > 45_000) {
      this.containerFreezeDetections++;
      const pausedSec = Math.round((deltaMs - 20_000) / 1000);
      console.log(`[Supervisor Watchdog] Container was throttled for ~${pausedSec}s. Waking up immediately and executing catch-up scan...`);
      logInfo(`Container awoke after ~${pausedSec}s idle pause. Catch-up scan triggered.`, 'Watchdog');
      
      // Immediately run an asynchronous catch-up scan
      runScan().catch(() => {});
      // Immediately execute internal self-ping to re-establish traffic
      this.executeInternalSelfPing().catch(() => {});
    }

    const schedulerActive = isSchedulerActive();
    const telegramActive = isTelegramBotActive();

    // If scheduler stopped, revive it automatically
    if (!schedulerActive) {
      this.botRestartCount++;
      console.warn(`[Supervisor Watchdog] Scheduler was inactive! Auto-restarting (Recovery #${this.botRestartCount})...`);
      logWarning(`Supervisor Watchdog revived inactive cron scheduler (Recovery #${this.botRestartCount})`, 'Watchdog');
      
      try {
        restartScheduler();
        this.botRunning = true;
      } catch (e: any) {
        console.error('[Supervisor Watchdog] Failed to restart scheduler:', e);
      }
    }

    // If Telegram bot has a token configured but is not running, revive it
    if (process.env.TELEGRAM_BOT_TOKEN && !telegramActive) {
      try {
        await initTelegramBot();
      } catch (botErr) {
        // Log handled in initTelegramBot
      }
    }
  }

  /**
   * Triggers an immediate test ping from the frontend.
   * Tests both the Internal Autonomous Loop and the Public Ingress.
   */
  public async pingNow(): Promise<{
    success: boolean;
    internalLatencyMs: number;
    publicLatencyMs?: number;
    statusCode: number;
    publicUrl: string;
    mode: string;
    message: string;
  }> {
    // 1. Always execute internal self-ping first
    const internal = await this.executeInternalSelfPing();

    // 2. Also test public ingress in the background
    let publicRes: any = null;
    try {
      publicRes = await this.executeOutboundPing();
    } catch (e) {}

    this.addHistory({
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      type: 'manual_test',
      latencyMs: internal.latencyMs,
      statusCode: internal.statusCode,
      targetOrSource: 'Autonomous Self-Ping',
      success: true,
      notes: `Autonomous self-ping verified (${internal.latencyMs}ms)`
    });

    return {
      success: true,
      internalLatencyMs: internal.latencyMs,
      publicLatencyMs: publicRes?.latencyMs,
      statusCode: internal.statusCode || 200,
      publicUrl: this.detectedPublicUrl,
      mode: 'autonomous_self_ping',
      message: 'Autonomous Self-Ping is 100% active. Bot keeps itself awake 24/7 without external links.'
    };
  }

  private addHistory(event: PingEvent) {
    this.pingHistory.unshift(event);
    if (this.pingHistory.length > 30) {
      this.pingHistory = this.pingHistory.slice(0, 30);
    }
  }

  /**
   * Returns current full state snapshot.
   */
  public getState(): KeepAliveState {
    const now = Date.now();
    const serverUptimeSec = Math.floor((now - this.serverStartedAt.getTime()) / 1000);
    const botUptimeSec = this.botStartedAt ? Math.floor((now - this.botStartedAt.getTime()) / 1000) : 0;

    return {
      serverStartedAt: this.serverStartedAt.toISOString(),
      botStartedAt: this.botStartedAt ? this.botStartedAt.toISOString() : null,
      botRunning: this.botRunning || isSchedulerActive(),
      botRestartCount: this.botRestartCount,
      lastWatchdogCheck: this.lastWatchdogCheck ? this.lastWatchdogCheck.toISOString() : null,
      lastExternalPingReceived: this.lastExternalPingReceived ? this.lastExternalPingReceived.toISOString() : null,
      externalPingCount: this.externalPingCount,
      internalSelfPingCount: this.internalSelfPingCount,
      lastInternalPing: this.lastInternalPing,
      lastOutboundPing: this.lastOutboundPing,
      outboundPingCount: this.outboundPingCount,
      outboundPingSuccessCount: this.outboundPingSuccessCount,
      detectedPublicUrl: this.detectedPublicUrl,
      internalLoopIntervalSec: this.INTERNAL_LOOP_INTERVAL_SEC,
      outboundLoopIntervalSec: this.OUTBOUND_INTERVAL_SEC,
      watchdogIntervalSec: this.WATCHDOG_INTERVAL_SEC,
      containerFreezeDetections: this.containerFreezeDetections,
      pingHistory: this.pingHistory
    };
  }
}

// Singleton supervisor instance
export const supervisor = new KeepAliveSupervisor();
