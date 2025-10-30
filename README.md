## Telegram Userbot → Google Sheets (Node.js, gramJS)

Ushbu loyiha sizning shaxsiy Telegram akkauntingizdagi xabarlarni (MTProto userbot orqali) kuzatadi va Google Sheets'ga yozadi. Yangi, tahrirlangan va o'chirilgan xabarlar mos ravishda `received | edited | deleted` statuslari bilan log qilinadi.

### Talablar
- Node.js 18+
- Google Cloud Service Account (Sheets API yoqilgan)

### O'rnatish
1. Reponi klon qiling va papkaga kiring.
2. `npm install`
3. Muhit o'zgaruvchilarini sozlang (`.env.local` yoki `env.local`):
   - `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`
   - `TELEGRAM_STRING_SESSION`
   - `GOOGLE_SHEETS_SPREADSHEET_ID`
   - `GOOGLE_APPLICATION_CREDENTIALS` yoki `GOOGLE_SERVICE_ACCOUNT_JSON`
   - `GOOGLE_SHEETS_TAB_NAME` (ixtiyoriy, default `Messages`)

### Ishga tushirish
```bash
npm run userbot
```

> Eslatma: Bot/Webhook yo'li olib tashlandi. Faqat userbot ishlaydi, public URL talab qilinmaydi.

### Google Sheets tuzilmasi
Kod birinchi ishga tushganda sahifa sarlavhasini yaratadi:

`timestamp_iso | status | chat_id | message_id | from | text`

- Yangi xabar: status = `received`
- Tahrirlangan xabar: status = `edited` (matn ham yangilanadi)

Tahrirlashda mavjud satr topilmasa (masalan, jadvaldan qo'lda o'chirib yuborilgan bo'lsa), yangi satr `edited` statusi bilan qo'shiladi.

### O'chirish hodisalari
Userbot (MTProto) o'chirilgan xabarlar hodisasini ham yuboradi, shuning uchun jadvalda `deleted` statusi ham qo'yiladi.

### Lokal test
- `ngrok` yoki shunga o'xshash tunneling xizmati bilan `PUBLIC_BASE_URL` sifatida umumiy URL yarating va webhookni o'rnating.
- Botga xabar yuboring; Sheets jadvalida yangi satr paydo bo'lishi kerak.
- Xabarni tahrirlang; mos satr statusi `edited` bo'lib, matn yangilanadi.

### Xavfsizlik
- `TELEGRAM_WEBHOOK_SECRET_TOKEN` ni sozlab, Telegram yuborayotgan so'rovlarni `X-Telegram-Bot-Api-Secret-Token` headeri orqali tekshiring.
- Service Account JSON faylini maxfiy saqlang.

## Session string olish (tezkor)
```bash
npm i telegram
node -e "import('telegram').then(async ({TelegramClient})=>{const {StringSession}=await import('telegram/sessions/index.js');const input=require('readline').createInterface({input:process.stdin,output:process.stdout});const ask=q=>new Promise(r=>input.question(q,r));(async()=>{const apiId=Number(await ask('API_ID: '));const apiHash=await ask('API_HASH: ');const phone=await ask('Phone (+998...): ');const client=new TelegramClient(new StringSession(''),apiId,apiHash,{connectionRetries:5});await client.start({phoneNumber:phone,onError:console.error,code:()=>ask('Code: '),password:()=>ask('2FA Password: ')});console.log('TELEGRAM_STRING_SESSION=',client.session.save());process.exit(0)})()})"
```


