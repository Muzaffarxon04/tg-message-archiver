import fs from 'fs';
import dotenv from 'dotenv';
// Load .env.local first if present, then fallback to .env
if (fs.existsSync('.env.local')) dotenv.config({ path: '.env.local' });
dotenv.config();
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram/tl/index.js';
import newMsgPkg from 'telegram/events/NewMessage.js';
import editedMsgPkg from 'telegram/events/EditedMessage.js';
import deletedMsgPkg from 'telegram/events/DeletedMessage.js';
const { NewMessage } = newMsgPkg || {};
const { EditedMessage } = editedMsgPkg || {};
const { DeletedMessage } = deletedMsgPkg || {};
import { ensureHeaderRow, appendMessageRow, findRowIndexByIds, updateRowStatusAndText, readRowByIndex, findRowIndexByMessageIdOnly } from '../lib/sheets.js';

const API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const API_HASH = process.env.TELEGRAM_API_HASH || '';
const STRING_SESSION = process.env.TELEGRAM_STRING_SESSION || '';
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '';

if (!API_ID || !API_HASH) {
  console.error('Missing TELEGRAM_API_ID / TELEGRAM_API_HASH');
  process.exit(1);
}
if (!SPREADSHEET_ID) {
  console.error('Missing GOOGLE_SHEETS_SPREADSHEET_ID');
  process.exit(1);
}

