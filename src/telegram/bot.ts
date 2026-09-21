import TelegramBotModule from 'node-telegram-bot-api';
const TelegramBot = (typeof TelegramBotModule === 'function') 
  ? TelegramBotModule 
  : (TelegramBotModule as any).default;

import { getSettings } from '../services/settings';
import { ReleaseItem } from '../utils/mediaGrouper';
import { logInfo, logError, logSuccess } from '../services/logger';
import { getGroupKey } from '../utils/mediaGrouper';
import { db } from '../database/db';
import { watchlist, releases } from '../database/schema';
import { desc, eq } from 'drizzle-orm';
import { runScan } from '../services/scanner';

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
  if (appUrl && appUrl.trim()) {
    return appUrl.trim().replace(/\/$/, '');
  }
  if (process.env.RENDER_EXTERNAL_URL && process.env.RENDER_EXTERNAL_URL.trim()) {
    return process.env.RENDER_EXTERNAL_URL.trim().replace(/\/$/, '');
  }
  const envUrl = process.env.APP_URL;
  if (envUrl && envUrl.trim() && !envUrl.includes('ais-dev-') && !envUrl.includes('ais-pre-') && !envUrl.includes('MY_APP_URL')) {
    return envUrl.trim().replace(/\/$/, '');
  }
  return 'https://release-radar-bot.onrender.com';
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

    const appUrl = appUrlString || process.env.APP_URL;
    // If we have an APP_URL and we are in production, prefer Webhook
    const preferWebhook = !!appUrl && !appUrl.includes('localhost') && !appUrl.includes('ais-dev-') && !appUrl.includes('ais-pre-');
    const enablePolling = process.env.DISABLE_TELEGRAM_POLLING !== 'true' && !preferWebhook;

    if (preferWebhook) {
       bot = new TelegramBot(cleanToken, { webHook: true });
       const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/telegram/webhook`;
       bot.setWebHook(webhookUrl).then(() => {
         console.log(`Telegram Webhook set to ${webhookUrl}`);
         logInfo(`Telegram Webhook set to ${webhookUrl} (@${botUser.username})`, 'Telegram');
       }).catch((err: any) => {
         console.error('Failed to set Telegram webhook:', err);
       });
    } else {
       bot = new TelegramBot(cleanToken, { polling: enablePolling });
    }

    if (enablePolling && !preferWebhook) {
      bot.on('polling_error', (error: any) => {
        const errMsg = error?.message || String(error);
        if (errMsg.includes('409 Conflict')) {
          console.warn('Telegram 409 Conflict: Another bot instance is currently running. Stopping local polling to prevent conflicts.');
          logInfo('Telegram polling stopped locally because another instance is active.', 'Telegram');
          if (bot && typeof bot.stopPolling === 'function') {
            bot.stopPolling().catch(() => {});
          }
        }
      });
    }
    
    try {
      bot.deleteMyCommands().catch(() => {});
    } catch (e) {}

      const sendDashboard = async (chatId: number, messageId?: number) => {
        try {
          const baseUrl = await getBaseUrl();
          const wlCount = await db.select({ id: watchlist.id }).from(watchlist);
          const text = `<b>🍿 Release Radar Dashboard</b>\n\n<b>System Status:</b> 🟢 Online\n<b>Tracking:</b> ${wlCount.length} Watchlist Items\n\n<i>What would you like to do?</i>`;
          
          const inlineKeyboard = [
            [
              { text: '📋 My Watchlist', callback_data: 'menu_watchlist_0' },
              { text: '🎬 Recent Releases', callback_data: 'menu_recent_0' }
            ],
            [
              { text: '🔄 Force Scan', callback_data: 'action_force_scan' }
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

      bot.onText(/\/start/, (msg: any) => {
        bot.sendMessage(msg.chat.id, '✅ <b>Welcome!</b> The menu button is now pinned below.', {
          parse_mode: 'HTML',
          reply_markup: {
            keyboard: [[{ text: '📋 Menu' }]],
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

      bot.on('message', (msg: any) => {
        if (msg.text === '📋 Menu') {
          sendDashboard(msg.chat.id);
        }
      });

      bot.on('callback_query', async (query: any) => {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;

        if (data === 'action_main_menu') {
          await sendDashboard(chatId, messageId);
        } 
        else if (data === 'action_force_scan') {
          bot.answerCallbackQuery(query.id, { text: '🔄 Scanning providers...' }).catch(() => {});
          bot.deleteMessage(chatId, messageId).catch(() => {});
          await bot.sendMessage(chatId, '<b>🔄 Force Scan Initiated...</b>\n\nChecking providers for new releases. You will receive notifications if any matches are found.', {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'action_main_menu' }]]
            }
          });
          try {
            await runScan();
            bot.sendMessage(chatId, '✅ <b>Scan Complete!</b> Check above for any new notifications.', { parse_mode: 'HTML' });
          } catch(e) {
            bot.sendMessage(chatId, '❌ <b>Scan Failed!</b> Check logs.', { parse_mode: 'HTML' });
          }
        }
        else if (data.startsWith('menu_watchlist_')) {
          const page = parseInt(data.split('_')[2]) || 0;
          const itemsPerPage = 5;
          const items = await db.select().from(watchlist).orderBy(desc(watchlist.createdAt));
          const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
          const pagedItems = items.slice(page * itemsPerPage, (page + 1) * itemsPerPage);
          const baseUrl = await getBaseUrl();

          if (items.length === 0) {
            bot.deleteMessage(chatId, messageId).catch(() => {});
            bot.sendMessage(chatId, '📋 <b>Your Watchlist is currently empty.</b>\n\nAdd movies or series in the web app!', {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '➕ Manage Watchlist', url: `${baseUrl}/#/watchlist` }],
                  [{ text: '🔙 Back to Menu', callback_data: 'action_main_menu' }]
                ]
              }
            });
            return;
          }

          let listText = `<b>📋 Your Watchlist (Page ${page + 1} of ${totalPages}):</b>\n\n`;
          pagedItems.forEach((item, idx) => {
            const num = (page * itemsPerPage) + idx + 1;
            const groupKey = getGroupKey(item.title, item.type);
            listText += `${num}. <b>${escapeHtml(item.title)}</b> (${item.year}) [<i>${escapeHtml(item.type)}</i>]\n   👉 <a href="${baseUrl}/#/media/${groupKey}">View Details</a>\n\n`;
          });

          const buttons: any[] = [];
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
          const itemsPerPage = 5;
          const items = await db.select().from(releases).orderBy(desc(releases.createdAt)).limit(20);
          const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
          const pagedItems = items.slice(page * itemsPerPage, (page + 1) * itemsPerPage);
          const baseUrl = await getBaseUrl();

          if (items.length === 0) {
            bot.deleteMessage(chatId, messageId).catch(() => {});
            bot.sendMessage(chatId, '🎬 <b>No discovered releases yet.</b>', {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔙 Back to Menu', callback_data: 'action_main_menu' }]
                ]
              }
            });
            return;
          }

          let relText = `<b>🎬 Recent Releases (Page ${page + 1} of ${totalPages}):</b>\n\n`;
          pagedItems.forEach((item, idx) => {
            const num = (page * itemsPerPage) + idx + 1;
            const groupKey = getGroupKey(item.title, item.type);
            relText += `${num}. <b>${escapeHtml(item.title)}</b> (${item.year}) - <i>${escapeHtml(item.releaseType)}</i>\n   👉 <a href="${baseUrl}/#/media/${groupKey}">View Details</a>\n\n`;
          });

          const buttons: any[] = [];
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
        
        bot.answerCallbackQuery(query.id).catch(() => {});
      });

      bot.onText(/\/ping/, (msg: any) => {
        bot?.sendMessage(msg.chat.id, '<b>Pong!</b> ⚡ Release Radar Bot is online and active.', { parse_mode: 'HTML' });
      });

      console.log(`Telegram bot initialized (@${botUser.username}).`);
      logSuccess(`Telegram bot started and listening (@${botUser.username})`, 'Telegram');
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
      const caption = `<b>🎬 Premiere & Release Alert!</b>

<b>Title:</b> ${escapeHtml(item.title)}${yearSuffix}
<b>Type:</b> ${escapeHtml(item.type)}
<b>Status:</b> ${escapeHtml(item.releaseType)}
<b>Provider:</b> ${escapeHtml(item.provider || 'TMDB Radar')}

🍿 <b>View Details & Streaming Options:</b>
<a href="${detailUrl}">${detailUrl}</a>`;

      const options: any = {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🍿 Open Detailed Release Page', url: detailUrl }
            ]
          ]
        }
      };

      let sent = false;
      if (item.poster) {
        if (item.poster.startsWith('data:image/svg')) {
          // Telegram does not support SVG images directly, fallback to text
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
            // Graceful fallback to text notification
            sent = false;
          }
        }
      }

      if (!sent) {
        await bot.sendMessage(targetChatId, caption, options);
      }

      console.log('Telegram notification sent successfully.');
      await logSuccess(`Telegram notification sent with detailed link: ${item.title}`, 'Telegram');
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
    title: 'Project Hail Mary',
    year: 2026,
    type: 'Movie',
    provider: 'RSS Feed',
    sourceUrl: 'https://example.com/release/project-hail-mary-2026',
    releaseType: '4K WEB-DL',
    seeders: 0,
    leechers: 0,
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

