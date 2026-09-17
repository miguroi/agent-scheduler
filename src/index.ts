import express from 'express';
import { create, type Client, type Message } from '@open-wa/wa-automate';
import { loadConfig } from './config.js';
import { validateTimezone } from './guardrails.js';
import { Store } from './store.js';
import { GoogleCalendar } from './google.js';
import { CalendarTools } from './tools.js';
import { Agent } from './agent.js';
import { allowedWhatsAppIds, clearStaleChromiumLocks, installedOpenwaBrowserConfig, isDirectWhatsAppId } from './openwa.js';
import { loadPersonalization } from './personalization.js';

async function main() {
  const config = loadConfig();
  const personalization = await loadPersonalization(config.PERSONALIZATION_FILE);
  const allowedSenders = allowedWhatsAppIds(config.ALLOWED_WHATSAPP_IDS);
  validateTimezone(config.DEFAULT_TIMEZONE);
  const store = new Store(config.DATABASE_URL, config.TOKEN_ENCRYPTION_SECRET);
  await store.init();
  await store.cleanup();
  const cleanupTimer = setInterval(() => { void store.cleanup().catch(error => console.error('cleanup_failed', error)); }, 86400000);
  const calendar = new GoogleCalendar(config, store);
  const tools = new CalendarTools(calendar, store);
  const agent = new Agent(config, tools, personalization);
  const web = express();
  let client: Client | null = null;
  web.disable('x-powered-by');
  web.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    next();
  });
  web.get('/health', (_req, res) => res.status(client ? 200 : 503).json({ status: client ? 'ready' : 'pairing' }));
  web.get('/oauth/google/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!state || !code) { res.status(400).type('text/plain').send('Google authorization was cancelled or incomplete.'); return; }
    try {
      const userId = await store.consumeOauthState(state);
      if (!userId) { res.status(400).type('text/plain').send('This link has expired. Send CONNECT again in WhatsApp.'); return; }
      const user = await store.byId(userId);
      if (!user) throw new Error('User missing');
      await store.setTokens(userId, await calendar.exchangeCode(code));
      res.type('text/plain').send('Google Calendar connected. You can return to WhatsApp.');
      if (client) await client.sendText(user.whatsappId as any, 'Google Calendar connected. You can now schedule, move, list, and check events.');
    } catch (error) {
      console.error('oauth_callback_failed', error instanceof Error ? error.message : error);
      if (!res.headersSent) res.status(500).type('text/plain').send('Connection failed. Send CONNECT again in WhatsApp.');
    }
  });
  const server = web.listen(config.PORT, '0.0.0.0', () => console.log(`http_listening port=${config.PORT}`));

  const queues = new Map<string, Promise<void>>();
  async function processMessage(message: Message): Promise<void> {
    console.log('message_received', {
      fromMe: message.fromMe,
      group: message.isGroupMsg,
      idType: message.from?.split('@').at(-1) ?? 'unknown',
      chars: message.body?.length ?? 0,
    });
    if (message.fromMe || message.isGroupMsg || !message.body?.trim() || !isDirectWhatsAppId(message.from)) return;
    if (!allowedSenders.has(message.from)) {
      console.warn('message_rejected', { reason: 'sender_not_allowed', idType: message.from.split('@').at(-1) });
      return;
    }
    const id = typeof message.id === 'string' ? message.id : JSON.stringify(message.id);
    if (!await store.markMessage(id)) return;
    const user = await store.getOrCreate(message.from, config.DEFAULT_TIMEZONE);
    const text = message.body.trim();
    let response: string;
    try {
      if (/^(yes|no)$/i.test(text)) {
        const pending = user.pending;
        await store.setPending(user.id, null);
        if (!pending || pending.expiresAt < Date.now()) response = 'There is no active confirmation. Please send your request again.';
        else if (/^no$/i.test(text)) response = 'Cancelled.';
        else {
          const result = await tools.execute(user, pending.name, pending.args, true);
          response = result.deleted ? `Deleted ${pending.label.replace(/^delete /, '')}.` :
            result.created ? `Created ${(result.created as any).title}.` :
            result.updated ? `Updated ${(result.updated as any).title}.` : 'Done.';
        }
      } else if (user.pending && user.pending.expiresAt >= Date.now())
        response = `Please reply YES to ${user.pending.label}, or NO to cancel, before sending another request.`;
      else if (/^connect$/i.test(text)) {
        const state = await store.createOauthState(user.id);
        response = `Connect your Google Calendar (link expires in 10 minutes): ${calendar.authUrl(state)}`;
      } else if (/^timezone\s+/i.test(text)) {
        const zone = validateTimezone(text.replace(/^timezone\s+/i, '').trim());
        await store.setTimezone(user.id, zone);
        response = `Timezone set to ${zone}.`;
      } else if (/^help$/i.test(text)) response = personalization.helpMessage;
      else if (!user.tokens) response = 'Send CONNECT to link your Google Calendar first. You can also set your timezone with TIMEZONE Asia/Jakarta.';
      else response = await agent.respond(user, text);
    } catch (error) {
      console.error('message_failed', { userId: user.id, error: error instanceof Error ? error.message : String(error) });
      response = 'Sorry, I could not complete that. Please try again or send CONNECT to reconnect your calendar.';
    }
    await client?.sendText(message.from, response);
    console.log('message_handled', { userId: user.id, messageId: id, chars: text.length });
  }
  clearStaleChromiumLocks('wa-session', 'calendar-bot');
  client = await create({ sessionId: 'calendar-bot', sessionDataPath: 'wa-session',
    executablePath: '/usr/bin/chromium', chromiumArgs: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'],
    ...installedOpenwaBrowserConfig(),
    headless: true, multiDevice: true, qrTimeout: 0, killProcessOnBrowserClose: true,
    ...(config.OPENWA_LICENSE_KEY ? { licenseKey: config.OPENWA_LICENSE_KEY } : {}) });
  console.log('openwa_ready');
  await client.onMessage(message => {
    const key = message.from;
    const prior = queues.get(key) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(() => processMessage(message));
    queues.set(key, next);
    void next.catch(error => console.error('queue_failed', error instanceof Error ? error.message : error))
      .finally(() => { if (queues.get(key) === next) queues.delete(key); });
  });
  const shutdown = async () => {
    clearInterval(cleanupTimer);
    server.close();
    if (client) await client.kill('shutdown');
    await store.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}
main().catch(error => { console.error('startup_failed', error); process.exit(1); });
