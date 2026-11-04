import { describe, expect, it, vi } from 'vitest';
import { GeminiClient, type LlmRequest } from '../src/index.js';

const request: LlmRequest = {
  system: 'You are a shopper.',
  messages: [{ role: 'user', text: 'Buy a case.' }],
  tools: [{ name: 'read_page', description: 'Read', parameters: { type: 'object' } }],
};

const reply = (parts: object[]) =>
  new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }));

function client(...responses: Response[]) {
  const fetcher = vi.fn(async () => responses.shift()!);
  const sleep = vi.fn(async () => undefined);
  const gemini = new GeminiClient({
    apiKey: 'test-key',
    model: 'test-model',
    fetch: fetcher as unknown as typeof fetch,
    sleep,
  });
  return { gemini, fetcher, sleep };
}

const sentBody = (fetcher: ReturnType<typeof client>['fetcher'], call = 0) =>
  JSON.parse((fetcher.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);

describe('GeminiClient', () => {
  it('sends the key in a header, never in the URL', async () => {
    const { gemini, fetcher } = client(reply([{ text: 'hi' }]));
    await gemini.complete(request);

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent',
    );
    expect(url).not.toContain('test-key');
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
  });

  it('sends the system prompt, messages and tools', async () => {
    const { gemini, fetcher } = client(reply([{ text: 'hi' }]));
    await gemini.complete(request);

    expect(sentBody(fetcher)).toEqual({
      systemInstruction: { parts: [{ text: 'You are a shopper.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Buy a case.' }] }],
      tools: [{ functionDeclarations: request.tools }],
    });
  });

  it('reads text and function calls from the reply', async () => {
    const { gemini } = client(
      reply([
        { text: 'Looking. ' },
        { text: 'One moment.' },
        { functionCall: { id: 'c1', name: 'read_page', args: { url: '/' } } },
        { functionCall: { name: 'read_page', args: { url: '/a' } } },
        { functionCall: { name: 'read_page' } },
      ]),
    );

    const turn = await gemini.complete(request);

    expect(turn.text).toBe('Looking. One moment.');
    expect(turn.toolCalls).toEqual([
      { id: 'c1', name: 'read_page', args: { url: '/' } },
      { id: 'local-3', name: 'read_page', args: { url: '/a' } },
      { id: 'local-4', name: 'read_page', args: {} },
    ]);
  });

  it('keeps private reasoning out of the visible text', async () => {
    const { gemini } = client(
      reply([{ text: 'I should read the page.', thought: true }, { text: 'Reading it now.' }]),
    );
    expect((await gemini.complete(request)).text).toBe('Reading it now.');
  });

  it('returns the model turn unchanged, so thought signatures survive', async () => {
    const part = { functionCall: { name: 'read_page', args: {} }, thoughtSignature: 'sig' };
    const { gemini, fetcher } = client(reply([part]), reply([{ text: 'done' }]));

    const turn = await gemini.complete(request);
    await gemini.complete({
      ...request,
      messages: [
        ...request.messages,
        { role: 'assistant', turn },
        {
          role: 'tool',
          results: [
            { id: 'local-0', name: 'read_page', output: { content: 'x' } },
            { id: 'c9', name: 'read_page', output: { content: 'y' } },
          ],
        },
      ],
    });

    expect(sentBody(fetcher, 1).contents.slice(1)).toEqual([
      { role: 'model', parts: [part] },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'read_page', response: { result: { content: 'x' } } } },
          {
            functionResponse: {
              id: 'c9',
              name: 'read_page',
              response: { result: { content: 'y' } },
            },
          },
        ],
      },
    ]);
  });

  it.each([429, 500, 503])('retries a %i with backoff', async (status) => {
    const { gemini, fetcher, sleep } = client(
      new Response('{}', { status }),
      new Response('{}', { status }),
      reply([{ text: 'ok' }]),
    );

    expect((await gemini.complete(request)).text).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[2_000], [4_000]]);
  });

  it('honours Retry-After', async () => {
    const { gemini, sleep } = client(
      new Response('{}', { status: 429, headers: { 'retry-after': '7' } }),
      reply([{ text: 'ok' }]),
    );
    await gemini.complete(request);
    expect(sleep).toHaveBeenCalledWith(7_000);
  });

  it('gives up after repeated failures', async () => {
    const { gemini, fetcher } = client(
      ...Array.from({ length: 4 }, () => new Response('{}', { status: 503 })),
    );
    await expect(gemini.complete(request)).rejects.toThrow('Gemini request failed: 503');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('does not retry a bad request, and reports the reason', async () => {
    const body = JSON.stringify({ error: { message: 'bad schema' } });
    const { gemini, fetcher } = client(new Response(body, { status: 400 }));

    await expect(gemini.complete(request)).rejects.toThrow(
      'Gemini request failed: 400 bad schema',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('copes with an error body that is not JSON', async () => {
    const { gemini } = client(new Response('nope', { status: 400 }));
    await expect(gemini.complete(request)).rejects.toThrow('Gemini request failed: 400');
  });

  it('reports a reply with no candidates', async () => {
    const { gemini } = client(new Response(JSON.stringify({ candidates: [] })));
    await expect(gemini.complete(request)).rejects.toThrow('no candidates');
  });

  it('treats a candidate with no parts as empty', async () => {
    const { gemini } = client(new Response(JSON.stringify({ candidates: [{ content: {} }] })));
    expect(await gemini.complete(request)).toMatchObject({ text: '', toolCalls: [] });
  });

  it('never includes the key in an error', async () => {
    const { gemini } = client(new Response('{}', { status: 403 }));
    await expect(gemini.complete(request)).rejects.not.toThrow('test-key');
  });
});
