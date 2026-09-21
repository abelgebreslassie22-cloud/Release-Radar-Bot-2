import { db, pool } from '../database/db';
import { logs, settings } from '../database/schema';

type LogLevel = 'INFO' | 'ERROR' | 'WARNING' | 'SUCCESS';

async function writeLog(level: LogLevel, message: string, service: string, details?: any) {
  try {
    if (!process.env.DATABASE_URL) return;
    
    // Quick fast-fail check to avoid freezing up on ENETUNREACH if pool is down
    if (pool.totalCount > 0 && pool.idleCount === 0 && pool.waitingCount > 5) {
      console.warn(`[Logger Fallback - Pool busy] [${level}] [${service}]: ${message}`);
      return;
    }
    
    const s = await db.select({ debugMode: settings.debugMode }).from(settings).limit(1);
    const isDebug = s.length > 0 && s[0].debugMode === 1;

    if (level === 'INFO' && !isDebug) {
      // Not storing general info logs when debug is off
    }

    await db.insert(logs).values({
      level,
      message,
      service,
      details: details ? details : null,
    });
  } catch (err: any) {
    // Graceful fallback if database connection is failing/down
    console.error(`[Logger Fallback] [${level}] [${service}]: ${message}`, err.message);
  }
}

export async function logInfo(message: string, service: string, details?: any) {
  await writeLog('INFO', message, service, details);
}

export async function logError(message: string, service: string, details?: any) {
  await writeLog('ERROR', message, service, details);
}

export async function logWarning(message: string, service: string, details?: any) {
  await writeLog('WARNING', message, service, details);
}

export async function logSuccess(message: string, service: string, details?: any) {
  await writeLog('SUCCESS', message, service, details);
}

export async function logDebug(message: string, service: string, details?: any) {
  try {
    const s = await db.select({ debugMode: settings.debugMode }).from(settings).limit(1);
    const isDebug = s.length > 0 && s[0].debugMode === 1;
    if (isDebug) {
      await writeLog('INFO', message, service, details);
    }
  } catch (err) {
    console.error('Failed to write debug log:', err);
  }
}
