import type Anthropic from '@anthropic-ai/sdk';
import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { estimateCostMicroUsd } from './domain/cost.js';

/** The part of the Anthropic client the assistant uses; replaced by a scripted fake in tests. */
export interface AssistantLlm {
  createMessage(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

/** A tool the model can call. Input is validated with the same Zod schema that describes it to the model. */
export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  run(input: z.output<S>): Promise<unknown>;
}

export function defineTool<S extends z.ZodType>(tool: AgentTool<S>): AgentTool {
  return tool as unknown as AgentTool;
}

export function toApiTool(tool: AgentTool): Anthropic.Tool {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.input, { io: 'input' }) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, input_schema: schema as Anthropic.Tool.InputSchema };
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

export interface AgentResult {
  text: string;
  /** Why the run ended: the model finished, refused, ran out of tokens, or used too many tool rounds. */
  outcome: 'done' | 'refusal' | 'max_tokens' | 'too_many_rounds';
}

/**
 * Runs the tool-use loop: ask the model, run the tools it asks for, send the results back,
 * until it answers in text. `usage` is updated after every call, so the caller can record
 * what was spent even when a later call fails.
 */
export async function runAgent(params: {
  llm: AssistantLlm;
  model: string;
  system: string;
  tools: AgentTool[];
  messages: Anthropic.MessageParam[];
  usage: UsageTotals;
  maxRounds?: number;
  maxTokens?: number;
}): Promise<AgentResult> {
  const { llm, model, system, tools, usage } = params;
  const messages = [...params.messages];
  const apiTools = tools.map(toApiTool);
  const byName = new Map(tools.map((t) => [t.name, t]));
  // The model may write part of its answer before a tool call, so text from every round is kept.
  const parts: string[] = [];
  const answer = () => parts.join('\n\n');

  for (let round = 0; round < (params.maxRounds ?? 6); round++) {
    const message = await llm.createMessage({
      model,
      max_tokens: params.maxTokens ?? 4096,
      system,
      tools: apiTools,
      messages,
      // Short chat answers and simple tool calls do not need deep reasoning.
      output_config: { effort: 'low' },
    });
    usage.calls++;
    usage.inputTokens += message.usage.input_tokens;
    usage.outputTokens += message.usage.output_tokens;
    usage.costMicroUsd += estimateCostMicroUsd(model, message.usage);

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) parts.push(text);

    if (message.stop_reason === 'refusal') return { text: '', outcome: 'refusal' };
    if (message.stop_reason === 'max_tokens') return { text: answer(), outcome: 'max_tokens' };

    const toolCalls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (message.stop_reason !== 'tool_use' || toolCalls.length === 0) return { text: answer(), outcome: 'done' };

    // The assistant turn goes back unchanged (including thinking blocks), followed by all results in one message.
    messages.push({ role: 'assistant', content: message.content });
    const results = await Promise.all(toolCalls.map((call) => runTool(byName.get(call.name), call)));
    messages.push({ role: 'user', content: results });
  }
  return { text: '', outcome: 'too_many_rounds' };
}

async function runTool(tool: AgentTool | undefined, call: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
  const result = (content: string, isError = false): Anthropic.ToolResultBlockParam => ({
    type: 'tool_result',
    tool_use_id: call.id,
    content,
    ...(isError ? { is_error: true } : {}),
  });
  if (!tool) return result(`Unknown tool "${call.name}".`, true);

  const input = tool.input.safeParse(call.input);
  if (!input.success) {
    return result(`Invalid input: ${input.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`, true);
  }
  try {
    return result(JSON.stringify(await tool.run(input.data)));
  } catch (e) {
    // Expected business errors (closed day, already booked, ...) go back to the model; anything else is a bug.
    if (e instanceof HttpException) return result(e.message, true);
    throw e;
  }
}
