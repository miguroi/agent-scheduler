import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLocalDateTime, classifyMutation } from '../src/guardrails.ts';

test('rejects a local time that does not exist during DST transition', () => {
  assert.throws(() => validateLocalDateTime('2026-03-08T02:30:00', 'America/New_York'));
});

test('rejects a repeated local time during DST transition', () => {
  assert.throws(() => validateLocalDateTime('2026-11-01T01:30:00', 'America/New_York'));
});

test('converts a valid local time to an offset-aware timestamp', () => {
  assert.equal(validateLocalDateTime('2026-09-16T19:00:00', 'Asia/Jakarta'), '2026-09-16T19:00:00.000+07:00');
});

test('deletion always requires confirmation', () => {
  assert.equal(classifyMutation('delete_event', { eventId: 'abc' }, {}), 'delete');
});

test('adding invitees requires confirmation', () => {
  assert.equal(classifyMutation('create_event', { title: 'Lunch', start: '2026-09-16T12:00:00', end: '2026-09-16T13:00:00', attendees: ['a@example.com'] }, {}), 'invite');
});
