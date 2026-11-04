import type { LlmClient } from './client.js';
import { GeminiClient } from './gemini.js';
import { OllamaClient } from './ollama.js';

type Env = Record<string, string | undefined>;

/**
 * Picks the model from the environment. LLM_PROVIDER=ollama runs a local model for free;
 * otherwise Gemini is used when GEMINI_API_KEY is set. Returns null when neither is configured.
 */
export function createLlmFromEnv(env: Env = process.env): (LlmClient & { label: string }) | null {
  const provider = env.LLM_PROVIDER ?? (env.GEMINI_API_KEY ? 'gemini' : undefined);
  if (provider === undefined) return null;

  if (provider === 'ollama') {
    return new OllamaClient({
      baseUrl: env.OLLAMA_URL ?? 'http://localhost:11434',
      model: env.OLLAMA_MODEL ?? 'granite4:tiny-h',
    });
  }
  if (provider === 'gemini' && env.GEMINI_API_KEY) {
    return new GeminiClient({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL ?? 'gemini-3.6-flash',
    });
  }
  throw new Error('LLM_PROVIDER must be ollama, or gemini with GEMINI_API_KEY set');
}
