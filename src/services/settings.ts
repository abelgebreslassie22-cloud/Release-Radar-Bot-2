import { eq } from 'drizzle-orm';
import { db } from '../database/db';
import { settings } from '../database/schema';

export async function initializeSettings(instanceId?: string) {
  try {
    const allSettings = await db.select().from(settings);
    if (allSettings.length === 0) {
      await db.insert(settings).values({ scanInterval: 10, activeInstanceId: instanceId, providerType: 'TMDB' });
    } else {
      const active = allSettings[0];
      const updates: any = {};
      if (instanceId) {
        if (active.activeInstanceId && active.activeInstanceId !== instanceId) {
          console.warn(`WARNING: Another instance might be running (Previous ID: ${active.activeInstanceId}, Current ID: ${instanceId}). Duplicate background services may occur.`);
          import('./logger').then(({ logWarning }) => {
             logWarning(`Another instance started. Previous ID: ${active.activeInstanceId}, New ID: ${instanceId}. Duplicate background services may occur.`, 'System');
          }).catch(console.error);
        }
        updates.activeInstanceId = instanceId;
      }
      if (!active.providerType || active.providerType === 'PIRATEBAY' || active.providerType === 'TORZNAB' || (active.providerType === 'RSS' && !active.providerUrl)) {
        updates.providerType = 'TMDB';
      }
      // Ensure appUrl points to the real public URL (https://release-radar-bot-2.onrender.com) and clear any preview/sandbox links
      if (!active.appUrl || active.appUrl.includes('jrnm.app') || active.appUrl.includes('ais-dev-') || active.appUrl.includes('ais-pre-') || active.appUrl.includes('release-radar-bot.onrender.com')) {
        updates.appUrl = 'https://release-radar-bot-2.onrender.com';
      }
      if (Object.keys(updates).length > 0) {
        await db.update(settings).set(updates).where(eq(settings.id, active.id));
      }
    }
  } catch (e) {
    console.error('Error initializing settings (DB might not be configured properly):', e);
  }
}

export async function getSettings() {
  try {
    if (!process.env.DATABASE_URL) return null;
    const allSettings = await db.select().from(settings);
    return allSettings[0] || null;
  } catch (e: any) {
    console.warn('[Fallback] getSettings failed (Database down?)', e.message);
    return null;
  }
}

export async function updateSettings(data: any) {
  try {
    const allSettings = await db.select().from(settings);
    if (allSettings && allSettings.length > 0) {
      await db.update(settings).set(data).where(eq(settings.id, allSettings[0].id));
    } else {
      await db.insert(settings).values(data);
    }
  } catch (e) {
    console.error('Failed to update settings in DB:', e);
  }
}
