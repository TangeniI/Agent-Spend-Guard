import type { LlmClient } from './llm/client.js';
import type { AgentResult, AgentStep, Message, Tool, ToolCall } from './types.js';

const DEFAULT_MAX_STEPS = 10;

export interface RunAgentOptions {
  llm: LlmClient;
  system: string;
  task: string;
  tools: Tool[];
  maxSteps?: number;
  onStep?: (step: AgentStep) => Promise<void>;
}

async function execute(tools: Tool[], call: ToolCall) {
  const tool = tools.find((t) => t.definition.name === call.name);
  if (!tool) return { error: `unknown tool: ${call.name}` };
  try {
    return await tool.execute(call.args);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const { llm, system, task, tools, maxSteps = DEFAULT_MAX_STEPS, onStep } = options;
  const definitions = tools.map((tool) => tool.definition);
  const messages: Message[] = [{ role: 'user', text: task }];

  for (let step = 0; step < maxSteps; step += 1) {
    const turn = await llm.complete({ system, messages, tools: definitions });
    await onStep?.({ type: 'model', text: turn.text, toolCalls: turn.toolCalls });
    messages.push({ role: 'assistant', turn });

    if (turn.toolCalls.length === 0) return { status: 'completed', result: turn.text };

    const results = [];
    for (const call of turn.toolCalls) {
      const output = await execute(tools, call);
      await onStep?.({ type: 'tool', name: call.name, args: call.args, output });
      results.push({ id: call.id, name: call.name, output });
    }
    messages.push({ role: 'tool', results });
  }

  return { status: 'failed', error: `step limit of ${maxSteps} reached` };
}
