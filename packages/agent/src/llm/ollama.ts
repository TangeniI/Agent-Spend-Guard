import type { AssistantTurn, Message, ToolCall } from '../types.js';
import type { LlmClient, LlmRequest } from './client.js';

const MAX_RETRIES = 3;
const TIMEOUT_MS = 300_000;
const CONTEXT_TOKENS = 16_384;
const LOCAL_ID = 'local-';

interface OllamaMessage {
  role?: string;
  content?: string;
  tool_calls?: { id?: string; function: { name: string; arguments?: unknown } }[];
}

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function toArgs(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toMessages(message: Message) {
  switch (message.role) {
    case 'user':
      return [{ role: 'user', content: message.text }];
    case 'assistant':
      return [message.turn.providerData];
    case 'tool':
      return message.results.map(({ name, output }) => ({
        role: 'tool',
        tool_name: name,
        content: JSON.stringify(output),
      }));
  }
}

function toTurn(message: OllamaMessage): AssistantTurn {
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call, index) => ({
    id: call.id ?? `${LOCAL_ID}${index}`,
    name: call.function.name,
    args: toArgs(call.function.arguments),
  }));
  return { text: message.content ?? '', toolCalls, providerData: message };
}

/** A model running on this machine through Ollama: no key, no quota, no cost. */
export class OllamaClient implements LlmClient {
  readonly label: string;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: OllamaOptions) {
    this.label = `${options.model} (Ollama, local)`;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async complete({ system, messages, tools }: LlmRequest): Promise<AssistantTurn> {
    const body = JSON.stringify({
      model: this.options.model,
      stream: false,
      // Temperature 0 so both red-team arms see the same model behaviour as far as possible.
      options: { temperature: 0, num_ctx: CONTEXT_TOKENS },
      messages: [{ role: 'system', content: system }, ...messages.flatMap(toMessages)],
      tools: tools.map((definition) => ({ type: 'function', function: definition })),
    });

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetch(`${this.options.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          throw new Error(`Ollama request failed: ${(error as Error).name}`);
        }
        await this.sleep(2_000 * 2 ** attempt);
        continue;
      }

      if (response.ok) {
        const { message } = (await response.json()) as { message?: OllamaMessage };
        return toTurn(message ?? {});
      }
      if (response.status < 500 || attempt === MAX_RETRIES) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(`Ollama request failed: ${response.status} ${detail?.error ?? ''}`.trim());
      }
      await this.sleep(2_000 * 2 ** attempt);
    }
  }
}
