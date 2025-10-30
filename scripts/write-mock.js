import fs from 'fs';
import dotenv from 'dotenv';
import { ensureHeaderRow, appendMessageRow } from '../lib/sheets.js';

// Load .env.local first if present, then .env
if (fs.existsSync('.env.local')) dotenv.config({ path: '.env.local' });
dotenv.config();

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) {
    console.error('Missing GOOGLE_SHEETS_SPREADSHEET_ID');
    process.exit(1);
  }

  const nowIso = new Date().toISOString();
  await ensureHeaderRow(spreadsheetId);
  await appendMessageRow({
    spreadsheetId,
    status: 'received',
    chatId: 1234567890,
    messageId: 1,
    from: 'Mock User',
    text: 'This is a mock test row',
    timestampIso: nowIso,
  });
  console.log('Mock row appended at', nowIso);
}

main().catch((e) => {
  console.error('Mock write failed:', e?.response?.data || e.message || e);
  process.exit(1);
});


