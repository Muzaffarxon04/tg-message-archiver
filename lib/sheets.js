import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';

const DEFAULT_TAB_NAME = process.env.GOOGLE_SHEETS_TAB_NAME || 'Messages';

function getAuthClient() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  throw new Error('Google credentials are not configured');
}

function getSheetsClient() {
  const auth = getAuthClient();
  return google.sheets({ version: 'v4', auth });
}

export async function ensureHeaderRow(spreadsheetId, tabName = DEFAULT_TAB_NAME) {
  const sheets = getSheetsClient();
  try {
    await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A1:F1` });
  } catch (_) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
      });
    } catch (_) {}
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1:F1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['timestamp_iso', 'status', 'chat_id', 'message_id', 'from', 'text']] },
  });
}

export async function appendMessageRow({ spreadsheetId, tabName = DEFAULT_TAB_NAME, status, chatId, messageId, from, text, timestampIso }) {
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

export async function updateRowStatusAndText({ spreadsheetId, tabName = DEFAULT_TAB_NAME, rowIndex, status, text, timestampIso }) {
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
  return values; // [timestamp_iso, status, chat_id, message_id, from, text]
}

export async function findRowIndexByMessageIdOnly({ spreadsheetId, tabName = DEFAULT_TAB_NAME, messageId }) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!D2:D` });
  const rows = res.data.values || [];
  let foundIndex = null;
  for (let i = 0; i < rows.length; i++) {
    const rMessageId = rows[i]?.[0];
    if (String(rMessageId) === String(messageId)) {
      if (foundIndex !== null) return null; // ambiguous (more than one)
      foundIndex = i + 2; // header offset
    }
  }
  return foundIndex;
}


