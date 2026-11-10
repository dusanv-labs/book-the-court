/** Price per million tokens in USD (Claude API list prices, prompts up to 100K tokens). */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};
/** Unknown models are counted at the highest price above, so the budget is never underestimated. */
const FALLBACK = PRICES['claude-opus-5-5'];

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Estimated cost of one API response in millionths of a dollar (cache writes 1.25x, cache reads 0.1x input). */
export function estimateCostMicroUsd(model: string, usage: TokenUsage): number {
  const price = PRICES[model] ?? FALLBACK;
  const input =
    usage.input_tokens + 1.25 * (usage.cache_creation_input_tokens ?? 0) + 0.1 * (usage.cache_read_input_tokens ?? 0);
  // Price per 1M tokens in USD equals price per token in micro-USD.
  return Math.ceil(input * price.input + usage.output_tokens * price.output);
}
