import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const schema = z.strictObject({
  assistantName: z.string().trim().min(1).max(40).default('Calendar Assistant'),
  language: z.string().trim().min(1).max(40).default('English'),
  tone: z.string().trim().min(1).max(160).default('friendly, calm, and concise'),
  responseStyle: z.string().trim().min(1).max(240).default('Use short sentences suitable for WhatsApp.'),
  timeFormat: z.enum(['12-hour', '24-hour']).default('12-hour'),
  helpMessage: z.string().trim().min(1).max(700).default(
    'Send a request such as “Schedule gym tomorrow at 7pm for 1 hour.” Use CONNECT to link Google Calendar or TIMEZONE Asia/Jakarta to change your timezone.'),
  additionalStyleInstructions: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
});

export type Personalization = z.infer<typeof schema>;
export const defaultPersonalization: Personalization = schema.parse({});

export function parsePersonalization(value: unknown): Personalization {
  return schema.parse(value);
}

export async function loadPersonalization(path: string): Promise<Personalization> {
  try {
    return parsePersonalization(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultPersonalization;
    throw new Error(`Invalid personalization file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
