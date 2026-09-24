import TelegramBotModule from 'node-telegram-bot-api';
const TelegramBot = (typeof TelegramBotModule === 'function') 
  ? TelegramBotModule 
  : (TelegramBotModule as any).default;

import { getSettings } from '../services/settings';
import { ReleaseItem } from '../utils/mediaGrouper';
import { logInfo, logError, logSuccess, logWarning } from '../services/logger';
import { getGroupKey } from '../utils/mediaGrouper';
import { db } from '../database/db';
import { watchlist, releases } from '../database/schema';
import { desc, eq } from 'drizzle-orm';
import { runScan } from '../services/scanner';
import { searchMedia } from '../metadata/tmdb';

let bot: any = null;

function escapeHtml(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function getBaseUrl(settingsObj?: any): Promise<string> {
  let appUrl = settingsObj?.appUrl;
  if (!appUrl) {
    const s = await getSettings();
    appUrl = s?.appUrl;
  }
  if (appUrl && appUrl.trim() && !appUrl.includes('jrnm.app') && !appUrl.includes('ais-dev-') && !appUrl.includes('ais-pre-')) {
    return appUrl.trim().replace(/\/$/, '');
  }
  if (process.env.RENDER_EXTERNAL_URL && process.env.RENDER_EXTERNAL_URL.trim()) {
    return process.env.RENDER_EXTERNAL_URL.trim().replace(/\/$/, '');
  }
  const envUrl = process.env.APP_URL;
  if (envUrl && envUrl.trim() && !envUrl.includes('jrnm.app') && !envUrl.includes('ais-dev-') && !envUrl.includes('ais-pre-') && !envUrl.includes('MY_APP_URL')) {
    return envUrl.trim().replace(/\/$/, '');
  }
  return 'https://release-radar-bot-2.onrender.com';
}

export async function initTelegramBot(customToken?: string, appUrlString?: string): Promise<{ success: boolean; botInfo?: any; error?: string }> {
  if (process.env.DISABLE_TELEGRAM_BOT === 'true') {
    console.log('DISABLE_TELEGRAM_BOT is set to true. Skipping Telegram bot initialization.');
    logInfo('Telegram bot disabled via DISABLE_TELEGRAM_BOT environment variable.', 'Telegram');
    return { success: false, error: 'Telegram bot disabled via configuration' };
  }

  const token = customToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !token.trim()) {
    return { success: false, error: 'No Telegram bot token provided' };
  }

  const cleanToken = token.trim();

  // If a bot is already running, stop polling first
  await stopTelegramBot();

  try {
    // Validate token first by fetching bot info
    const testRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
    const testData: any = await testRes.json();
    if (!testData.ok) {
      return { success: false, error: testData.description || 'Invalid Telegram Bot Token' };
    }
    const botUser = testData.result;
    process.env.TELEGRAM_BOT_TOKEN = cleanToken;

    // CRITICAL: Delete any stale webhooks from previous sessions.
    // If a webhook was ever active, Telegram returns 409 Conflict and refuses to deliver updates to polling!
    try {
      await fetch(`https://api.telegram.org/bot${cleanToken}/deleteWebhook?drop_pending_updates=false`);
      console.log('Deleted old Telegram webhook to guarantee reliable Long Polling.');
    } catch (whErr) {
      console.warn('Could not clear webhook:', whErr);
    }

    // Always use robust Long Polling. Long Polling works on Render, local, cloud, without open ports or HTTPS domain issues.
    bot = new TelegramBot(cleanToken, {
      polling: {
        interval: 1000,
        autoStart: true,
        params: {
          timeout: 10
        }
      }
    });

    bot.on('polling_error', (error: any) => {
      const errMsg = error?.message || String(error);
      if (errMsg.includes('409 Conflict')) {
        console.warn('Telegram 409 Conflict: Another bot instance may be running or webhook is lingering. Attempting to clear webhook...');
        fetch(`https://api.telegram.org/bot${cleanToken}/deleteWebhook?drop_pending_updates=false`).catch(() => {});
      } else {
        console.warn('Telegram polling warning:', errMsg);
      }
    });

    try {
      bot.deleteMyCommands().catch(() => {});
    } catch (e) {}

    const sendDashboard = async (chatId: number, messageId?: number) => {
      try {
        const baseUrl = await getBaseUrl();
        const wlCount = await db.select({ id: watchlist.id }).from(watchlist);
        const relCount = await db.select({ id: releases.id }).from(releases);
        
        const text = `<b>🍿 Release Radar Dashboard</b>

<b>System Status:</b> 🟢 Online & Polling
<b>Watchlist:</b> ${wlCount.length} Items Monitored
<b>Discovered Releases:</b> ${relCount.length} Total

<i>Tap an action below to manage your tracker:</i>`;
        
        const inlineKeyboard = [
          [
            { text: '📋 My Watchlist', callback_data: 'menu_watchlist_0' },
            { text: '🎬 Recent Releases', callback_data: 'menu_recent_0' }
          ],
          [
            { text: '🔄 Force Scan Now', callback_data: 'action_force_scan' },
            { text: '➕ How to Add', callback_data: 'action_how_to_add' }
          ],
          [
            { text: '🌐 Open Full Web App', url: baseUrl }
          ]
        ];

        const opts: any = {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        };

        if (messageId) {
          bot.deleteMessage(chatId, messageId).catch(() => {});
        }
        await bot.sendMessage(chatId, text, opts);
      } catch (err) {
        console.error("Dashboard error:", err);
      }
    };

    // Main /start command
    bot.onText(/\/start/, (msg: any) => {
      bot.sendMessage(msg.chat.id, '✅ <b>Connected to Release Radar!</b>\n\nUse the buttons below or send <code>/scan</code>, <code>/watchlist</code>, or <code>/add &lt;movie or show&gt;</code> to control your radar.', {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '📋 Menu' }, { text: '🔄 Scan' }, { text: '📋 Watchlist' }]
          ],
          resize_keyboard: true,
          is_persistent: true
        }
      }).then(() => {
        sendDashboard(msg.chat.id);
      });
    });

    bot.onText(/\/menu/, (msg: any) => {
      sendDashboard(msg.chat.id);
    });

    bot.onText(/\/scan/, async (msg: any) => {
      const chatId = msg.chat.id;
      bot.sendMessage(chatId, '<b>🔄 Manual Scan Started...</b>\n\nChecking scene release indexers and TMDB digital radar for your watchlist items.', { parse_mode: 'HTML' });
      try {
        await runScan();
        bot.sendMessage(chatId, '✅ <b>Scan Complete!</b> Check above for new download or release notifications.', { parse_mode: 'HTML' });
      } catch (e: any) {
        bot.sendMessage(chatId, `❌ <b>Scan Error:</b> ${e.message}`, { parse_mode: 'HTML' });
      }
    });

    bot.onText(/\/watchlist|\/wl/, async (msg: any) => {
      const chatId = msg.chat.id;
      const items = await db.select().from(watchlist).orderBy(desc(watchlist.createdAt));
      if (items.length === 0) {
        return bot.sendMessage(chatId, '📋 <b>Your Watchlist is currently empty.</b>\n\nSend <code>/add &lt;Movie or Show Name&gt;</code> to start tracking downloads!', { parse_mode: 'HTML' });
      }
      let text = `<b>📋 Your Watchlist (${items.length} items):</b>\n\n`;
      items.forEach((item, idx) => {
        text += `${idx + 1}. <b>${escapeHtml(item.title)}</b> (${item.year}) [<i>${escapeHtml(item.type)}</i>]\n`;
      });
      text += `\n<i>Tap '📋 Menu' to browse with interactive controls.</i>`;
      bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    });

    bot.onText(/\/releases/, async (msg: any) => {
      const chatId = msg.chat.id;
      const items = await db.select().from(releases).orderBy(desc(releases.createdAt)).limit(10);
      if (items.length === 0) {
        return bot.sendMessage(chatId, '🎬 <b>No releases discovered yet.</b> Run <code>/scan</code> to check providers.', { parse_mode: 'HTML' });
      }
      let text = `<b>🎬 Latest Discovered Releases:</b>\n\n`;
      items.forEach((item, idx) => {
        text += `${idx + 1}. <b>${escapeHtml(item.title)}</b> (${item.year})\n   ↳ <i>${escapeHtml(item.releaseType)}</i>\n\n`;
      });
      bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    });

    bot.onText(/\/add (.+)/, async (msg: any, match: any) => {
      const chatId = msg.chat.id;
      const query = match && match[1] ? match[1].trim() : '';
      if (!query) return;

      try {
        bot.sendMessage(chatId, `🔍 Searching for "<b>${escapeHtml(query)}</b>"...`, { parse_mode: 'HTML' });
        const results = await searchMedia(query);
        if (results.length === 0) {
          return bot.sendMessage(chatId, `❌ No movies or TV series found for "${escapeHtml(query)}".`, { parse_mode: 'HTML' });
        }
        const top = results[0];
        
        // Add to watchlist
        await db.insert(watchlist).values({
          title: top.title,
          year: top.year,
          type: top.type,
        }).onConflictDoNothing();

        bot.sendMessage(chatId, `✅ <b>Added to Watchlist!</b>\n\n<b>Title:</b> ${escapeHtml(top.title)} (${top.year})\n<b>Type:</b> ${escapeHtml(top.type)}\n\n🔄 Checking download indexers now...`, { parse_mode: 'HTML' });
        
        // Run quick scan for this new addition
        await runScan();
      } catch (err: any) {
        bot.sendMessage(chatId, `❌ Failed to add title: ${err.message}`, { parse_mode: 'HTML' });
      }
    });

    bot.onText(/\/help/, (msg: any) => {
      const text = `<b>🤖 Release Radar Bot Commands:</b>

/start - Open welcome screen & menu
/menu - Show interactive control dashboard
/scan - Run an immediate scan for downloads
/watchlist or /wl - Show all watchlist titles
/releases - Show recent discovered releases
/add &lt;title&gt; - Add a movie or TV show to track
/ping - Test bot responsiveness`;
      bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
    });

    // Handle persistent keyboard button clicks
    bot.on('message', async (msg: any) => {
      if (!msg.text) return;
      if (msg.text === '📋 Menu') {
        await sendDashboard(msg.chat.id);
      } else if (msg.text === '🔄 Scan') {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, '<b>🔄 Scan Initiated...</b>', { parse_mode: 'HTML' });
        try {
          await runScan();
          bot.sendMessage(chatId, '✅ <b>Scan Complete!</b> Check above for notifications.', { parse_mode: 'HTML' });
        } catch (e: any) {
          bot.sendMessage(chatId, `❌ Scan failed: ${e.message}`, { parse_mode: 'HTML' });
        }
      } else if (msg.text === '📋 Watchlist') {
        const chatId = msg.chat.id;
        const items = await db.select().from(watchlist).orderBy(desc(watchlist.createdAt));
        if (items.length === 0) {
          bot.sendMessage(chatId, '📋 <b>Watchlist is empty.</b> Use <code>/add &lt;name&gt;</code> to track titles.', { parse_mode: 'HTML' });
        } else {
          let text = `<b>📋 Your Watchlist (${items.length} items):</b>\n\n`;
          items.forEach((item, idx) => {
            text += `${idx + 1}. <b>${escapeHtml(item.title)}</b> (${item.year}) [<i>${escapeHtml(item.type)}</i>]\n`;
          });
          bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
        }
      }
    });

    // CRITICAL: Callback query handler for inline buttons
    bot.on('callback_query', async (query: any) => {
      // ALWAYS answer callback query immediately to stop the button loading spinner!
      try {
        await bot.answerCallbackQuery(query.id).catch(() => {});
      } catch (e) {}

      const chatId = query.message?.chat?.id;
      const messageId = query.message?.message_id;
      const data = query.data;

      if (!chatId || !data) return;

      if (data === 'action_main_menu') {
        await sendDashboard(chatId, messageId);
      } 
      else if (data === 'action_how_to_add') {
        const text = `<b>➕ How to Add Movies & Series:</b>

1. In Telegram chat: Send <code>/add Title</code>
   <i>Example:</i> <code>/add Gladiator 2</code> or <code>/add Severance</code>
2. In Web App: Click <b>Watchlist</b> ➔ <b>Add Movie/Series</b>

The bot will automatically check download indexers and alert you the second it's released!`;
        bot.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'action_main_menu' }]]
          }
        });
      }
      else if (data === 'action_force_scan') {
        bot.deleteMessage(chatId, messageId).catch(() => {});
        await bot.sendMessage(chatId, '<b>🔄 Force Scan Initiated...</b>\n\nChecking scene release indexers and TMDB digital radar. You will receive notifications if any new downloads or premiere updates are found.', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'action_main_menu' }]]
          }
        });
        try {
          await runScan();
          bot.sendMessage(chatId, '✅ <b>Scan Complete!</b> Check above for any new release alerts.', { parse_mode: 'HTML' });
        } catch(e: any) {
          bot.sendMessage(chatId, `❌ <b>Scan Failed:</b> ${e.message}`, { parse_mode: 'HTML' });
        }
      }
      else if (data.startsWith('send_magnet_')) {
        const releaseId = parseInt(data.replace('send_magnet_', ''), 10);
        try {
          const rels = await db.select().from(releases).where(eq(releases.id, releaseId)).limit(1);
          if (rels.length > 0 && rels[0].sourceUrl) {
            const rel = rels[0];
            const isMagnet = rel.sourceUrl.startsWith('magnet:');
            if (isMagnet) {
              await bot.sendMessage(chatId, `🧲 <b>Magnet Link for ${escapeHtml(rel.title)}:</b>\n\n<code>${rel.sourceUrl}</code>\n\n<i>Tap the code above to copy it with one click!</i>`, { parse_mode: 'HTML' });
            } else {
              await bot.sendMessage(chatId, `🔗 <b>Source Link for ${escapeHtml(rel.title)}:</b>\n\n<a href="${rel.sourceUrl}">${rel.sourceUrl}</a>`, { parse_mode: 'HTML' });
            }
          } else {
            bot.sendMessage(chatId, '❌ Release link not found or expired.', { parse_mode: 'HTML' });
          }
        } catch (e: any) {
          bot.sendMessage(chatId, `❌ Error retrieving magnet: ${e.message}`, { parse_mode: 'HTML' });
        }
      }
      else if (data.startsWith('delete_wl_')) {
        const wlId = parseInt(data.replace('delete_wl_', ''), 10);
        try {
          const item = await db.select().from(watchlist).where(eq(watchlist.id, wlId)).limit(1);
          if (item.length > 0) {
            await db.delete(watchlist).where(eq(watchlist.id, wlId));
            bot.sendMessage(chatId, `🗑️ Removed "<b>${escapeHtml(item[0].title)}</b>" from your Watchlist.`, { parse_mode: 'HTML' });
            await sendDashboard(chatId);
          }
        } catch (delErr: any) {
          bot.sendMessage(chatId, `❌ Failed to remove item: ${delErr.message}`, { parse_mode: 'HTML' });
        }
      }
      else if (data.startsWith('menu_watchlist_')) {
        const page = parseInt(data.split('_')[2]) || 0;
        const itemsPerPage = 4;
        const items = await db.select().from(watchlist).orderBy(desc(watchlist.createdAt));
        const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
        const pagedItems = items.slice(page * itemsPerPage, (page + 1) * itemsPerPage);
        const baseUrl = await getBaseUrl();

        if (items.length === 0) {
          bot.deleteMessage(chatId, messageId).catch(() => {});
          bot.sendMessage(chatId, '📋 <b>Your Watchlist is currently empty.</b>\n\nUse <code>/add &lt;Title&gt;</code> to start tracking movies or TV series!', {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '➕ Manage Watchlist on Web', url: `${baseUrl}/#/watchlist` }],
                [{ text: '🔙 Back to Menu', callback_data: 'action_main_menu' }]
              ]
            }
          });
          return;
        }

        let listText = `<b>📋 Your Watchlist (Page ${page + 1} of ${totalPages}):</b>\n\n`;
        const buttons: any[] = [];

        pagedItems.forEach((item, idx) => {
          const num = (page * itemsPerPage) + idx + 1;
          const groupKey = getGroupKey(item.title, item.type);
          listText += `${num}. <b>${escapeHtml(item.title)}</b> (${item.year}) [<i>${escapeHtml(item.type)}</i>]\n   👉 <a href="${baseUrl}/#/media/${groupKey}">View Status Page</a>\n\n`;
          buttons.push([
            { text: `❌ Remove "${item.title.slice(0, 20)}"`, callback_data: `delete_wl_${item.id}` }
          ]);
        });

        const navRow: any[] = [];
        if (page > 0) navRow.push({ text: '⬅️ Prev', callback_data: `menu_watchlist_${page - 1}` });
        if (page < totalPages - 1) navRow.push({ text: 'Next ➡️', callback_data: `menu_watchlist_${page + 1}` });
        if (navRow.length > 0) buttons.push(navRow);
        
        buttons.push([{ text: '🔙 Back to Menu', callback_data: 'action_main_menu' }]);

        bot.deleteMessage(chatId, messageId).catch(() => {});
        bot.sendMessage(chatId, listText, {
          parse_mode: 'HTML', disable_web_page_preview: true,
          reply_markup: { inline_keyboard: buttons }
        }).catch(() => {});
      }
      else if (data.startsWith('menu_recent_')) {
        const page = parseInt(data.split('_')[2]) || 0;
        const itemsPerPage = 4;
        const items = await db.select().from(releases).orderBy(desc(releases.createdAt)).limit(20);
        const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
        const pagedItems = items.slice(page * itemsPerPage, (page + 1) * itemsPerPage);
        const baseUrl = await getBaseUrl();

        if (items.length === 0) {
          bot.deleteMessage(chatId, messageId).catch(() => {});
          bot.sendMessage(chatId, '🎬 <b>No discovered releases yet.</b>\n\nRun <code>/scan</code> to check download indexers.', {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Back to Menu', callback_data: 'action_main_menu' }]
              ]
            }
          });
          return;
        }

        let relText = `<b>🎬 Discovered Releases (Page ${page + 1} of ${totalPages}):</b>\n\n`;
        const buttons: any[] = [];

        pagedItems.forEach((item, idx) => {
          const num = (page * itemsPerPage) + idx + 1;
          const groupKey = getGroupKey(item.title, item.type);
          relText += `${num}. <b>${escapeHtml(item.title)}</b> (${item.year})\n   ↳ <i>${escapeHtml(item.releaseType)}</i>\n\n`;
          
          if (item.sourceUrl?.startsWith('magnet:')) {
            buttons.push([
              { text: `🧲 Magnet: ${item.title.slice(0, 16)}`, callback_data: `send_magnet_${item.id}` },
              { text: '🍿 Details', url: `${baseUrl}/#/media/${groupKey}` }
            ]);
          } else {
            buttons.push([
              { text: `🍿 View ${item.title.slice(0, 20)}`, url: `${baseUrl}/#/media/${groupKey}` }
            ]);
          }
        });

        const navRow: any[] = [];
        if (page > 0) navRow.push({ text: '⬅️ Prev', callback_data: `menu_recent_${page - 1}` });
        if (page < totalPages - 1) navRow.push({ text: 'Next ➡️', callback_data: `menu_recent_${page + 1}` });
        if (navRow.length > 0) buttons.push(navRow);
        
        buttons.push([{ text: '🔙 Back to Menu', callback_data: 'action_main_menu' }]);

        bot.deleteMessage(chatId, messageId).catch(() => {});
        bot.sendMessage(chatId, relText, {
          parse_mode: 'HTML', disable_web_page_preview: true,
          reply_markup: { inline_keyboard: buttons }
        }).catch(() => {});
      }
    });

    bot.onText(/\/ping/, (msg: any) => {
      bot?.sendMessage(msg.chat.id, '<b>Pong!</b> ⚡ Release Radar Bot is online and polling.', { parse_mode: 'HTML' });
    });

    console.log(`Telegram bot initialized via Long Polling (@${botUser.username}).`);
    logSuccess(`Telegram bot started via Long Polling (@${botUser.username})`, 'Telegram');
    return { success: true, botInfo: botUser };
  } catch (e: any) {
    console.error('Failed to initialize Telegram Bot:', e);
    logError(`Failed to start Telegram bot: ${e.message}`, 'Telegram');
    return { success: false, error: e.message };
  }
}

