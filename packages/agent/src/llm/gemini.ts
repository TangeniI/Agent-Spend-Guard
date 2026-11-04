import type { AssistantTurn, Message, ToolCall, ToolResult } from '../types.js';
import type { LlmClient, LlmRequest } from './client.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRIES = 3;
const RETRYABLE = new Set([429, 500, 503]);
const LOCAL_ID = 'local-';
const TIMEOUT_MS = 120_000;

interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
}

interface GeminiContent {
  role?: string;
  parts?: GeminiPart[];
}

export interface GeminiOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

function toFunctionResponse({ id, name, output }: ToolResult) {
  return {
    functionResponse: {
      ...(id.startsWith(LOCAL_ID) ? {} : { id }),
      name,
      response: { result: output },
    },
  };
}

function toContent(message: Message) {
  switch (message.role) {
    case 'user':
      return { role: 'user', parts: [{ text: message.text }] };
    case 'assistant':
      return message.turn.providerData;
    case 'tool':
      return { role: 'user', parts: message.results.map(toFunctionResponse) };
  }
}

function toTurn(content: GeminiContent): AssistantTurn {
  const parts = content.parts ?? [];
  const toolCalls: ToolCall[] = [];
  parts.forEach(({ functionCall }, index) => {
    if (!functionCall) return;
    toolCalls.push({
      id: functionCall.id ?? `${LOCAL_ID}${index}`,
      name: functionCall.name,
      args: functionCall.args ?? {},
    });
  });
  const text = parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? '')
    .join('');
  return { text, toolCalls, providerData: content };
}

async function errorMessage(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return `Gemini request failed: ${response.status} ${body?.error?.message ?? ''}`.trim();
}

export class GeminiClient implements LlmClient {
  readonly label: string;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: GeminiOptions) {
    this.label = `${options.model} (Gemini)`;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async complete({ system, messages, tools }: LlmRequest): Promise<AssistantTurn> {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map(toContent),
      tools: [{ functionDeclarations: tools }],
    });

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetch(`${BASE_URL}/${this.options.model}:generateContent`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.options.apiKey,
          },
          body,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? TIMEOUT_MS),
        });
      } catch (error) {
        // A stalled or dropped connection is retried like a 503, so one hang cannot stop a run.
        if (attempt === MAX_RETRIES) {
          throw new Error(`Gemini request failed: ${(error as Error).name}`);
        }
        await this.sleep(2_000 * 2 ** attempt);
        continue;
      }

      if (response.ok) {
        const { candidates } = (await response.json()) as {
          candidates?: { content: GeminiContent }[];
        };
        const content = candidates?.[0]?.content;
        if (!content) throw new Error('Gemini returned no candidates');
        return toTurn(content);
      }

      if (!RETRYABLE.has(response.status) || attempt === MAX_RETRIES) {
        throw new Error(await errorMessage(response));
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      await this.sleep(retryAfter > 0 ? retryAfter * 1_000 : 2_000 * 2 ** attempt);
    }
  }
}
