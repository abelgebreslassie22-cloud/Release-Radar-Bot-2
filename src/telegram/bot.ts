import TelegramBotModule from 'node-telegram-bot-api';
const TelegramBot = (typeof TelegramBotModule === 'function') 
  ? TelegramBotModule 
  : (TelegramBotModule as any).default;

import { getSettings } from '../services/settings';
import { ReleaseItem } from '../utils/mediaGrouper';
import { logInfo, logError, logSuccess, logWarning } from '../services/logger';
import { getGroupKey, normalizeMediaTitle } from '../utils/mediaGrouper';
import { extractEpisodeOrPack } from '../providers/downloadRadarProvider';
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

    const chatSearchResults = new Map<number, any[]>();
    const chatSearchActive = new Set<number>();

    const PERSISTENT_KEYBOARD = {
      keyboard: [
        [{ text: '📋 Menu' }]
      ],
      resize_keyboard: true,
      is_persistent: true
    };

    const lastMenuMessageId = new Map<number, number>();

    const sendInlineMenu = async (chatId: number, editMessageId?: number) => {
      try {
        const baseUrl = await getBaseUrl();
        const inlineKeyboard = [
          [
            { text: '🔍 Search & Add', callback_data: 'action_search_title' },
            { text: '📋 Watchlist', callback_data: 'menu_watchlist_0' }
          ],
          [
            { text: '🎬 Recent Releases', callback_data: 'menu_recent_0' },
            { text: '🔄 Scan Now', callback_data: 'action_force_scan' }
          ],
          [
            { text: '🍿 Main Dashboard', callback_data: 'action_main_menu' },
            { text: '🌐 Web App', url: baseUrl }
          ],
          [
            { text: '🗑️ Close Menu', callback_data: 'action_close_menu' }
          ]
        ];

        const text = '<b>Choose an action:</b>';
        const opts: any = {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        };

        if (editMessageId) {
          try {
            await bot.editMessageText(text, {
              chat_id: chatId,
              message_id: editMessageId,
              ...opts
            });
            lastMenuMessageId.set(chatId, editMessageId);
            return;
          } catch (e) {
            bot.deleteMessage(chatId, editMessageId).catch(() => {});
          }
        }

        const prevId = lastMenuMessageId.get(chatId);
        if (prevId) {
          bot.deleteMessage(chatId, prevId).catch(() => {});
        }

        const sentMsg = await bot.sendMessage(chatId, text, opts);
        if (sentMsg?.message_id) {
          lastMenuMessageId.set(chatId, sentMsg.message_id);
        }
      } catch (err) {
        console.error('Error sending inline menu:', err);
      }
    };

    const sendDashboard = async (chatId: number, messageId?: number) => {
      try {
        const baseUrl = await getBaseUrl();
        const wlCount = await db.select({ id: watchlist.id }).from(watchlist);
        const relCount = await db.select({ id: releases.id }).from(releases);
        
        const text = `<b>🍿 Release Radar Dashboard</b>

<b>System Status:</b> 🟢 Online & Polling
<b>Watchlist:</b> ${wlCount.length} Items Monitored
<b>Discovered Releases:</b> ${relCount.length} Total

<i>Tap an action button below:</i>`;
        
        const inlineKeyboard = [
          [
            { text: '🔍 Search & Add Title', callback_data: 'action_search_title' },
            { text: '📋 My Watchlist', callback_data: 'menu_watchlist_0' }
          ],
          [
            { text: '🎬 Recent Releases', callback_data: 'menu_recent_0' },
            { text: '🔄 Force Scan Now', callback_data: 'action_force_scan' }
          ],
          [
            { text: '🌐 Open Full Web App', url: baseUrl }
          ],
          [
            { text: '🔙 Menu', callback_data: 'action_choose_menu' },
            { text: '🗑️ Close', callback_data: 'action_close_menu' }
          ]
        ];

        const opts: any = {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        };

        if (messageId) {
          try {
            await bot.editMessageText(text, {
              chat_id: chatId,
              message_id: messageId,
              ...opts
            });
            return;
          } catch (e) {
            bot.deleteMessage(chatId, messageId).catch(() => {});
          }
        }
        await bot.sendMessage(chatId, text, opts);
      } catch (err) {
        console.error("Dashboard error:", err);
      }
    };

    const handleSearchQuery = async (chatId: number, queryText: string) => {
      chatSearchActive.delete(chatId);
      const query = queryText.trim();
      if (!query) return;

      const searchingMsg = await bot.sendMessage(chatId, `🔍 Searching TMDB for "<b>${escapeHtml(query)}</b>"...`, { parse_mode: 'HTML' });

      try {
        const results = await searchMedia(query);
        if (results.length === 0) {
          bot.deleteMessage(chatId, searchingMsg.message_id).catch(() => {});
          return bot.sendMessage(chatId, `❌ No movies or TV series found for "<b>${escapeHtml(query)}</b>".`, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔍 Try Another Search', callback_data: 'action_search_title' }],
                [{ text: '🔙 Menu', callback_data: 'action_choose_menu' }, { text: '🗑️ Close', callback_data: 'action_close_menu' }]
              ]
            }
          });
        }

        const topResults = results.slice(0, 4);
        chatSearchResults.set(chatId, topResults);

        let listText = `🔍 <b>Select a Title to Track:</b>\n\n`;
        const buttons: any[] = [];

        topResults.forEach((r, idx) => {
          const isTV = r.type === 'Series';
          const icon = isTV ? '📺' : '🎬';
          const star = r.voteAverage ? ` • ⭐ ${r.voteAverage}` : '';
          const snippet = r.overview ? `\n   <i>${escapeHtml(r.overview.slice(0, 95))}...</i>` : '';
          listText += `${idx + 1}. ${icon} <b>${escapeHtml(r.title)}</b> (${r.year}) [${r.type}]${star}${snippet}\n\n`;

          buttons.push([
            {
              text: `➕ Add: ${r.title.slice(0, 22)} (${r.year})`,
              callback_data: `add_tmdb_${idx}`
            }
          ]);
        });

        buttons.push([
          { text: '🔍 Search Another', callback_data: 'action_search_title' },
          { text: '🔙 Menu', callback_data: 'action_choose_menu' },
          { text: '🗑️ Close', callback_data: 'action_close_menu' }
        ]);

        bot.deleteMessage(chatId, searchingMsg.message_id).catch(() => {});
        await bot.sendMessage(chatId, listText, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons }
        });
      } catch (err: any) {
        bot.deleteMessage(chatId, searchingMsg.message_id).catch(() => {});
        bot.sendMessage(chatId, `❌ Search error: ${err.message}`, { parse_mode: 'HTML' });
      }
    };

    const handleWatchlistView = async (chatId: number, page: number = 0, messageId?: number) => {
      const itemsPerPage = 4;
      const items = await db.select().from(watchlist).orderBy(desc(watchlist.createdAt));
      const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
      const pagedItems = items.slice(page * itemsPerPage, (page + 1) * itemsPerPage);
      const baseUrl = await getBaseUrl();

      if (items.length === 0) {
        if (messageId) bot.deleteMessage(chatId, messageId).catch(() => {});
        bot.sendMessage(chatId, '📋 <b>Your Watchlist is currently empty.</b>\n\nTap "🔍 Search & Add" below to find and track your favorite movies or shows!', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 Search & Add Title', callback_data: 'action_search_title' }],
              [{ text: '🌐 Open Web Watchlist', url: `${baseUrl}/#/watchlist` }],
              [{ text: '🔙 Menu', callback_data: 'action_choose_menu' }, { text: '🗑️ Close', callback_data: 'action_close_menu' }]
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
        const icon = item.type === 'Series' ? '📺' : '🎬';
        listText += `${num}. ${icon} <b>${escapeHtml(item.title)}</b> (${item.year}) [<i>${escapeHtml(item.type)}</i>]\n   👉 <a href="${baseUrl}/#/media/${groupKey}">View Status Page</a>\n\n`;
        buttons.push([
          { text: `❌ Remove "${item.title.slice(0, 20)}"`, callback_data: `delete_wl_${item.id}` }
        ]);
      });

      const navRow: any[] = [];
      if (page > 0) navRow.push({ text: '⬅️ Prev', callback_data: `menu_watchlist_${page - 1}` });
      if (page < totalPages - 1) navRow.push({ text: 'Next ➡️', callback_data: `menu_watchlist_${page + 1}` });
      if (navRow.length > 0) buttons.push(navRow);
      
      buttons.push([
        { text: '🔍 Add New Title', callback_data: 'action_search_title' },
        { text: '🔙 Menu', callback_data: 'action_choose_menu' },
        { text: '🗑️ Close', callback_data: 'action_close_menu' }
      ]);

      if (messageId) bot.deleteMessage(chatId, messageId).catch(() => {});
      bot.sendMessage(chatId, listText, {
        parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
    };

    const handleRecentReleasesView = async (chatId: number, page: number = 0, messageId?: number) => {
      const itemsPerPage = 4;
      const items = await db.select().from(releases).orderBy(desc(releases.createdAt)).limit(20);
      const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
      const pagedItems = items.slice(page * itemsPerPage, (page + 1) * itemsPerPage);
      const baseUrl = await getBaseUrl();

      if (items.length === 0) {
        if (messageId) bot.deleteMessage(chatId, messageId).catch(() => {});
        bot.sendMessage(chatId, '🎬 <b>No discovered releases yet.</b>\n\nTap "🔄 Force Scan Now" to check download indexers.', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Force Scan Now', callback_data: 'action_force_scan' }],
              [{ text: '🔙 Menu', callback_data: 'action_choose_menu' }, { text: '🗑️ Close', callback_data: 'action_close_menu' }]
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
        
        buttons.push([
          { text: `🍿 View Qualities: ${item.title.slice(0, 24)}`, url: `${baseUrl}/#/media/${groupKey}` }
        ]);
      });

      const navRow: any[] = [];
      if (page > 0) navRow.push({ text: '⬅️ Prev', callback_data: `menu_recent_${page - 1}` });
      if (page < totalPages - 1) navRow.push({ text: 'Next ➡️', callback_data: `menu_recent_${page + 1}` });
      if (navRow.length > 0) buttons.push(navRow);
      
      buttons.push([
        { text: '🔙 Menu', callback_data: 'action_choose_menu' },
        { text: '🗑️ Close', callback_data: 'action_close_menu' }
      ]);

      if (messageId) bot.deleteMessage(chatId, messageId).catch(() => {});
      bot.sendMessage(chatId, relText, {
        parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
    };

    const handleForceScan = async (chatId: number, messageId?: number) => {
      if (messageId) bot.deleteMessage(chatId, messageId).catch(() => {});
      await bot.sendMessage(chatId, '<b>🔄 Force Scan Initiated...</b>\n\nChecking scene release indexers and TMDB digital radar for your tracked titles...', {
        parse_mode: 'HTML'
      });
      try {
        await runScan();
        bot.sendMessage(chatId, '✅ <b>Scan Complete!</b> Check above for any newly discovered download or episode alerts.', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 My Watchlist', callback_data: 'menu_watchlist_0' }],
              [{ text: '🎬 Recent Releases', callback_data: 'menu_recent_0' }],
              [{ text: '🔙 Menu', callback_data: 'action_choose_menu' }, { text: '🗑️ Close', callback_data: 'action_close_menu' }]
            ]
          }
        });
      } catch (e: any) {
        bot.sendMessage(chatId, `❌ <b>Scan Error:</b> ${e.message}`, { parse_mode: 'HTML' });
      }
    };

    // Welcome handler
    bot.onText(/\/start|\/menu/, async (msg: any) => {
      const chatId = msg.chat.id;
      bot.sendMessage(chatId, '✅ <b>Release Radar Connected!</b>\n\nTap <b>📋 Menu</b> below anytime to access controls.', {
        parse_mode: 'HTML',
        reply_markup: PERSISTENT_KEYBOARD
      }).then(() => {
        sendInlineMenu(chatId);
      });
    });

    // Handle persistent keyboard button clicks & plain text input
    bot.on('message', async (msg: any) => {
      if (!msg.text) return;
      const text = msg.text.trim();
      const chatId = msg.chat.id;

      // Check persistent bottom keyboard button
      if (text === '📋 Menu' || text === 'Menu') {
        await sendInlineMenu(chatId);
      } else if (text === '✖️ Close Menu' || text === 'Close Menu') {
        const prevId = lastMenuMessageId.get(chatId);
        if (prevId) {
          bot.deleteMessage(chatId, prevId).catch(() => {});
        }
      } else if (text === '🔍 Search & Add') {
        chatSearchActive.add(chatId);
        bot.sendMessage(chatId, '🔍 <b>Search & Add to Radar</b>\n\nPlease type the title of the movie or TV show below:\n<i>(e.g., Severance, Slow Horses, Gladiator 2...)</i>', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Menu', callback_data: 'action_choose_menu' }, { text: '🗑️ Close', callback_data: 'action_close_menu' }]
            ]
          }
        });
      } else if (text === '📋 Watchlist') {
        await handleWatchlistView(chatId);
      } else if (text === '🎬 Recent Releases') {
        await handleRecentReleasesView(chatId);
      } else if (text === '🔄 Scan Now') {
        await handleForceScan(chatId);
      } else if (text === '🍿 Main Dashboard') {
        await sendDashboard(chatId);
      } else if (text === '🌐 Web App') {
        const baseUrl = await getBaseUrl();
        bot.sendMessage(chatId, '🌐 <b>Open Web Application:</b>', {
          reply_markup: {
            inline_keyboard: [[{ text: '🍿 Open Web App', url: baseUrl }]]
          }
        });
      } else if (text === '/start' || text === '/menu') {
        // Handled by onText
      } else {
        // Any regular text typed by the admin is treated as a real-time title search!
        await handleSearchQuery(chatId, text);
      }
    });

    // CRITICAL: Callback query handler for all inline buttons
    bot.on('callback_query', async (query: any) => {
      try {
        await bot.answerCallbackQuery(query.id).catch(() => {});
      } catch (e) {}

      const chatId = query.message?.chat?.id;
      const messageId = query.message?.message_id;
      const data = query.data;

      if (!chatId || !data) return;

      if (data === 'action_choose_menu') {
        await sendInlineMenu(chatId, messageId);
      }
      else if (data === 'action_close_menu') {
        if (messageId) {
          bot.deleteMessage(chatId, messageId).catch(() => {});
        }
      }
      else if (data === 'action_main_menu') {
        await sendDashboard(chatId, messageId);
      } 
      else if (data === 'action_search_title') {
        chatSearchActive.add(chatId);
        if (messageId) bot.deleteMessage(chatId, messageId).catch(() => {});
        bot.sendMessage(chatId, '🔍 <b>Search & Add to Radar</b>\n\nPlease type the title of the movie or TV show below:\n<i>(e.g., Severance, Slow Horses, Gladiator 2, Dune...)</i>', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Menu', callback_data: 'action_choose_menu' }, { text: '🗑️ Close', callback_data: 'action_close_menu' }]
            ]
          }
        });
      }
      else if (data === 'action_cancel_search') {
        chatSearchActive.delete(chatId);
        if (messageId) {
          bot.deleteMessage(chatId, messageId).catch(() => {});
        }
        await sendInlineMenu(chatId);
      }
      else if (data.startsWith('add_tmdb_')) {
        const idx = parseInt(data.replace('add_tmdb_', ''), 10);
        const results = chatSearchResults.get(chatId) || [];
        const item = results[idx];

        if (!item) {
          return bot.sendMessage(chatId, '❌ Search session expired. Please tap "🔍 Search & Add" again.', {
            reply_markup: {
              inline_keyboard: [[{ text: '🔍 Search & Add', callback_data: 'action_search_title' }]]
            }
          });
        }

        try {
          // Save item to database
          await db.insert(watchlist).values({
            title: item.title,
            year: item.year,
            type: item.type,
          }).onConflictDoNothing();

          if (messageId) bot.deleteMessage(chatId, messageId).catch(() => {});

          const isTV = item.type === 'Series';
          const icon = isTV ? '📺' : '🎬';

          await bot.sendMessage(chatId, `✅ <b>Added to Radar!</b>\n\n${icon} <b>${escapeHtml(item.title)}</b> (${item.year}) [<i>${escapeHtml(item.type)}</i>]\n\n🟢 Radar will now monitor scene release indexers for this specific title.\n🔄 Checking download indexers now...`, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 My Watchlist', callback_data: 'menu_watchlist_0' }],
                [{ text: '🔍 Search Another Title', callback_data: 'action_search_title' }],
                [{ text: '🔙 Menu', callback_data: 'action_choose_menu' }, { text: '🗑️ Close', callback_data: 'action_close_menu' }]
              ]
            }
          });

          // Trigger immediate scan for this new addition
          runScan().catch(() => {});
        } catch (addErr: any) {
          bot.sendMessage(chatId, `❌ Failed to add title: ${addErr.message}`, { parse_mode: 'HTML' });
        }
      }
      else if (data === 'action_force_scan') {
        await handleForceScan(chatId, messageId);
      }
      else if (data.startsWith('delete_wl_')) {
        const wlId = parseInt(data.replace('delete_wl_', ''), 10);
        try {
          const item = await db.select().from(watchlist).where(eq(watchlist.id, wlId)).limit(1);
          if (item.length > 0) {
            await db.delete(watchlist).where(eq(watchlist.id, wlId));
            bot.sendMessage(chatId, `🗑️ Removed "<b>${escapeHtml(item[0].title)}</b>" from your Watchlist.`, { parse_mode: 'HTML' });
            await handleWatchlistView(chatId, 0, messageId);
          }
        } catch (delErr: any) {
          bot.sendMessage(chatId, `❌ Failed to remove item: ${delErr.message}`, { parse_mode: 'HTML' });
        }
      }
      else if (data.startsWith('menu_watchlist_')) {
        const page = parseInt(data.split('_')[2]) || 0;
        await handleWatchlistView(chatId, page, messageId);
      }
      else if (data.startsWith('menu_recent_')) {
        const page = parseInt(data.split('_')[2]) || 0;
        await handleRecentReleasesView(chatId, page, messageId);
      }
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
      const canonicalTitle = normalizeMediaTitle(item.title);
      const groupKey = getGroupKey(item.title, item.type);
      const baseUrl = await getBaseUrl(settings);
      const detailUrl = `${baseUrl}/#/media/${groupKey}`;

      const yearSuffix = item.year ? ` (${item.year})` : '';
      const isTV = item.type?.toLowerCase() === 'series' || item.type?.toLowerCase() === 'anime';
      const isDownload = item.releaseType.includes('Download Available') || item.sourceUrl?.startsWith('magnet:');
      const epCode = extractEpisodeOrPack(item.title) || extractEpisodeOrPack(item.releaseType);

      let headerTitle: string;
      let bodyText: string;

      if (isTV && epCode) {
        headerTitle = `🔥 <b>NEW EPISODE AVAILABLE!</b>`;
        bodyText = `📺 <b>Show:</b> ${escapeHtml(canonicalTitle)}${yearSuffix}
⚡ <b>Episode:</b> <code>${escapeHtml(epCode)}</code>
🟢 <b>Status:</b> Ready to download on the web app

🍿 <b>All Available Qualities (4K, 1080p, 720p):</b>
<a href="${detailUrl}">${detailUrl}</a>`;
      } else if (isTV) {
        headerTitle = `🔥 <b>NEW SHOW EPISODE AVAILABLE!</b>`;
        bodyText = `📺 <b>Show:</b> ${escapeHtml(canonicalTitle)}${yearSuffix}
🟢 <b>Status:</b> Ready to download on the web app

🍿 <b>All Available Qualities & Episodes:</b>
<a href="${detailUrl}">${detailUrl}</a>`;
      } else if (isDownload) {
        headerTitle = `🎬 <b>NEW MOVIE NOW AVAILABLE!</b>`;
        bodyText = `🍿 <b>Movie:</b> ${escapeHtml(canonicalTitle)}${yearSuffix}
🟢 <b>Status:</b> Ready to download on the web app

👉 <b>All Available Qualities (4K, 1080p, 720p):</b>
<a href="${detailUrl}">${detailUrl}</a>`;
      } else {
        headerTitle = `🎬 <b>Premiere & Release Alert!</b>`;
        bodyText = `<b>Title:</b> ${escapeHtml(canonicalTitle)}${yearSuffix}
<b>Status:</b> ${escapeHtml(item.releaseType)}

👉 <a href="${detailUrl}">${detailUrl}</a>`;
      }

      const caption = `${headerTitle}\n\n${bodyText}`;

      // Clean interactive buttons: No torrent magnet sent on telegram, only direct web app button & quick actions
      const inlineKeyboard: any[] = [
        [{ text: '🍿 Open Qualities & Download', url: detailUrl }],
        [
          { text: '📋 My Watchlist', callback_data: 'menu_watchlist_0' },
          { text: '🔄 Scan Now', callback_data: 'action_force_scan' }
        ]
      ];

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
