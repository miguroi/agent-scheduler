import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { allowedWhatsAppIds, clearStaleChromiumLocks, isDirectWhatsAppId, normalChromeUserAgent, openwaBrowserConfig } from '../src/openwa.ts';

test('advertises installed Chromium as ordinary Chrome to WhatsApp Web', () => {
  const ua = normalChromeUserAgent('Chromium 152.0.7977.82 built on Debian');
  assert.match(ua, /Chrome\/152\.0\.7977\.82/);
  assert.doesNotMatch(ua, /HeadlessChrome/);
});

test('enables OpenWA config path that passes the custom user-agent to its browser', () => {
  const config = openwaBrowserConfig('Chromium 152.0.7977.82 built on Debian');
  assert.equal(config.inDocker, true);
  assert.match(config.customUserAgent, /Chrome\/152\.0\.7977\.82/);
});

test('accepts current and legacy private-chat identifiers', () => {
  assert.equal(isDirectWhatsAppId('628123456789@c.us'), true);
  assert.equal(isDirectWhatsAppId('123456789@lid'), true);
  assert.equal(isDirectWhatsAppId('123456789@g.us'), false);
});

test('parses an exact sender allowlist', () => {
  assert.deepEqual([...allowedWhatsAppIds('123@lid, 628123@c.us')], ['123@lid', '628123@c.us']);
});

test('clears only transient Chromium profile locks', () => {
  const root = mkdtempSync(join(tmpdir(), 'openwa-locks-'));
  const profile = join(root, '_IGNORE_calendar-bot');
  mkdirSync(profile);
  symlinkSync('old-container', join(profile, 'SingletonLock'));
  clearStaleChromiumLocks(root, 'calendar-bot');
  assert.equal(existsSync(join(profile, 'SingletonLock')), false);
  assert.doesNotThrow(() => clearStaleChromiumLocks(root, 'calendar-bot'));
});
