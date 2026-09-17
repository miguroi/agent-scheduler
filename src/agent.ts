import { DateTime } from 'luxon';
import type { Config } from './config.js';
import type { User } from './store.js';
import { CalendarTools, toolDefinitions } from './tools.js';
import type { Personalization } from './personalization.js';
import { buildSystemPrompt } from './policy.js';

type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_call_id?: string; tool_calls?: ToolCall[] };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type Completion = { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[]; error?: { message?: string } };

export class Agent {
  constructor(private readonly config: Config, private readonly tools: CalendarTools,
    private readonly personalization: Personalization) {}
  private async complete(messages: Message[], useTools: boolean): Promise<Completion> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.config.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json',
          'HTTP-Referer': this.config.APP_URL, 'X-OpenRouter-Title': 'WhatsApp Calendar Agent' },
        body: JSON.stringify({ model: this.config.OPENROUTER_MODEL, temperature: 0.2,
          max_completion_tokens: 700, parallel_tool_calls: false, messages,
          ...(useTools ? { tools: toolDefinitions, tool_choice: 'auto' } : { tool_choice: 'none' }) }) });
      const data = await response.json() as Completion;
      if (!response.ok) throw new Error(data.error?.message ?? `OpenRouter returned ${response.status}`);
      return data;
    } finally { clearTimeout(timeout); }
  }
  async respond(user: User, text: string): Promise<string> {
    const now = DateTime.now().setZone(user.timezone);
    const system = buildSystemPrompt(this.personalization, user, now.toISO()!);
    const messages: Message[] = [{ role: 'system', content: system }, { role: 'user', content: text.slice(0, 1000) }];
    for (let round = 0; round < 6; round++) {
      const result = await this.complete(messages, true);
      const reply = result.choices?.[0]?.message;
      if (!reply) throw new Error('OpenRouter returned no message');
      if (!reply.tool_calls?.length) return (reply.content ?? 'I could not complete that request.').slice(0, 1000);
      if (reply.tool_calls.length !== 1) throw new Error('Model requested multiple tools at once');
      const call = reply.tool_calls[0]!;
      messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: [call] });
      let output: Record<string, unknown>;
      try { output = await this.tools.execute(user, call.function.name, JSON.parse(call.function.arguments)); }
      catch (error) { output = { error: error instanceof Error ? error.message : 'Tool failed' }; }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
      if (output.confirmationRequired) {
        const final = await this.complete(messages, false);
        return (final.choices?.[0]?.message?.content ?? `Please reply YES to ${output.action}, or NO to cancel.`).slice(0, 1000);
      }
    }
    return 'I could not finish that request. Please try a simpler instruction.';
  }
}
