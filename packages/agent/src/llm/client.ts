import type { AssistantTurn, Message, ToolDefinition } from '../types.js';

export interface LlmRequest {
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
}

export interface LlmClient {
  complete: (request: LlmRequest) => Promise<AssistantTurn>;
}
