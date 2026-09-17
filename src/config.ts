import { z } from 'zod';

const schema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().default('openai/gpt-5.6-luna'),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  TOKEN_ENCRYPTION_SECRET: z.string().min(32),
  APP_URL: z.url().refine(v => {
    const url = new URL(v);
    return url.origin === v && (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  }, 'APP_URL must be an HTTPS origin or a loopback HTTP origin'),
  DEFAULT_TIMEZONE: z.string().default('Asia/Jakarta'),
  PERSONALIZATION_FILE: z.string().min(1).default('config/personalization.json'),
  ALLOWED_WHATSAPP_IDS: z.string().min(1).refine(value => value.split(',').every(id => /^\d+(?::\d+)?@(c\.us|lid)$/.test(id.trim())),
    'ALLOWED_WHATSAPP_IDS must contain comma-separated private WhatsApp IDs'),
  PORT: z.coerce.number().int().default(3000),
  OPENWA_LICENSE_KEY: z.string().optional()
});

export type Config = z.infer<typeof schema>;
export function parseConfig(input: unknown): Config { return schema.parse(input); }
export function loadConfig(): Config { return parseConfig(process.env); }