async function run() {
  await ensureHeaderRow(SPREADSHEET_ID);

  const client = new TelegramClient(new StringSession(STRING_SESSION), API_ID, API_HASH, {
    connectionRetries: 5,
  });

  // Non-interactive: require TELEGRAM_STRING_SESSION
  if (!STRING_SESSION) {
    console.error('TELEGRAM_STRING_SESSION is not set. Generate a session locally first.');
    process.exit(1);
  }

  console.log('[Auth] Connecting...');
  await client.connect();
  if (!(await client.checkAuthorization())) {
    console.error('Not authorized with provided STRING_SESSION');
    process.exit(1);
  }
  console.log('[Auth] Authorized. Session OK');

  console.log('Userbot connected. Listening for messages...');
  // Warm-up: ensure updates state is initialized
  try {
    await client.getDialogs({ limit: 1 });
    await client.invoke(new Api.updates.GetState());
    console.log('[Init] Updates state initialized');
  } catch (e) {
    console.warn('[Init] Updates init warn:', e?.message || e);
  }

  // Catch-all raw updates: log and process by type (fallback if event builders fail)
  client.addEventHandler(async (update) => {
    const type = update?._ || update?.constructor?.name || typeof update;
    console.log('[RawUpdate]', type);
    try {
      await processRawUpdate(client, update);
    } catch (e) {
      // ignore
    }
  });

  // New messages
  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      const info = await extractInfo(client, msg);
      if (!info.chatId || !info.messageId) return;
      const nowIso = new Date().toISOString();
      console.log(`[NewMessage] chat=${info.chatId} msg=${info.messageId} from=${info.from} text="${truncate(info.text)}"`);
      await appendMessageRow({
        spreadsheetId: SPREADSHEET_ID,
        status: 'received',
        chatId: info.chatId,
        messageId: info.messageId,
        from: info.from,
        text: info.text,
        timestampIso: nowIso,
      });
      console.log('[Sheets] appended received');
    } catch (e) {
      console.error('[Error] NewMessage handler:', e?.response?.data || e.message || e);
    }
  }, NewMessage ? new NewMessage({}) : undefined);

  // Edited messages
  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      const info = await extractInfo(client, msg);
      if (!info.chatId || !info.messageId) return;
      const nowIso = new Date().toISOString();
      console.log(`[EditedMessage] chat=${info.chatId} msg=${info.messageId} text="${truncate(info.text)}"`);
      const rowIndex = await findRowIndexByIds({ spreadsheetId: SPREADSHEET_ID, chatId: info.chatId, messageId: info.messageId });
      if (rowIndex) {
        let oldText = '';
        try {
          const row = await readRowByIndex({ spreadsheetId: SPREADSHEET_ID, rowIndex });
          oldText = row?.[5] || '';
        } catch (_) {}
        const combined = oldText ? `${oldText} => ${info.text}` : info.text;
        await updateRowStatusAndText({ spreadsheetId: SPREADSHEET_ID, rowIndex, status: 'edited', text: combined, timestampIso: nowIso });
        console.log('[Sheets] updated row to edited');
      } else {
        await appendMessageRow({ spreadsheetId: SPREADSHEET_ID, status: 'edited', chatId: info.chatId, messageId: info.messageId, from: info.from, text: info.text, timestampIso: nowIso });
        console.log('[Sheets] appended edited (fallback)');
      }
    } catch (e) {
      console.error('[Error] EditedMessage handler:', e?.response?.data || e.message || e);
    }
  }, EditedMessage ? new EditedMessage({}) : undefined);

  // Deleted messages
  client.addEventHandler(async (event) => {
    try {
      const ids = event.deletedIds || [];
      let chatId = event.chatId ?? null;
      if (!chatId && event.chatPeer) {
        chatId = await resolvePeerId(event.chatPeer);
      }
      if (!chatId) console.log('[MessageDeleted] missing chatId; will try messageId-only matching');
      console.log(`[MessageDeleted] chat=${chatId} ids=${ids.join(',')}`);
      for (const mid of ids) {
        let rowIndex = null;
        if (chatId) {
          rowIndex = await findRowIndexByIds({ spreadsheetId: SPREADSHEET_ID, chatId, messageId: mid });
        }
        if (!rowIndex) {
          rowIndex = await findRowIndexByMessageIdOnly({ spreadsheetId: SPREADSHEET_ID, messageId: mid });
        }
        if (rowIndex) {
          let existingText = '';
          try {
            const row = await readRowByIndex({ spreadsheetId: SPREADSHEET_ID, rowIndex });
            existingText = row?.[5] || '';
          } catch (_) {}
          await updateRowStatusAndText({ spreadsheetId: SPREADSHEET_ID, rowIndex, status: 'deleted', text: existingText, timestampIso: new Date().toISOString() });
          console.log(`[Sheets] marked deleted row=${rowIndex}`);
        }
      }
    } catch (e) {
      console.error('[Error] MessageDeleted handler:', e?.response?.data || e.message || e);
    }
  }, DeletedMessage ? new DeletedMessage({}) : undefined);

  if (!NewMessage) console.warn('[Warn] NewMessage event class not found; new messages will not be captured');
  if (!EditedMessage) console.warn('[Warn] EditedMessage event class not found; edits will not be captured');
  if (!DeletedMessage) console.warn('[Warn] DeletedMessage event class not found; deletions will not be captured');
}

