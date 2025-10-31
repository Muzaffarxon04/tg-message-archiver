import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

const DEFAULT_TAB_NAME = process.env.GOOGLE_SHEETS_TAB_NAME || 'Messages';

function getAuthClient() {
  // Directly use service.json from repo root (hardcoded path)
  const serviceJsonPath = path.resolve(process.cwd(), 'service.json');
  if (!fs.existsSync(serviceJsonPath)) {
    throw new Error('❌ Service account file not found. Add service.json to project root');
  }

  const credentials = JSON.parse(fs.readFileSync(serviceJsonPath, 'utf8'));
  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

let cachedSheets = null;

function getSheetsClient() {
  if (!cachedSheets) {
    const auth = getAuthClient();
    cachedSheets = google.sheets({ version: 'v4', auth });
  }
  return cachedSheets;
}

export async function ensureHeaderRow(spreadsheetId, tabName = DEFAULT_TAB_NAME) {
  const sheets = getSheetsClient();
  try {
    await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A1:F1` });
  } catch (_) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1:F1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['timestamp_iso', 'status', 'chat_id', 'message_id', 'from', 'text']],
    },
  });
}

// boshqa funksiyalar (appendMessageRow, findRowIndexByIds, va hokazo) o‘zgarmaydi


export async function appendMessageRow({
  spreadsheetId,
  tabName = DEFAULT_TAB_NAME,
  status,
  chatId,
  messageId,
  from,
  text,
  timestampIso,
}) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:A`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[timestampIso, status, String(chatId), String(messageId), from, text ?? '']] },
  });
}

export async function findRowIndexByIds({ spreadsheetId, tabName = DEFAULT_TAB_NAME, chatId, messageId }) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A2:D` });
  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rChatId = row[2];
    const rMessageId = row[3];
    if (String(rChatId) === String(chatId) && String(rMessageId) === String(messageId)) {
      return i + 2;
    }
  }
  return null;
}

export async function updateRowStatusAndText({
  spreadsheetId,
  tabName = DEFAULT_TAB_NAME,
  rowIndex,
  status,
  text,
  timestampIso,
}) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A${rowIndex}:F${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[timestampIso, status, null, null, null, text ?? '']] },
  });
}

export async function readRowByIndex({ spreadsheetId, tabName = DEFAULT_TAB_NAME, rowIndex }) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A${rowIndex}:F${rowIndex}`,
  });
  const values = res.data.values?.[0] || [];
  return values;
}

export async function findRowIndexByMessageIdOnly({
  spreadsheetId,
  tabName = DEFAULT_TAB_NAME,
  messageId,
}) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!D2:D` });
  const rows = res.data.values || [];
  let foundIndex = null;
  for (let i = 0; i < rows.length; i++) {
    const rMessageId = rows[i]?.[0];
    if (String(rMessageId) === String(messageId)) {
      if (foundIndex !== null) return null; // ambiguous (more than one)
      foundIndex = i + 2;
    }
  }
  return foundIndex;
}
