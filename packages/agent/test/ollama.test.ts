import { describe, expect, it, vi } from 'vitest';
import { createLlmFromEnv, GeminiClient, OllamaClient, type LlmRequest } from '../src/index.js';

const request: LlmRequest = {
  system: 'You are a shopper.',
  messages: [{ role: 'user', text: 'Buy a case.' }],
  tools: [{ name: 'read_page', description: 'Read', parameters: { type: 'object' } }],
};

const reply = (message: object) => new Response(JSON.stringify({ message }));

function client(...responses: (Response | Error)[]) {
  const fetcher = vi.fn(async () => {
    const next = responses.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  const ollama = new OllamaClient({
    baseUrl: 'http://ollama.test:11434',
    model: 'granite4:tiny-h',
    fetch: fetcher as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return { ollama, fetcher };
}

const sentBody = (fetcher: ReturnType<typeof client>['fetcher'], call = 0) =>
  JSON.parse((fetcher.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);

describe('OllamaClient', () => {
  it('sends a deterministic, non-streaming chat with the tools', async () => {
    const { ollama, fetcher } = client(reply({ role: 'assistant', content: 'hi' }));
    await ollama.complete(request);

    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toBe('http://ollama.test:11434/api/chat');
    expect(sentBody(fetcher)).toMatchObject({
      model: 'granite4:tiny-h',
      stream: false,
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: 'You are a shopper.' },
        { role: 'user', content: 'Buy a case.' },
      ],
      tools: [{ type: 'function', function: request.tools[0] }],
    });
  });

  it('reads text and tool calls, including string arguments', async () => {
    const { ollama } = client(
      reply({
        role: 'assistant',
        content: 'Looking.',
        tool_calls: [
          { id: 'c1', function: { name: 'read_page', arguments: { url: '/' } } },
          { function: { name: 'read_page', arguments: '{"url":"/a"}' } },
          { function: { name: 'read_page', arguments: 'not json' } },
        ],
      }),
    );

    const turn = await ollama.complete(request);

    expect(turn.text).toBe('Looking.');
    expect(turn.toolCalls).toEqual([
      { id: 'c1', name: 'read_page', args: { url: '/' } },
      { id: 'local-1', name: 'read_page', args: { url: '/a' } },
      { id: 'local-2', name: 'read_page', args: {} },
    ]);
  });

  it('sends the assistant turn back and tool results as tool messages', async () => {
    const message = {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'read_page', arguments: { url: '/' } } }],
    };
    const { ollama, fetcher } = client(reply(message), reply({ role: 'assistant', content: 'ok' }));

    const turn = await ollama.complete(request);
    await ollama.complete({
      ...request,
      messages: [
        ...request.messages,
        { role: 'assistant', turn },
        { role: 'tool', results: [{ id: 'local-0', name: 'read_page', output: { content: 'x' } }] },
      ],
    });

    expect(sentBody(fetcher, 1).messages.slice(2)).toEqual([
      message,
      { role: 'tool', tool_name: 'read_page', content: '{"content":"x"}' },
    ]);
  });

  it('treats a reply with no message as empty', async () => {
    const { ollama } = client(new Response('{}'));
    expect(await ollama.complete(request)).toMatchObject({ text: '', toolCalls: [] });
  });

  it('retries a dropped connection and a 5xx', async () => {
    const { ollama, fetcher } = client(
      new TypeError('fetch failed'),
      new Response('busy', { status: 503 }),
      reply({ role: 'assistant', content: 'ok' }),
    );
    expect((await ollama.complete(request)).text).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('gives up after repeated failures', async () => {
    const { ollama } = client(...Array.from({ length: 4 }, () => new TypeError('fetch failed')));
    await expect(ollama.complete(request)).rejects.toThrow('Ollama request failed: TypeError');
  });

  it('reports a client error without retrying', async () => {
    const body = JSON.stringify({ error: 'model "nope" not found' });
    const { ollama, fetcher } = client(new Response(body, { status: 404 }));
    await expect(ollama.complete(request)).rejects.toThrow(
      'Ollama request failed: 404 model "nope" not found',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('copes with an error body that is not JSON', async () => {
    const { ollama } = client(new Response('nope', { status: 400 }));
    await expect(ollama.complete(request)).rejects.toThrow('Ollama request failed: 400');
  });
});

describe('createLlmFromEnv', () => {
  it('builds an Ollama client when asked', () => {
    expect(createLlmFromEnv({ LLM_PROVIDER: 'ollama' })).toBeInstanceOf(OllamaClient);
  });

  it('builds a Gemini client when a key is set', () => {
    expect(createLlmFromEnv({ GEMINI_API_KEY: 'k' })).toBeInstanceOf(GeminiClient);
  });

  it('returns null when nothing is configured', () => {
    expect(createLlmFromEnv({})).toBeNull();
  });

  it('refuses an unknown provider', () => {
    expect(() => createLlmFromEnv({ LLM_PROVIDER: 'other' })).toThrow('LLM_PROVIDER');
  });

  it('describes the model it chose', () => {
    expect(createLlmFromEnv({ LLM_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen3.5:4b' })?.label).toBe(
      'qwen3.5:4b (Ollama, local)',
    );
    expect(createLlmFromEnv({ GEMINI_API_KEY: 'k' })?.label).toBe('gemini-3.6-flash (Gemini)');
  });
});