async function extractInfo(client, message) {
  // message can be Api.Message or Api.MessageService
  if (!(message instanceof Api.Message)) {
    return { chatId: null, messageId: null, text: '', from: '' };
  }
  const messageId = message.id;
  const text = message.message || '';

  // Determine chat (peer) id
  const peer = message.peerId;
  const chatId = await resolvePeerId(peer);

  // Sender or chat info (user/group/channel)
  let from = '';
  try {
    // Fetch richer entities
    const chatEntity = await client.getEntity(peer);
    const hasChatTitle = Boolean(chatEntity?.title);

    // Try to resolve sender (may be null for channels)
    let senderStr = '';
    if (message.fromId) {
      const senderEntity = await client.getEntity(message.fromId);
      const sParts = [];
      const fullName = [senderEntity?.firstName, senderEntity?.lastName].filter(Boolean).join(' ').trim();
      if (fullName) sParts.push(fullName);
      if (senderEntity?.username) sParts.push(`@${senderEntity.username}`);
      let phone = senderEntity?.phone;
      if (phone) sParts.push(phone.startsWith('+') ? phone : `+${phone}`);
      senderStr = sParts.join(' | ').trim();
    }

    if (hasChatTitle) {
      // Group/Channel: Chat title first, then sender if present
      const cParts = [];
      if (chatEntity?.title) cParts.push(chatEntity.title);
      if (chatEntity?.username) cParts.push(`@${chatEntity.username}`);
      if (senderStr) cParts.push(senderStr);
      from = cParts.join(' | ').trim();
    } else {
      // Personal chat: prefer sender; fallback to chat username if any
      if (senderStr) {
        from = senderStr;
      } else if (chatEntity?.username) {
        from = `@${chatEntity.username}`;
      } else {
        const name = [chatEntity?.firstName, chatEntity?.lastName].filter(Boolean).join(' ').trim();
        from = name || String(chatEntity?.id || '');
      }
    }

    // Channel posts may include author signature
    if (!from && message?.post && message?.postAuthor) {
      from = message.postAuthor;
    }
  } catch (e) {
    // As a last resort, avoid undefined artifacts
    if (!from) from = '';
  }
  return { chatId, messageId, text, from };
}

async function resolvePeerId(peer) {
  if (!peer) return null;
  if (peer instanceof Api.PeerUser) return peer.userId;
  if (peer instanceof Api.PeerChat) return peer.chatId;
  if (peer instanceof Api.PeerChannel) return peer.channelId;
  // For plain object versions
  if (peer._ === 'peerUser') return peer.user_id;
  if (peer._ === 'peerChat') return peer.chat_id;
  if (peer._ === 'peerChannel') return peer.channel_id;
  return null;
}