export async function sendTelegramNotification(item: ReleaseItem) {
  try {
    const settings = await getSettings();
    const targetChatId = settings?.telegramChatId || process.env.TELEGRAM_CHAT_ID;
    if (bot && targetChatId) {
      const groupKey = getGroupKey(item.title, item.type);
      const baseUrl = await getBaseUrl(settings);
      const detailUrl = `${baseUrl}/#/media/${groupKey}`;

      const yearSuffix = item.title.includes(String(item.year)) ? '' : ` (${item.year})`;
      const isDownload = item.releaseType.includes('Download Available') || item.sourceUrl?.startsWith('magnet:');
      
      const headerTitle = isDownload 
        ? `🔥 <b>NOW AVAILABLE TO DOWNLOAD!</b>`
        : `🎬 <b>Premiere & Release Alert!</b>`;

      const caption = `${headerTitle}

<b>Title:</b> ${escapeHtml(item.title)}${yearSuffix}
<b>Type:</b> ${escapeHtml(item.type)}
<b>Status:</b> ${escapeHtml(item.releaseType)}
<b>Provider:</b> ${escapeHtml(item.provider || 'Download Availability Radar')}

🍿 <b>View Details & Download Options:</b>
<a href="${detailUrl}">${detailUrl}</a>`;

      const inlineKeyboard: any[] = [];
      const row1: any[] = [];

      if (item.sourceUrl?.startsWith('magnet:')) {
        row1.push({ text: '🧲 Copy Magnet Link', callback_data: `send_magnet_${item.id || 0}` });
      }
      row1.push({ text: '🍿 Open Web Details', url: detailUrl });
      inlineKeyboard.push(row1);

      // Interactive quick actions
      inlineKeyboard.push([
        { text: '📋 My Watchlist', callback_data: 'menu_watchlist_0' },
        { text: '🔄 Scan Now', callback_data: 'action_force_scan' }
      ]);

      const options: any = {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      };

      let sent = false;
      if (item.poster) {
        if (item.poster.startsWith('data:image/svg')) {
          sent = false;
        } else if (item.poster.startsWith('http://') || item.poster.startsWith('https://')) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const imageRes = await fetch(item.poster, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            clearTimeout(timeoutId);

            if (imageRes.ok) {
              const contentType = imageRes.headers.get('content-type');
              if (contentType && contentType.startsWith('image/')) {
                const arrayBuffer = await imageRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                await bot.sendPhoto(targetChatId, buffer, {
                  caption,
                  ...options
                });
                sent = true;
              }
            }
          } catch (photoErr: any) {
            sent = false;
          }
        }
      }

      if (!sent) {
        await bot.sendMessage(targetChatId, caption, options);
      }

      console.log('Telegram notification sent successfully.');
      await logSuccess(`Telegram alert sent: ${item.title} [${item.releaseType.slice(0, 30)}]`, 'Telegram');
      return { success: true };
    } else {
      await logInfo(`Telegram notification skipped (No Chat ID or Bot not initialized)`, 'Telegram');
      return { success: false, error: 'Telegram bot not initialized or Chat ID missing in Settings.' };
    }
  } catch (error: any) {
    console.error('Error sending Telegram notification:', error);
    await logError(`Telegram notification failed: ${error.message}`, 'Telegram');
    return { success: false, error: error.message };
  }
}

export async function stopTelegramBot() {
  if (bot) {
    try {
      if (typeof bot.stopPolling === 'function') {
        await bot.stopPolling();
      }
      console.log('Telegram bot polling stopped.');
      logInfo('Telegram bot polling stopped.', 'Telegram');
    } catch (err: any) {
      console.warn('Error stopping Telegram bot:', err?.message || err);
    }
  }
}

export async function sendTestTelegramNotification() {
  const sampleItem: ReleaseItem = {
    id: 0,
    title: 'Gladiator II',
    year: 2024,
    type: 'Movie',
    provider: 'Download Availability Radar',
    sourceUrl: 'magnet:?xt=urn:btih:sample&dn=Gladiator+II',
    releaseType: '🟢 Download Available: 1080p WEB-DL (2.4 GB) • 1,450 Seeds',
    seeders: 1450,
    leechers: 320,
    poster: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=600&auto=format&fit=crop&q=80',
    metadataJson: null,
    createdAt: new Date().toISOString()
  };
  return await sendTelegramNotification(sampleItem);
}

export function processTelegramUpdate(update: any) {
  if (bot && typeof bot.processUpdate === 'function') {
    bot.processUpdate(update);
  }
}
