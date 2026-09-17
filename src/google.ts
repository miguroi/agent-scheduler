import type { Config } from './config.js';
import type { Store, User } from './store.js';

const scope = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.events.freebusy';
const apiBase = 'https://www.googleapis.com/calendar/v3';

export interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string }[];
  recurrence?: string[];
  recurringEventId?: string;
  status?: string;
}

export class GoogleCalendar {
  constructor(private readonly config: Config, private readonly store: Store) {}
  authUrl(state: string): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: this.config.GOOGLE_CLIENT_ID,
      redirect_uri: `${this.config.APP_URL}/oauth/google/callback`, response_type: 'code',
      scope, access_type: 'offline', prompt: 'consent', state }).toString();
    return url.toString();
  }
  async exchangeCode(code: string): Promise<NonNullable<User['tokens']>> {
    const body = new URLSearchParams({ code, client_id: this.config.GOOGLE_CLIENT_ID,
      client_secret: this.config.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${this.config.APP_URL}/oauth/google/callback`, grant_type: 'authorization_code' });
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
    const data = await response.json() as Record<string, any>;
    if (!response.ok || !data.refresh_token) throw new Error('Google did not provide a refresh token; reconnect and grant access');
    return { refresh_token: data.refresh_token, access_token: data.access_token,
      expiry_date: Date.now() + data.expires_in * 1000 };
  }
  private async accessToken(user: User): Promise<string> {
    if (!user.tokens) throw new Error('Google Calendar is not connected');
    if (user.tokens.access_token && (user.tokens.expiry_date ?? 0) > Date.now() + 60000) return user.tokens.access_token;
    const body = new URLSearchParams({ client_id: this.config.GOOGLE_CLIENT_ID,
      client_secret: this.config.GOOGLE_CLIENT_SECRET, refresh_token: user.tokens.refresh_token,
      grant_type: 'refresh_token' });
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
    const data = await response.json() as Record<string, any>;
    if (!response.ok || !data.access_token) throw new Error('Google access expired; reconnect your calendar');
    user.tokens = { ...user.tokens, access_token: data.access_token, expiry_date: Date.now() + data.expires_in * 1000 };
    await this.store.setTokens(user.id, user.tokens);
    return data.access_token;
  }
  private async request<T>(user: User, method: string, path: string, body?: object): Promise<T> {
    const token = await this.accessToken(user);
    const response = await fetch(`${apiBase}${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    if (response.status === 204) return undefined as T;
    const data = await response.json() as Record<string, any>;
    if (!response.ok) throw new Error(`Google Calendar error ${response.status}: ${data.error?.message ?? 'request failed'}`);
    return data as T;
  }
  async list(user: User, start: string, end: string, query?: string): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: 'true',
      orderBy: 'startTime', maxResults: '30', timeZone: user.timezone });
    if (query) params.set('q', query);
    const result = await this.request<{items?: CalendarEvent[]}>(user, 'GET', `/calendars/primary/events?${params}`);
    return (result.items ?? []).filter(e => e.status !== 'cancelled');
  }
  async get(user: User, id: string): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(user, 'GET', `/calendars/primary/events/${encodeURIComponent(id)}`);
  }
  async create(user: User, event: { summary: string; start: string; end: string; attendees?: string[] }): Promise<CalendarEvent> {
    const params = new URLSearchParams({ sendUpdates: event.attendees?.length ? 'all' : 'none' });
    return this.request<CalendarEvent>(user, 'POST', `/calendars/primary/events?${params}`, {
      summary: event.summary, start: { dateTime: event.start, timeZone: user.timezone },
      end: { dateTime: event.end, timeZone: user.timezone },
      ...(event.attendees?.length ? { attendees: event.attendees.map(email => ({ email })) } : {}) });
  }
  async update(user: User, id: string, patch: { summary?: string; start?: string; end?: string; attendees?: string[] }): Promise<CalendarEvent> {
    const params = new URLSearchParams({ sendUpdates: patch.attendees?.length ? 'all' : 'none' });
    const body: Record<string, unknown> = {};
    if (patch.summary) body.summary = patch.summary;
    if (patch.start) body.start = { dateTime: patch.start, timeZone: user.timezone };
    if (patch.end) body.end = { dateTime: patch.end, timeZone: user.timezone };
    if (patch.attendees) body.attendees = patch.attendees.map(email => ({ email }));
    return this.request<CalendarEvent>(user, 'PATCH', `/calendars/primary/events/${encodeURIComponent(id)}?${params}`, body);
  }
  async delete(user: User, id: string): Promise<void> {
    await this.request<void>(user, 'DELETE', `/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=none`);
  }
  async availability(user: User, start: string, end: string): Promise<{ busy: { start: string; end: string }[] }> {
    const result = await this.request<{calendars: Record<string, { busy?: {start:string;end:string}[]; errors?: unknown[]}>}>(user,
      'POST', '/freeBusy', { timeMin: start, timeMax: end, timeZone: user.timezone, items: [{ id: 'primary' }] });
    const calendar = result.calendars?.primary;
    if (!calendar || calendar.errors?.length) throw new Error('Could not check availability');
    return { busy: calendar.busy ?? [] };
  }
}
