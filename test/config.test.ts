import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConfig } from '../src/config.ts';

const base = { OPENROUTER_API_KEY: 'test', GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test',
  DATABASE_URL: 'postgresql://test', TOKEN_ENCRYPTION_SECRET: 'x'.repeat(32),
  ALLOWED_WHATSAPP_IDS: '123456789@lid' };

test('permits local HTTP OAuth only on loopback', () => {
  assert.equal(parseConfig({ ...base, APP_URL: 'http://localhost:3000' }).APP_URL, 'http://localhost:3000');
  assert.throws(() => parseConfig({ ...base, APP_URL: 'http://example.com' }));
});

test('requires valid private WhatsApp IDs in the allowlist', () => {
  assert.throws(() => parseConfig({ ...base, APP_URL: 'https://example.com', ALLOWED_WHATSAPP_IDS: '123@g.us' }));
});
