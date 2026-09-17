import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

export function normalChromeUserAgent(browserVersion: string): string {
  const match = browserVersion.match(/(?:Chromium|Chrome)\s+(\d+\.\d+\.\d+\.\d+)/);
  if (!match) throw new Error('Could not determine installed Chromium version');
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${match[1]} Safari/537.36`;
}

export function openwaBrowserConfig(browserVersion: string) {
  return { inDocker: true, customUserAgent: normalChromeUserAgent(browserVersion) };
}

export function installedOpenwaBrowserConfig() {
  return openwaBrowserConfig(execFileSync('/usr/bin/chromium', ['--version'], { encoding: 'utf8' }));
}

export function isDirectWhatsAppId(id: string | undefined): boolean {
  return Boolean(id && /@(c\.us|lid)$/.test(id));
}

export function allowedWhatsAppIds(value: string): Set<string> {
  return new Set(value.split(',').map(id => id.trim()));
}

export function clearStaleChromiumLocks(sessionDataPath: string, sessionId: string): void {
  const profile = join(sessionDataPath, `_IGNORE_${sessionId}`);
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie'])
    rmSync(join(profile, name), { force: true });
}
