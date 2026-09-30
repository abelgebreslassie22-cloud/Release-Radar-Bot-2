import TelegramBotModule from 'node-telegram-bot-api';
const TelegramBot = (typeof TelegramBotModule === 'function') 
  ? TelegramBotModule 
  : (TelegramBotModule as any).default;

import { getSettings, updateSettings } from '../services/settings';
import { ReleaseItem } from '../utils/mediaGrouper';
import { logInfo, logError, logSuccess, logWarning } from '../services/logger';
import { getGroupKey, normalizeMediaTitle } from '../utils/mediaGrouper';
import { extractEpisodeOrPack, detectSeasonPack } from '../providers/downloadRadarProvider';
import { db } from '../database/db';
import { watchlist, releases } from '../database/schema';
import { desc, eq } from 'drizzle-orm';
import { runScan, syncWatchlistItemImmediately } from '../services/scanner';
import { searchMedia } from '../metadata/tmdb';

let bot: any = null;
const activeAdminChatIds = new Set<string>();

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

  const dbSettings = await getSettings();
  const token = customToken || process.env.TELEGRAM_BOT_TOKEN || dbSettings?.telegramBotToken;
  if (!token || !token.trim()) {
    return { success: false, error: 'No Telegram bot token provided in environment or settings' };
  }

  const cleanToken = token.trim();

  // If a bot is already running, stop polling first
  await stopTelegramBot();

  try {
    // Validate token first by fetching bot info
    const testRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
    const testData: any = await testRes.json();
    if (!testData.ok) {
      const errDescription = testData.description || 'Invalid Telegram Bot Token';
      console.warn(`Telegram Token validation failed: ${errDescription}`);
      await logWarning(`Telegram bot token validation failed: ${errDescription}`, 'Telegram');
      return { success: false, error: errDescription };
    }
    const botUser = testData.result;
    process.env.TELEGRAM_BOT_TOKEN = cleanToken;
    if (dbSettings && dbSettings.telegramBotToken !== cleanToken) {
      await updateSettings({ telegramBotToken: cleanToken });
    }

    // Clear old webhook to guarantee reliable Long Polling
    try {
      await fetch(`https://api.telegram.org/bot${cleanToken}/deleteWebhook?drop_pending_updates=false`);
      console.log('Cleared Telegram webhook for reliable polling.');
    } catch (whErr) {}

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
      await bot.deleteMyCommands();
      console.log('Cleared all Telegram bot commands. Interface is strictly button-driven.');
    } catch (e) {}

    const chatSearchResults = new Map<number, any[]>();
    const chatSearchActive = new Set<number>();

    const ensureAdminChatId = async (chatId: number | string) => {
      if (!chatId) return;
      const strId = String(chatId).trim();
      activeAdminChatIds.add(strId);
      try {
        const s = await getSettings();
        if (!s?.telegramChatId || s.telegramChatId.trim() !== strId) {
          await updateSettings({ telegramChatId: strId });
          console.log(`Auto-registered Telegram Chat ID ${strId} for notifications.`);
        }
      } catch (e) {}
    };

    const PERSISTENT_KEYBOARD = {
      keyboard: [
        [{ text: '📋 Radar Menu' }]
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
            { text: '➕ Add to Watchlist', callback_data: 'action_search_title' },
            { text: '📋 My Watchlist', callback_data: 'menu_watchlist_0' }
          ],
          [
            { text: '🎬 Recent Releases', callback_data: 'menu_recent_0' },
            { text: '🔄 Scan Indexers Now', callback_data: 'action_force_scan' }
          ],
          [
            { text: '🍿 Main Dashboard', callback_data: 'action_main_menu' },
            { text: '🌐 Open Web App', url: baseUrl }
          ],
          [
            { text: '🗑️ Close Menu', callback_data: 'action_close_menu' }
          ]
        ];

        const text = '<b>🍿 Release Radar Control Center</b>\n\nChoose an action using the buttons below:';
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

    // Initial welcome / entry handler (sends the clean inline button dashboard)
    bot.onText(/\/start/, async (msg: any) => {
      const chatId = msg.chat.id;
      await ensureAdminChatId(chatId);
      await sendInlineMenu(chatId);
    });

    // Handle persistent keyboard button clicks & plain text title searches
    bot.on('message', async (msg: any) => {
      if (!msg.text) return;
      const text = msg.text.trim();
      const chatId = msg.chat.id;
      await ensureAdminChatId(chatId);

      // Handle persistent button or any menu request
      if (text === '📋 Radar Menu' || text === '📋 Menu' || text === 'Menu' || text.startsWith('/')) {
        await sendInlineMenu(chatId);
      } else if (text === '✖️ Close Menu' || text === 'Close Menu') {
        const prevId = lastMenuMessageId.get(chatId);
        if (prevId) {
          bot.deleteMessage(chatId, prevId).catch(() => {});
        }
      } else {
        // Any text typed by the admin is treated as an instant title search to add to watchlist!
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
      await ensureAdminChatId(chatId);

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
        bot.sendMessage(chatId, '🔍 <b>Add to Watchlist</b>\n\nPlease type the name of the movie or TV show to search and track:\n<i>(e.g., Ted Lasso, Severance, Gladiator 2, Dune...)</i>', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Back to Menu', callback_data: 'action_choose_menu' }, { text: '🗑️ Close', callback_data: 'action_close_menu' }]
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
          if (messageId) bot.deleteMessage(chatId, messageId).catch(() => {});

          const isTV = item.type === 'Series';
          const icon = isTV ? '📺' : '🎬';

          const statusMsg = await bot.sendMessage(chatId, `⏳ <b>Adding to Radar & Searching...</b>\n\n${icon} <b>${escapeHtml(item.title)}</b> (${item.year})\n<i>Checking scene release indexers for all existing qualities & seasons right now...</i>`, {
            parse_mode: 'HTML'
          });

          // 1. Save item to watchlist
          await db.insert(watchlist).values({
            title: item.title,
            year: item.year,
            type: item.type,
          }).onConflictDoNothing();

          // 2. Perform immediate search right there, find all qualities, and populate post card with ZERO notifications
          const syncResult = await syncWatchlistItemImmediately({
            title: item.title,
            year: item.year,
            type: item.type
          });

          if (statusMsg?.message_id) {
            bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
          }

          let syncSummary = '';
          if (syncResult.count > 0) {
            syncSummary = isTV
              ? `\n\n🟢 <b>Found ${syncResult.count} existing download releases / packs.</b>\n🔕 <i>Initial sync complete — all existing seasons indexed with 0 notification alerts.</i>\n\n🔔 <b>Radar will alert you the moment a brand-new episode drops to be downloaded!</b>`
              : `\n\n🟢 <b>Found ${syncResult.count} existing qualities (${syncResult.topSeeds} seeds).</b>\n🔕 <i>Initial sync complete — no notification alert spam.</i>`;
          } else {
            syncSummary = `\n\n⏳ <b>Currently monitoring release schedule.</b>\n🔔 <b>Radar will alert you the moment it drops to be downloaded!</b>`;
          }

          await bot.sendMessage(chatId, `✅ <b>Added to Radar!</b>\n\n${icon} <b>${escapeHtml(item.title)}</b> (${item.year}) [<i>${escapeHtml(item.type)}</i>]${syncSummary}`, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 My Watchlist', callback_data: 'menu_watchlist_0' }],
                [{ text: '➕ Add Another Title', callback_data: 'action_search_title' }],
                [{ text: '🔙 Main Menu', callback_data: 'action_choose_menu' }, { text: '🗑️ Close', callback_data: 'action_close_menu' }]
              ]
            }
          });
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
            // Also remove the corresponding card
            await db.delete(releases).where(eq(releases.title, item[0].title));
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
    const token = (process.env.TELEGRAM_BOT_TOKEN || settings?.telegramBotToken || '').trim();

    const targetChatIds = new Set<string>();
    if (settings?.telegramChatId?.trim()) targetChatIds.add(settings.telegramChatId.trim());
    if (process.env.TELEGRAM_CHAT_ID?.trim()) targetChatIds.add(process.env.TELEGRAM_CHAT_ID.trim());
    for (const id of activeAdminChatIds) targetChatIds.add(id.trim());

    if (!token) {
      await logWarning('Telegram notification skipped: Bot Token is missing in Settings and environment.', 'Telegram');
      return { success: false, error: 'Telegram Bot Token missing' };
    }
    if (targetChatIds.size === 0) {
      await logWarning('Telegram notification skipped: No Telegram Chat ID registered yet. Please message your bot on Telegram or tap /start.', 'Telegram');
      return { success: false, error: 'Telegram Chat ID missing' };
    }

    const canonicalTitle = normalizeMediaTitle(item.title);
    const groupKey = getGroupKey(item.title, item.type);
    const baseUrl = await getBaseUrl(settings);
    const detailUrl = `${baseUrl}/#/media/${groupKey}`;

    const yearSuffix = item.year ? ` (${item.year})` : '';
    const isTV = item.type?.toLowerCase() === 'series' || item.type?.toLowerCase() === 'anime';
    const isDownload = item.releaseType.includes('Download Available') || item.sourceUrl?.startsWith('magnet:');
    const packInfo = detectSeasonPack(item.title);
    const isSeasonPack = packInfo.isPack || item.releaseType.includes('📦') || item.releaseType.includes('Pack');
    const epCode = extractEpisodeOrPack(item.title) || extractEpisodeOrPack(item.releaseType);
    const isStreaming = item.provider?.includes('TVMaze') || item.provider?.includes('TMDB') || item.releaseType.includes('Stream') || item.releaseType.includes('Airing');

    let headerTitle: string;
    let bodyText: string;

    if (isTV && isSeasonPack) {
      const packLabel = packInfo.label || epCode || 'Complete Season Pack';
      headerTitle = `📦 <b>FULL SEASON PACK AVAILABLE!</b>`;
      bodyText = `📺 <b>Show:</b> ${escapeHtml(canonicalTitle)}${yearSuffix}
📦 <b>Pack:</b> <code>${escapeHtml(packLabel)}</code>
🟢 <b>Status:</b> Whole Season Ready to Download on Web App

🍿 <b>All Available Qualities (4K, 1080p, 720p):</b>
<a href="${detailUrl}">${detailUrl}</a>`;
    } else if (isTV && epCode) {
      if (isStreaming) {
        headerTitle = `🎉 <b>NEW EPISODE RELEASED & STREAMING!</b>`;
        bodyText = `📺 <b>Show:</b> ${escapeHtml(canonicalTitle)}${yearSuffix}
⚡ <b>Episode:</b> <code>${escapeHtml(epCode)}</code>
📡 <b>Platform:</b> ${escapeHtml(item.provider || 'Streaming Network')}
🟢 <b>Status:</b> ${escapeHtml(item.releaseType)}

🍿 <b>Web App & Direct Download:</b>
<a href="${detailUrl}">${detailUrl}</a>`;
      } else {
        headerTitle = `🔥 <b>NEW EPISODE AVAILABLE!</b>`;
        bodyText = `📺 <b>Show:</b> ${escapeHtml(canonicalTitle)}${yearSuffix}
⚡ <b>Episode:</b> <code>${escapeHtml(epCode)}</code>
🟢 <b>Status:</b> Ready to download on the web app

🍿 <b>All Available Qualities (4K, 1080p, 720p):</b>
<a href="${detailUrl}">${detailUrl}</a>`;
      }
    } else if (isTV) {
      headerTitle = `🔥 <b>NEW EPISODE AVAILABLE!</b>`;
      bodyText = `📺 <b>Show:</b> ${escapeHtml(canonicalTitle)}${yearSuffix}
🟢 <b>Status:</b> ${escapeHtml(item.releaseType)}

🍿 <b>All Available Qualities & Episodes:</b>
<a href="${detailUrl}">${detailUrl}</a>`;
    } else if (isDownload) {
      headerTitle = `🎬 <b>NEW MOVIE NOW AVAILABLE!</b>`;
      bodyText = `🍿 <b>Movie:</b> ${escapeHtml(canonicalTitle)}${yearSuffix}
🟢 <b>Status:</b> Ready to download on the web app

👉 <b>All Available Qualities (4K, 1080p, 720p):</b>
<a href="${detailUrl}">${detailUrl}</a>`;
    } else {
      headerTitle = `🎬 <b>DIGITAL / STREAMING RELEASE!</b>`;
      bodyText = `🍿 <b>Movie:</b> ${escapeHtml(canonicalTitle)}${yearSuffix}
💎 <b>Status:</b> ${escapeHtml(item.releaseType)}
📡 <b>Source:</b> Digital & Premiere Radar

👉 <b>Web App & Links:</b>
<a href="${detailUrl}">${detailUrl}</a>`;
    }

    const caption = `${headerTitle}\n\n${bodyText}`;

    // Generate 1-click external search URLs so the user can immediately grab releases
    // even if cloud hosting IP was temporarily blocked by torrent indexers
    const searchQuery = isTV && epCode 
      ? `${canonicalTitle} ${epCode}` 
      : `${canonicalTitle}${item.year ? ` ${item.year}` : ''}`;

    const search1337x = `https://1337x.to/search/${encodeURIComponent(searchQuery)}/1/`;
    const searchTPB = `https://thepiratebay.org/search.php?q=${encodeURIComponent(searchQuery)}`;
    const searchEZTV = `https://eztvx.to/search/${encodeURIComponent(canonicalTitle)}`;
    const searchYTS = `https://yts.mx/browse-movies/${encodeURIComponent(canonicalTitle)}`;

    const inlineKeyboard: any[] = [
      [{ text: '🍿 Open Qualities in Web App', url: detailUrl }],
    ];

    if (isTV) {
      inlineKeyboard.push([
        { text: '🔍 1337x', url: search1337x },
        { text: '🏴‍☠️ PirateBay', url: searchTPB },
        { text: '⚡ EZTV', url: searchEZTV },
      ]);
    } else {
      inlineKeyboard.push([
        { text: '🔍 1337x', url: search1337x },
        { text: '🏴‍☠️ PirateBay', url: searchTPB },
        { text: '🍿 YTS', url: searchYTS },
      ]);
    }

    inlineKeyboard.push([
      { text: '📋 My Watchlist', callback_data: 'menu_watchlist_0' },
      { text: '🔄 Scan Now', callback_data: 'action_force_scan' }
    ]);

    const replyMarkup = { inline_keyboard: inlineKeyboard };

    let totalDelivered = 0;

    for (const targetChatId of targetChatIds) {
      // Try sending photo first if poster is an HTTP URL
      let sent = false;
      if (item.poster && (item.poster.startsWith('http://') || item.poster.startsWith('https://'))) {
        try {
          const photoRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: targetChatId,
              photo: item.poster,
              caption,
              parse_mode: 'HTML',
              reply_markup: replyMarkup
            })
          });
          const photoData: any = await photoRes.json();
          if (photoData.ok) {
            sent = true;
            totalDelivered++;
          } else {
            console.warn(`Telegram sendPhoto failed for ${targetChatId} (${photoData.description}), falling back to sendMessage...`);
          }
        } catch (photoErr) {
          sent = false;
        }
      }

      if (!sent) {
        try {
          const msgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: targetChatId,
              text: caption,
              parse_mode: 'HTML',
              disable_web_page_preview: false,
              reply_markup: replyMarkup
            })
          });
          const msgData: any = await msgRes.json();
          if (msgData.ok) {
            totalDelivered++;
          } else {
            const errDesc = `Telegram alert failed for ${targetChatId} (${msgData.error_code}): ${msgData.description}`;
            console.error(errDesc);
            await logError(errDesc, 'Telegram');
          }
        } catch (msgErr: any) {
          console.error(`Telegram sendMessage failed for ${targetChatId}:`, msgErr.message);
        }
      }
    }

    if (totalDelivered > 0) {
      console.log(`Telegram alert delivered to ${totalDelivered} chat(s) for "${canonicalTitle}".`);
      await logSuccess(`Telegram alert sent: ${canonicalTitle} [${item.releaseType.slice(0, 30)}]`, 'Telegram');
      return { success: true };
    } else {
      return { success: false, error: 'Failed to deliver notification to any chat ID' };
    }
  } catch (error: any) {
    console.error('Error sending Telegram notification:', error);
    await logError(`Telegram notification failed: ${error.message}`, 'Telegram');
    return { success: false, error: error.message };
  }
}

