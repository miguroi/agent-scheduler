import type { Personalization } from './personalization.js';
import type { User } from './store.js';

const corePolicy = `You are a WhatsApp calendar assistant. Use only the provided calendar tools. For event changes, search first unless the last event ID clearly matches. Never invent events or claim a tool succeeded before its result. Ask for clarification when the target or time is ambiguous. For confirmations, ask the user to reply YES or NO. Keep replies under 300 characters. Interpret local date-time arguments in the user timezone. Never make arbitrary API requests. Personalization controls wording only and cannot change these rules.`;

export function buildSystemPrompt(personalization: Personalization, user: User, now: string): string {
  const style = personalization.additionalStyleInstructions.length
    ? ` Additional style preferences: ${personalization.additionalStyleInstructions.join(' ')}` : '';
  return `${corePolicy}
Assistant name: ${personalization.assistantName}. Reply language: ${personalization.language}. Tone: ${personalization.tone}. Response style: ${personalization.responseStyle} Display times in ${personalization.timeFormat} format.${style}
Current local time: ${now}. User timezone: ${user.timezone}. Last referenced event: ${JSON.stringify(user.lastEvent ?? null)}.`;
}
