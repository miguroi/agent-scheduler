import assert from 'node:assert/strict';
import test from 'node:test';
import { CalendarTools } from '../src/tools.ts';
import type { GoogleCalendar, CalendarEvent } from '../src/google.ts';
import type { Store, User } from '../src/store.ts';

function fixture() {
  const calls: string[] = [];
  const event: CalendarEvent = { id: 'evt1', summary: 'Gym',
    start: { dateTime: '2026-09-16T19:00:00+07:00' }, end: { dateTime: '2026-09-16T20:00:00+07:00' } };
  const calendar = {
    async list() { calls.push('list'); return [event]; },
    async get() { calls.push('get'); return event; },
    async create(_user: User, input: { summary: string; start: string; end: string }) {
      calls.push('create'); return { ...event, summary: input.summary, start: { dateTime: input.start }, end: { dateTime: input.end } };
    },
    async update(_user: User, _id: string, input: { start?: string; end?: string }) {
      calls.push('update'); return { ...event, start: { dateTime: input.start ?? event.start!.dateTime! },
        end: { dateTime: input.end ?? event.end!.dateTime! } };
    },
    async delete() { calls.push('delete'); },
    async availability() { calls.push('availability'); return { busy: [] }; }
  } as unknown as GoogleCalendar;
  const store = {
    async setPending(_id: number, pending: User['pending']) { calls.push(pending ? 'pending' : 'clear'); },
    async setLastEvent() { calls.push('remember'); }
  } as unknown as Store;
  const user: User = { id: 1, whatsappId: '1@c.us', timezone: 'Asia/Jakarta', tokens: { refresh_token: 'x' }, lastEvent: null, pending: null };
  return { tools: new CalendarTools(calendar, store), calls, user };
}

test('create stores an offset-aware timed event', async () => {
  const { tools, calls, user } = fixture();
  const result = await tools.execute(user, 'create_event', { title: 'Gym', start: '2026-09-16T19:00', end: '2026-09-16T20:00', attendees: null });
  assert.equal((result.created as any).start, '2026-09-16T19:00:00.000+07:00');
  assert.deepEqual(calls, ['create', 'remember']);
});

test('list returns events in the requested local day', async () => {
  const { tools, user } = fixture();
  const result = await tools.execute(user, 'list_events', { start: '2026-09-16T00:00', end: '2026-09-17T00:00' });
  assert.equal(result.count, 1);
  assert.equal((result.events as any[])[0].title, 'Gym');
});

test('moving an event preserves its one-hour duration', async () => {
  const { tools, user } = fixture();
  const result = await tools.execute(user, 'update_event', { eventId: 'evt1', title: null, start: '2026-09-16T15:00', end: null });
  assert.equal((result.updated as any).end, '2026-09-16T16:00:00.000+07:00');
});

test('cannot set an end time before the existing start', async () => {
  const { tools, user } = fixture();
  await assert.rejects(tools.execute(user, 'update_event', { eventId: 'evt1', title: null, start: null, end: '2026-09-16T18:00' }));
});

test('cancel pauses before any deletion and deletes after YES', async () => {
  const { tools, calls, user } = fixture();
  const args = { eventId: 'evt1' };
  const first = await tools.execute(user, 'delete_event', args);
  assert.equal(first.confirmationRequired, true);
  assert.equal(calls.includes('delete'), false);
  await tools.execute(user, 'delete_event', args, true);
  assert.equal(calls.includes('delete'), true);
});

test('availability reports a clear slot', async () => {
  const { tools, user } = fixture();
  const result = await tools.execute(user, 'check_availability', { start: '2026-09-16T15:00', end: '2026-09-16T16:00' });
  assert.equal(result.available, true);
});

test('creating an event with guests pauses before inviting', async () => {
  const { tools, calls, user } = fixture();
  const result = await tools.execute(user, 'create_event', { title: 'Lunch', start: '2026-09-16T12:00', end: '2026-09-16T13:00', attendees: ['a@example.com'] });
  assert.equal(result.confirmationRequired, true);
  assert.equal(calls.includes('create'), false);
});
