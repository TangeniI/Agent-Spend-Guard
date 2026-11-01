import { describe, expect, it } from 'vitest';
import { runAgent, ScriptedLlm, type AgentStep, type Tool } from '../src/index.js';

const echo: Tool = {
  definition: { name: 'echo', description: 'Echo', parameters: { type: 'object' } },
  execute: async (args) => ({ echoed: args }),
};

const call = (name: string, args: Record<string, unknown> = {}) => ({
  text: '',
  toolCalls: [{ id: `${name}-1`, name, args }],
});
const done = (text: string) => ({ text, toolCalls: [] });
const base = { system: 'sys', task: 'buy a case', tools: [echo] };

describe('runAgent', () => {
  it('finishes when the model stops calling tools', async () => {
    const result = await runAgent({ ...base, llm: new ScriptedLlm([done('Bought it.')]) });
    expect(result).toEqual({ status: 'completed', result: 'Bought it.' });
  });

  it('passes the task and the system prompt to the model', async () => {
    const llm = new ScriptedLlm([done('ok')]);
    await runAgent({ ...base, llm });
    expect(llm.requests[0]).toMatchObject({
      system: 'sys',
      messages: [{ role: 'user', text: 'buy a case' }],
      tools: [echo.definition],
    });
  });

  it('feeds tool results back to the model', async () => {
    const llm = new ScriptedLlm([call('echo', { a: 1 }), done('ok')]);
    await runAgent({ ...base, llm });
    expect(llm.requests[1]?.messages.at(-1)).toEqual({
      role: 'tool',
      results: [{ id: 'echo-1', name: 'echo', output: { echoed: { a: 1 } } }],
    });
  });

  it('reports every step in order', async () => {
    const steps: AgentStep[] = [];
    const llm = new ScriptedLlm([call('echo', { a: 1 }), done('ok')]);

    await runAgent({ ...base, llm, onStep: async (step) => void steps.push(step) });

    expect(steps.map((s) => s.type)).toEqual(['model', 'tool', 'model']);
    expect(steps[1]).toEqual({
      type: 'tool',
      name: 'echo',
      args: { a: 1 },
      output: { echoed: { a: 1 } },
    });
  });

  it('tells the model about a tool that does not exist', async () => {
    const llm = new ScriptedLlm([call('transfer_money'), done('ok')]);
    await runAgent({ ...base, llm });
    expect(llm.requests[1]?.messages.at(-1)).toMatchObject({
      results: [{ output: { error: 'unknown tool: transfer_money' } }],
    });
  });

  it('returns a tool failure to the model instead of crashing the run', async () => {
    const broken: Tool = {
      definition: { name: 'broken', description: 'x', parameters: {} },
      execute: async () => {
        throw new Error('page unavailable');
      },
    };
    const llm = new ScriptedLlm([call('broken'), done('ok')]);

    const result = await runAgent({ ...base, tools: [broken], llm });

    expect(result.status).toBe('completed');
    expect(llm.requests[1]?.messages.at(-1)).toMatchObject({
      results: [{ output: { error: 'page unavailable' } }],
    });
  });

  it('stops at the step limit', async () => {
    const llm = new ScriptedLlm(Array.from({ length: 5 }, () => call('echo')));

    const result = await runAgent({ ...base, llm, maxSteps: 3 });

    expect(result).toEqual({ status: 'failed', error: 'step limit of 3 reached' });
    expect(llm.requests).toHaveLength(3);
  });

  it('defaults to a limit of 10 steps', async () => {
    const llm = new ScriptedLlm(Array.from({ length: 20 }, () => call('echo')));
    await runAgent({ ...base, llm });
    expect(llm.requests).toHaveLength(10);
  });

  it('surfaces a model failure', async () => {
    await expect(runAgent({ ...base, llm: new ScriptedLlm([]) })).rejects.toThrow('script ran out');
  });
});