function truncate(s, max = 100) {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

async function processRawUpdate(client, update) {
  const nowIso = new Date().toISOString();
  try {
    // Unwrap container updates (Updates/UpdatesCombined)
    if (update && Array.isArray(update.updates)) {
      for (const inner of update.updates) {
        await processRawUpdate(client, inner);
      }
      return;
    }
    if (Array.isArray(update)) {
      for (const inner of update) {
        await processRawUpdate(client, inner);
      }
      return;
    }
    // New message variants
    if (update?._ === 'updateShortMessage') {
      const messageId = update.id;
      const text = update.message || '';
      const peer = { _: 'peerUser', user_id: update.userId };
      const chatId = await resolvePeerId(peer);
      let from = '';
      try {
        const sender = await client.getInputEntity(peer);
        if (sender?.username) from = `@${sender.username}`;
        if (!from && sender?.firstName) from = sender.firstName + (sender?.lastName ? ` ${sender.lastName}` : '');
      } catch (_) {}
      if (!chatId || !messageId) return;
      console.log(`[Fallback-ShortNew] chat=${chatId} msg=${messageId} text="${truncate(text)}"`);
      await appendMessageRow({ spreadsheetId: SPREADSHEET_ID, status: 'received', chatId, messageId, from, text, timestampIso: nowIso });
      console.log('[Sheets] appended received');
      return;
    }

    if (update?._ === 'updateShortChatMessage') {
      const messageId = update.id;
      const text = update.message || '';
      const peer = { _: 'peerChat', chat_id: update.chatId };
      const chatId = await resolvePeerId(peer);
      let from = '';
      try {
        const sender = await client.getInputEntity({ _: 'peerUser', user_id: update.fromId });
        const chat = await client.getInputEntity({ _: 'peerChat', chat_id: update.chatId });
        const parts = [];
        const fullName = [sender?.firstName, sender?.lastName].filter(Boolean).join(' ').trim();
        if (fullName) parts.push(fullName);
        if (sender?.username) parts.push(`@${sender.username}`);
        if (chat?.title) parts.push(chat.title);
        from = parts.join(' | ').trim();
      } catch (_) {}
      if (!chatId || !messageId) return;
      console.log(`[Fallback-ShortChatNew] chat=${chatId} msg=${messageId} text="${truncate(text)}"`);
      await appendMessageRow({ spreadsheetId: SPREADSHEET_ID, status: 'received', chatId, messageId, from, text, timestampIso: nowIso });
      console.log('[Sheets] appended received');
      return;
    }

    if (update?._ === 'updateNewMessage' || update?._ === 'updateNewChannelMessage') {
      const message = update.message;
      const info = await extractInfo(client, message);
      if (!info.chatId || !info.messageId) return;
      console.log(`[Fallback-New] chat=${info.chatId} msg=${info.messageId} text="${truncate(info.text)}"`);
      await appendMessageRow({ spreadsheetId: SPREADSHEET_ID, status: 'received', chatId: info.chatId, messageId: info.messageId, from: info.from, text: info.text, timestampIso: nowIso });
      console.log('[Sheets] appended received');
      return;
    }

    // Edited message variants
    if (update?._ === 'updateEditMessage' || update?._ === 'updateEditChannelMessage') {
      const message = update.message;
      const info = await extractInfo(client, message);
      if (!info.chatId || !info.messageId) return;
      console.log(`[Fallback-Edit] chat=${info.chatId} msg=${info.messageId} text="${truncate(info.text)}"`);
      const rowIndex = await findRowIndexByIds({ spreadsheetId: SPREADSHEET_ID, chatId: info.chatId, messageId: info.messageId });
      if (rowIndex) {
        let oldText = '';
        try {
          const row = await readRowByIndex({ spreadsheetId: SPREADSHEET_ID, rowIndex });
          oldText = row?.[5] || '';
        } catch (_) {}
        const combined = oldText ? `${oldText} => ${info.text}` : info.text;
        await updateRowStatusAndText({ spreadsheetId: SPREADSHEET_ID, rowIndex, status: 'edited', text: combined, timestampIso: nowIso });
        console.log('[Sheets] updated row to edited');
      } else {
        await appendMessageRow({ spreadsheetId: SPREADSHEET_ID, status: 'edited', chatId: info.chatId, messageId: info.messageId, from: info.from, text: info.text, timestampIso: nowIso });
        console.log('[Sheets] appended edited (fallback)');
      }
      return;
    }

    // Deleted message variants
    if (update?._ === 'updateDeleteMessages' || update?._ === 'updateDeleteChannelMessages') {
      const ids = update.messages || [];
      const peer = update.peer || update.channelId || update.chatId || null;
      const chatId = await resolvePeerId(peer);
      if (!chatId) {
        console.log('[Fallback-Delete] missing chatId; will try messageId-only matching');
      }
      console.log(`[Fallback-Delete] chat=${chatId || 'unknown'} ids=${ids.join(',')}`);
      for (const mid of ids) {
        let rowIndex = null;
        if (chatId) {
          rowIndex = await findRowIndexByIds({ spreadsheetId: SPREADSHEET_ID, chatId, messageId: mid });
        }
        if (!rowIndex) {
          rowIndex = await findRowIndexByMessageIdOnly({ spreadsheetId: SPREADSHEET_ID, messageId: mid });
        }
        if (rowIndex) {
          let existingText = '';
          try {
            const row = await readRowByIndex({ spreadsheetId: SPREADSHEET_ID, rowIndex });
            existingText = row?.[5] || '';
          } catch (_) {}
          await updateRowStatusAndText({ spreadsheetId: SPREADSHEET_ID, rowIndex, status: 'deleted', text: existingText, timestampIso: nowIso });
          console.log(`[Sheets] marked deleted row=${rowIndex}`);
        }
      }
      return;
    }
  } catch (e) {
    console.error('[Fallback-Error]', e?.response?.data || e.message || e);
  }
}

run().catch((e) => {
  console.error('Userbot failed to start:', e);
  process.exit(1);
});


