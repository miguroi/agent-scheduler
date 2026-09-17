import crypto from 'node:crypto';
import pg from 'pg';

export interface User {
  id: number;
  whatsappId: string;
  timezone: string;
  tokens: { refresh_token: string; access_token?: string; expiry_date?: number } | null;
  lastEvent: { id: string; summary: string; start?: string } | null;
  pending: { kind: 'delete' | 'invite'; name: string; args: Record<string, unknown>; label: string; expiresAt: number } | null;
}

const ddl = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY, whatsapp_id TEXT NOT NULL UNIQUE, timezone TEXT NOT NULL,
  google_tokens TEXT, last_event JSONB, pending JSONB
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;

export class Store {
  readonly pool: pg.Pool;
  private readonly key: Buffer;
  constructor(databaseUrl: string, secret: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    this.key = crypto.createHash('sha256').update(secret).digest();
  }
  async init(): Promise<void> { await this.pool.query(ddl); }
  async cleanup(): Promise<void> {
    await this.pool.query("DELETE FROM oauth_states WHERE expires_at < NOW()");
    await this.pool.query("DELETE FROM processed_messages WHERE created_at < NOW() - INTERVAL '30 days'");
  }
  async close(): Promise<void> { await this.pool.end(); }
  private encrypt(value: object): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  private decrypt(value: string): User['tokens'] {
    const raw = Buffer.from(value, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString());
  }
  private asUser(row: any): User {
    return { id: Number(row.id), whatsappId: row.whatsapp_id, timezone: row.timezone,
      tokens: row.google_tokens ? this.decrypt(row.google_tokens) : null,
      lastEvent: row.last_event ?? null, pending: row.pending ?? null };
  }
  async getOrCreate(whatsappId: string, timezone: string): Promise<User> {
    const r = await this.pool.query(`INSERT INTO users (whatsapp_id, timezone) VALUES ($1,$2)
      ON CONFLICT (whatsapp_id) DO UPDATE SET whatsapp_id=EXCLUDED.whatsapp_id RETURNING *`, [whatsappId, timezone]);
    return this.asUser(r.rows[0]);
  }
  async byId(id: number): Promise<User | null> {
    const r = await this.pool.query('SELECT * FROM users WHERE id=$1', [id]);
    return r.rows[0] ? this.asUser(r.rows[0]) : null;
  }
  async setTimezone(id: number, zone: string): Promise<void> { await this.pool.query('UPDATE users SET timezone=$2 WHERE id=$1', [id, zone]); }
  async setTokens(id: number, tokens: NonNullable<User['tokens']>): Promise<void> {
    await this.pool.query('UPDATE users SET google_tokens=$2 WHERE id=$1', [id, this.encrypt(tokens)]);
  }
  async setLastEvent(id: number, event: User['lastEvent']): Promise<void> { await this.pool.query('UPDATE users SET last_event=$2 WHERE id=$1', [id, event]); }
  async setPending(id: number, pending: User['pending']): Promise<void> { await this.pool.query('UPDATE users SET pending=$2 WHERE id=$1', [id, pending]); }
  async markMessage(messageId: string): Promise<boolean> {
    const r = await this.pool.query('INSERT INTO processed_messages(message_id) VALUES($1) ON CONFLICT DO NOTHING', [messageId]);
    return r.rowCount === 1;
  }
  async createOauthState(userId: number): Promise<string> {
    const state = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(state).digest('hex');
    await this.pool.query('INSERT INTO oauth_states(state_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL \'10 minutes\')', [hash, userId]);
    return state;
  }
  async consumeOauthState(state: string): Promise<number | null> {
    const hash = crypto.createHash('sha256').update(state).digest('hex');
    const r = await this.pool.query('DELETE FROM oauth_states WHERE state_hash=$1 AND expires_at>NOW() RETURNING user_id', [hash]);
    return r.rows[0] ? Number(r.rows[0].user_id) : null;
  }
}
