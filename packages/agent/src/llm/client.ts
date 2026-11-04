import type { AssistantTurn, Message, ToolDefinition } from '../types.js';

export interface LlmRequest {
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
}

export interface LlmClient {
  /** The model and provider, for logs and results. */
  label?: string;
  complete: (request: LlmRequest) => Promise<AssistantTurn>;
}
