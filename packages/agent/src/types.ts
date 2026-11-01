export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  output: unknown;
}

export interface AssistantTurn {
  text: string;
  toolCalls: ToolCall[];
  /** The provider's own record of the turn, sent back unchanged. */
  providerData?: unknown;
}

export type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; turn: AssistantTurn }
  | { role: 'tool'; results: ToolResult[] };

export interface Tool {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export type AgentStep =
  | { type: 'model'; text: string; toolCalls: ToolCall[] }
  | { type: 'tool'; name: string; args: Record<string, unknown>; output: unknown };

export type AgentResult =
  | { status: 'completed'; result: string }
  | { status: 'failed'; error: string };
