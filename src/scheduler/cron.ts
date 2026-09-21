import { runScan } from '../services/scanner';
import { getSettings } from '../services/settings';
import { logInfo, logSuccess } from '../services/logger';

let currentTimer: NodeJS.Timeout | null = null;

export async function startScheduler() {
  try {
    const settings = await getSettings();
    const intervalMinutes = settings?.scanInterval || 10;
    
    if (currentTimer) {
      clearInterval(currentTimer);
      logInfo(`Scheduler updated. New interval: ${intervalMinutes} minutes`, 'Scheduler');
    } else {
      logSuccess('Scheduler started successfully', 'Scheduler');
    }

    console.log(`Starting scheduler with interval: ${intervalMinutes} minutes`);
    logInfo(`Next scan scheduled (Interval: ${intervalMinutes}m)`, 'Scheduler');
    
    currentTimer = setInterval(async () => {
      await runScan();
      logInfo(`Next scan scheduled (Interval: ${intervalMinutes}m)`, 'Scheduler');
    }, intervalMinutes * 60 * 1000);

    // Run initially
    runScan();
  } catch (error) {
    console.error('Failed to start scheduler:', error);
  }
}

export function restartScheduler() {
  console.log('Restarting scheduler...');
  startScheduler();
}
