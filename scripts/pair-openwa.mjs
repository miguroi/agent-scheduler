import fs from 'node:fs';
import { create, ev } from '@open-wa/wa-automate';
import { installedOpenwaBrowserConfig } from './dist/openwa.js';

const expected = (process.env.EXPECTED_BOT_NUMBER ?? '').replace(/\D/g, '').replace(/^0/, '62');
if (!expected) throw new Error('EXPECTED_BOT_NUMBER is required');

ev.on('qr.**', async qr => {
  const base64 = String(qr).replace(/^data:image\/png;base64,/, '');
  const image = Buffer.from(base64, 'base64');
  fs.writeFileSync('/app/wa-session/pairing-qr.png', image);
  if (process.env.QR_EXPORT_PATH) fs.writeFileSync(process.env.QR_EXPORT_PATH, image);
  console.log('pairing_qr_ready path=/app/wa-session/pairing-qr.png');
});

const client = await create({ sessionId: 'calendar-bot', sessionDataPath: 'wa-session',
  executablePath: '/usr/bin/chromium', chromiumArgs: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'],
  ...installedOpenwaBrowserConfig(),
  headless: true, multiDevice: true, qrTimeout: 0, killProcessOnBrowserClose: true });
const actual = String(await client.getHostNumber()).replace(/\D/g, '').replace(/^0/, '62');
if (actual !== expected) {
  console.error('paired_number_mismatch');
  process.exit(1);
}
console.log('openwa_paired_number_verified');
await client.onMessage(message => {
  if (message.fromMe || message.isGroupMsg) return;
  console.log('incoming_message', { id: message.id, sender: message.from, chars: message.body?.length ?? 0 });
});