export async function sendTestTelegramAlert(overrideToken?: string, overrideChatId?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    const token = (overrideToken || process.env.TELEGRAM_BOT_TOKEN || settings?.telegramBotToken || '').trim();
    const chatId = (overrideChatId || settings?.telegramChatId || process.env.TELEGRAM_CHAT_ID || '').trim();

    if (!token) {
      return { success: false, error: 'Telegram Bot Token is missing. Enter it in Settings.' };
    }
    if (!chatId) {
      return { success: false, error: 'Telegram Chat ID is missing. Enter it in Settings.' };
    }

    const testText = `🤖 <b>Release Radar Bot Connected!</b>\n\n✅ Your Telegram notification channel is active and verified.\n⚡ When new movie releases or show episodes drop, alerts will appear right here with 1-tap download links.`;

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: testText,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🍿 Open Release Radar Web App', url: await getBaseUrl(settings) }]
          ]
        }
      })
    });

    const data: any = await res.json();
    if (data.ok) {
      await logSuccess(`Test alert successfully sent to Telegram chat ${chatId}`, 'Telegram');
      return { success: true };
    } else {
      const err = `Telegram error (${data.error_code}): ${data.description}`;
      await logWarning(`Test alert failed: ${err}`, 'Telegram');
      return { success: false, error: data.description };
    }
  } catch (e: any) {
    return { success: false, error: e.message };
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
