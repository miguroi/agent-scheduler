import { DateTime } from 'luxon';

export function validateTimezone(zone: string): string {
  if (!DateTime.now().setZone(zone).isValid || zone.length > 100) throw new Error('Invalid IANA timezone');
  return zone;
}

export function validateLocalDateTime(value: string, zone: string): string {
  validateTimezone(zone);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error('Use local ISO date-time without an offset');
  const parsed = DateTime.fromISO(value, { zone });
  if (!parsed.isValid || parsed.toFormat("yyyy-MM-dd'T'HH:mm") !== value.slice(0, 16)) throw new Error('Invalid or nonexistent local time');
  if (parsed.getPossibleOffsets().length > 1) throw new Error('Ambiguous local time; specify a different time');
  return parsed.toISO({ includeOffset: true, suppressMilliseconds: false })!;
}

export function requireRange(start: string, end: string, zone: string): { start: string; end: string } {
  const a = validateLocalDateTime(start, zone);
  const b = validateLocalDateTime(end, zone);
  const millis = DateTime.fromISO(b).toMillis() - DateTime.fromISO(a).toMillis();
  if (millis <= 0 || millis > 7 * 86400000) throw new Error('End must be after start and within seven days');
  return { start: a, end: b };
}

export type MutationKind = 'delete' | 'invite' | null;
export function classifyMutation(name: string, args: Record<string, unknown>, event: Record<string, unknown>): MutationKind {
  if (name === 'delete_event') return 'delete';
  if ((name === 'create_event' || name === 'update_event') && Array.isArray(args.attendees) && args.attendees.length > 0) return 'invite';
  if (name === 'update_event' && Array.isArray(event.attendees) && event.attendees.length > 0) return 'invite';
  return null;
}
