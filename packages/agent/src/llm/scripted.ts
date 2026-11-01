import type { AssistantTurn } from '../types.js';
import type { LlmClient, LlmRequest } from './client.js';

/** Plays back fixed turns, so tests and CI can run the real loop with no model or key. */
export class ScriptedLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private readonly turns: AssistantTurn[];

  constructor(turns: AssistantTurn[]) {
    this.turns = [...turns];
  }

  async complete(request: LlmRequest) {
    this.requests.push({ ...request, messages: [...request.messages] });
    const turn = this.turns.shift();
    if (!turn) throw new Error('script ran out of turns');
    return turn;
  }
}
