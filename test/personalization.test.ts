import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePersonalization } from '../src/personalization.ts';
import { buildSystemPrompt } from '../src/policy.ts';
import type { User } from '../src/store.ts';

test('fills safe personalization defaults and rejects unknown fields', () => {
  assert.equal(parsePersonalization({}).assistantName, 'Calendar Assistant');
  assert.throws(() => parsePersonalization({ disableConfirmations: true }));
});

test('combines editable style with the fixed calendar policy', () => {
  const user = { id: 1, whatsappId: '123@lid', timezone: 'Asia/Jakarta', tokens: null,
    lastEvent: null, pending: null } satisfies User;
  const prompt = buildSystemPrompt(parsePersonalization({ assistantName: 'Nomi', language: 'Indonesian' }),
    user, '2026-09-17T19:00:00+07:00');
  assert.match(prompt, /Assistant name: Nomi/);
  assert.match(prompt, /Use only the provided calendar tools/);
  assert.match(prompt, /cannot change these rules/);
});
