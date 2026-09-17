import { z } from 'zod';
import { DateTime } from 'luxon';
import { classifyMutation, requireRange, validateLocalDateTime } from './guardrails.js';
import type { Store, User } from './store.js';
import type { CalendarEvent, GoogleCalendar } from './google.js';

const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/);
const eventId = z.string().min(1).max(256);
const schemas = {
  list_events: z.strictObject({ start: local, end: local }),
  search_events: z.strictObject({ query: z.string().min(1).max(100), start: local, end: local }),
  create_event: z.strictObject({ title: z.string().min(1).max(200), start: local, end: local,
    attendees: z.array(z.email()).max(10).nullable() }),
  update_event: z.strictObject({ eventId, title: z.string().min(1).max(200).nullable(),
    start: local.nullable(), end: local.nullable() }),
  delete_event: z.strictObject({ eventId }),
  check_availability: z.strictObject({ start: local, end: local })
};
export type ToolName = keyof typeof schemas;

function tool(name: ToolName, description: string, properties: object, required: string[]) {
  return { type: 'function' as const, function: { name, description,
    strict: true, parameters: { type: 'object', properties, required, additionalProperties: false } } };
}
const date = { type: 'string', description: 'Local ISO date-time YYYY-MM-DDTHH:mm in the user timezone; no UTC suffix or offset' };
const id = { type: 'string', description: 'Exact event ID returned by a previous calendar tool' };
export const toolDefinitions = [
  tool('list_events', 'List events within a local date-time range, maximum 31 days.', { start: date, end: date }, ['start','end']),
  tool('search_events', 'Find matching events in a local date-time range. Search before updating or deleting if the ID is unknown.',
    { query: { type: 'string' }, start: date, end: date }, ['query','start','end']),
  tool('create_event', 'Create a timed event. Inviting attendees pauses for confirmation.',
    { title: { type: 'string' }, start: date, end: date, attendees: { anyOf: [{ type: 'array', items: { type: 'string', format: 'email' } }, { type: 'null' }] } }, ['title','start','end','attendees']),
  tool('update_event', 'Update one event by ID. If only start is given, preserve its duration.',
    { eventId: id, title: { anyOf: [{ type: 'string' }, { type: 'null' }] }, start: { anyOf: [date, { type: 'null' }] }, end: { anyOf: [date, { type: 'null' }] } }, ['eventId','title','start','end']),
  tool('delete_event', 'Delete one event by ID. Always pauses for confirmation.', { eventId: id }, ['eventId']),
  tool('check_availability', 'Check busy intervals within a local date-time range.', { start: date, end: date }, ['start','end'])
];

function readRange(start: string, end: string, zone: string): { start: string; end: string } {
  const a = validateLocalDateTime(start, zone), b = validateLocalDateTime(end, zone);
  const duration = DateTime.fromISO(b).toMillis() - DateTime.fromISO(a).toMillis();
  if (duration <= 0 || duration > 31 * 86400000) throw new Error('Range must be positive and within 31 days');
  return { start: a, end: b };
}
function slim(event: CalendarEvent) {
  return { id: event.id, title: (event.summary ?? '(untitled)').slice(0, 200), start: event.start?.dateTime ?? event.start?.date,
    end: event.end?.dateTime ?? event.end?.date, recurring: Boolean(event.recurrence?.length || event.recurringEventId),
    hasGuests: Boolean(event.attendees?.length) };
}
function remember(event: CalendarEvent): User['lastEvent'] {
  return { id: event.id, summary: (event.summary ?? '(untitled)').slice(0, 200), start: event.start?.dateTime ?? event.start?.date };
}

export class CalendarTools {
  constructor(private readonly calendar: GoogleCalendar, private readonly store: Store) {}
  async execute(user: User, name: string, rawArgs: unknown, confirmed = false): Promise<Record<string, unknown>> {
    if (!(name in schemas)) throw new Error('Unknown tool');
    const args = (schemas as Record<string, z.ZodTypeAny>)[name]!.parse(rawArgs) as Record<string, any>;
    if (name === 'list_events' || name === 'search_events') {
      const range = readRange(args.start, args.end, user.timezone);
      const events = await this.calendar.list(user, range.start, range.end, name === 'search_events' ? args.query : undefined);
      if (events.length === 1) await this.store.setLastEvent(user.id, remember(events[0]!));
      return { events: events.map(slim), count: events.length };
    }
    if (name === 'check_availability') {
      const range = readRange(args.start, args.end, user.timezone);
      const result = await this.calendar.availability(user, range.start, range.end);
      return { available: result.busy.length === 0, busy: result.busy };
    }
    if (name === 'create_event') {
      const range = requireRange(args.start, args.end, user.timezone);
      const mutation = classifyMutation(name, args, {});
      if (mutation && !confirmed) return this.pause(user, mutation, name, args, `invite ${args.attendees.join(', ')} to ${args.title}`);
      const event = await this.calendar.create(user, { summary: args.title, ...range, attendees: args.attendees ?? undefined });
      await this.store.setLastEvent(user.id, remember(event));
      return { created: slim(event) };
    }
    const event = await this.calendar.get(user, args.eventId);
    if (name === 'delete_event') {
      if (!confirmed) return this.pause(user, 'delete', name, args,
        `delete ${event.summary ?? 'this event'}${event.recurrence?.length || event.recurringEventId ? ' (recurring)' : ''}`);
      await this.calendar.delete(user, args.eventId);
      await this.store.setLastEvent(user.id, null);
      return { deleted: { id: args.eventId, title: event.summary ?? '(untitled)' } };
    }
    if (name === 'update_event') {
      if (!args.title && !args.start && !args.end) throw new Error('Nothing to update');
      if (event.recurrence?.length) throw new Error('Updating a whole recurring series is not supported');
      if (!event.start?.dateTime || !event.end?.dateTime) throw new Error('Only timed events can be moved');
      if (event.attendees?.length && !confirmed) return this.pause(user, 'invite', name, args, `update ${event.summary ?? 'this event'} with guests`);
      const oldStart = DateTime.fromISO(event.start.dateTime), oldEnd = DateTime.fromISO(event.end.dateTime);
      const start = args.start ? validateLocalDateTime(args.start, user.timezone) : undefined;
      const end = args.end ? validateLocalDateTime(args.end, user.timezone) :
        start ? DateTime.fromISO(start, { setZone: true }).plus({ milliseconds: oldEnd.toMillis() - oldStart.toMillis() }).toISO()! : undefined;
      if (end && DateTime.fromISO(end).toMillis() <= DateTime.fromISO(start ?? event.start.dateTime).toMillis()) throw new Error('End must be after start');
      const updated = await this.calendar.update(user, args.eventId, { summary: args.title ?? undefined, start, end });
      await this.store.setLastEvent(user.id, remember(updated));
      return { updated: slim(updated) };
    }
    throw new Error('Unknown tool');
  }
  private async pause(user: User, kind: 'delete' | 'invite', name: string, args: Record<string, unknown>, label: string) {
    const pending: NonNullable<User['pending']> = { kind, name, args, label, expiresAt: Date.now() + 10 * 60000 };
    await this.store.setPending(user.id, pending);
    return { confirmationRequired: true, action: label, instruction: 'Ask the user to reply YES to confirm or NO to cancel.' };
  }
}
