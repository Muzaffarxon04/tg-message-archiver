import readline from 'readline';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (ans) => r(ans)));

async function main() {
  // Global safety timeout (2 minutes) to avoid hanging
  const globalTimer = setTimeout(() => {
    console.error('Timeout: operation took too long');
    try { rl.close(); } catch (_) {}
    process.exit(1);
  }, 120000);

  const apiIdRaw = await ask('API_ID: ');
  const apiId = Number(apiIdRaw.trim());
  const apiHash = (await ask('API_HASH: ')).trim();
  const phone = (await ask('Phone (+998...): ')).trim();

  if (!apiId || !apiHash || !phone) {
    console.error('API_ID, API_HASH va Phone talab qilinadi');
    rl.close();
    process.exit(1);
  }

  console.log('Telegram sizga kod yuboradi. Terminalda "Code:" so‘ralganda shu kodni kiriting.');

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
  try {
    await client.start({
      phoneNumber: async () => phone,
      // gramJS expects `phoneCode` (not `code`) for the login code callback
      phoneCode: async () => {
        // Single-shot prompt (no loop); exit if empty
        const codeTimer = setTimeout(() => {
          console.error('Timeout: code kiritilmadi');
          try { rl.close(); } catch (_) {}
          process.exit(1);
        }, 60000);
        const code = (await ask('Code: ')).trim();
        clearTimeout(codeTimer);
        if (!code) {
          console.error('Code is empty');
          try { rl.close(); } catch (_) {}
          process.exit(1);
        }
        return code;
      },
      password: async () => {
        // 2FA bo‘lsa, bu so‘raladi; bo‘lmasa, bo‘sh qoldiring
        const pass = (await ask('2FA Password (agar yoqilgan bo‘lsa): ')).trim();
        return pass;
      },
      onError: (e) => {
        console.error('Auth error:', e?.message || e);
        try { rl.close(); } catch (_) {}
        process.exit(1);
      },
    });
  } catch (e) {
    console.error('Start failed:', e?.message || e);
    try { rl.close(); } catch (_) {}
    process.exit(1);
  }

  const session = client.session.save();
  console.log('\nTELEGRAM_STRING_SESSION=' + session + '\n');
  clearTimeout(globalTimer);
  try { rl.close(); } catch (_) {}
  process.exit(0);
}

main().catch((e) => {
  console.error('Session generation failed:', e?.message || e);
  try { rl.close(); } catch (_) {}
  process.exit(1);
});

process.on('unhandledRejection', (e) => {
  console.error('UnhandledRejection:', e?.message || e);
  try { rl.close(); } catch (_) {}
  process.exit(1);
});

process.on('uncaughtException', (e) => {
  console.error('UncaughtException:', e?.message || e);
  try { rl.close(); } catch (_) {}
  process.exit(1);
});
