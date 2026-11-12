import type Anthropic from '@anthropic-ai/sdk';
import { ConflictException } from '@nestjs/common';
import { z } from 'zod';
import { type AgentEvents, type AssistantLlm, defineTool, runAgent, toApiTool, type UsageTotals } from './agent.js';
import { timeOfDaySchema } from './domain/conversation.js';

/**
 * A fake model that returns prepared responses in order and records every request.
 * Text is "streamed" in two pieces per text block, like the real stream sends it in small pieces.
 */
function scriptedLlm(...responses: Partial<Anthropic.Message>[]) {
  const requests: Anthropic.MessageStreamParams[] = [];
  const llm: AssistantLlm = {
    streamMessage: async (params, { onText }) => {
      requests.push(structuredClone(params));
      const next = responses.shift();
      if (!next) throw new Error('No more scripted responses');
      for (const block of next.content ?? []) {
        if (block.type !== 'text') continue;
        const half = Math.ceil(block.text.length / 2);
        onText?.(block.text.slice(0, half));
        onText?.(block.text.slice(half));
      }
      return {
        id: 'msg',
        type: 'message',
        role: 'assistant',
        model: params.model,
        stop_reason: 'end_turn',
        content: [],
        usage: { input_tokens: 1000, output_tokens: 100 },
        ...next,
      } as Anthropic.Message;
    },
  };
  return { llm, requests };
}

const text = (t: string) => ({ type: 'text', text: t, citations: null }) as Anthropic.TextBlock;
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input }) as Anthropic.ToolUseBlock;
const newUsage = (): UsageTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0 });

const echo = defineTool({
  name: 'echo',
  description: 'Echoes a time',
  input: z.object({ at: timeOfDaySchema }),
  run: async ({ at }) => ({ minute: at }),
});
const busy = defineTool({
  name: 'busy',
  description: 'Always conflicts',
  input: z.object({}),
  run: async () => {
    throw new ConflictException('This court is already booked at that time.');
  },
});

const ask = (llm: AssistantLlm, usage = newUsage(), events?: AgentEvents) =>
  runAgent({
    llm,
    model: 'claude-haiku-5-5',
    system: [{ type: 'text', text: 'test' }],
    tools: [echo, busy],
    usage,
    events,
    messages: [{ role: 'user', content: 'hi' }],
  });

describe('runAgent', () => {
  it('runs the requested tools, sends all results back in one message and returns the final text', async () => {
    const { llm, requests } = scriptedLlm(
      {
        stop_reason: 'tool_use',
        content: [text('Padel costs 3200 RSD.'), toolUse('t1', 'echo', { at: '18:30' }), toolUse('t2', 'busy', {})],
      },
      { content: [text('Done.')] },
    );
    const usage = newUsage();
    // Text written before the tool calls is part of the answer too.
    expect(await ask(llm, usage)).toEqual({ text: 'Padel costs 3200 RSD.\n\nDone.', outcome: 'done' });

    const results = requests[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(results).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: '{"minute":1110}' },
      { type: 'tool_result', tool_use_id: 't2', content: 'This court is already booked at that time.', is_error: true },
    ]);
    // The assistant turn is sent back unchanged before the results.
    expect(requests[1].messages.at(-2)).toEqual({ role: 'assistant', content: expect.any(Array) });
    expect(usage).toEqual({ calls: 2, inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 2 * (100 + 50) });
  });

  it('streams the text of every round in order and reports each tool before it runs', async () => {
    const { llm } = scriptedLlm(
      { stop_reason: 'tool_use', content: [text('Let me check.'), toolUse('t1', 'echo', { at: '18:30' })] },
      { content: [text('Padel is free at 18:30.')] },
    );
    const events: string[] = [];
    const result = await ask(llm, newUsage(), {
      onText: (delta) => events.push(`text:${delta}`),
      onTool: (name) => events.push(`tool:${name}`),
    });
    expect(events).toEqual([
      'text:Let me ',
      'text:check.',
      'tool:echo',
      'text:\n\n',
      'text:Padel is fre',
      'text:e at 18:30.',
    ]);
    // The streamed pieces add up to the final answer.
    expect(events.filter((e) => e.startsWith('text:')).map((e) => e.slice(5)).join('')).toBe(result.text);
  });

  it('counts prompt cache reads and writes in the usage and the cost', async () => {
    const { llm } = scriptedLlm({
      content: [text('Hi!')],
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0 } as Anthropic.Usage,
    }, {
      content: [text('Hi again!')],
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 } as Anthropic.Usage,
    });
    const first = newUsage();
    const second = newUsage();
    await ask(llm, first);
    await ask(llm, second);
    expect(first).toMatchObject({ cacheWriteTokens: 2000, cacheReadTokens: 0 });
    expect(second).toMatchObject({ cacheWriteTokens: 0, cacheReadTokens: 2000 });
    // Haiku 5.5: reading the cached prompt costs a tenth of writing it fresh.
    expect(second.costMicroUsd).toBeLessThan(first.costMicroUsd / 5);
  });

  it('stops before the next model call when the visitor has left', async () => {
    const abort = new AbortController();
    const { llm, requests } = scriptedLlm(
      { stop_reason: 'tool_use', content: [toolUse('t1', 'echo', { at: '18:30' })] },
      { content: [text('never sent')] },
    );
    const run = ask(llm, newUsage(), { signal: abort.signal, onTool: () => abort.abort() });
    await expect(run).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it('returns invalid input and unknown tools to the model as errors instead of failing', async () => {
    const { llm, requests } = scriptedLlm(
      { stop_reason: 'tool_use', content: [toolUse('t1', 'echo', { at: '7pm' }), toolUse('t2', 'drop_tables', {})] },
      { content: [text('Sorry.')] },
    );
    await ask(llm);
    const [invalid, unknown] = requests[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(invalid).toMatchObject({ is_error: true, content: expect.stringContaining('at: Expected time as HH:MM') });
    expect(unknown).toMatchObject({ is_error: true, content: 'Unknown tool "drop_tables".' });
  });

  it('stops on refusal and on too many tool rounds', async () => {
    expect(await ask(scriptedLlm({ stop_reason: 'refusal', content: [] }).llm)).toEqual({ text: '', outcome: 'refusal' });

    const loop = Array.from({ length: 6 }, (_, i) => ({ stop_reason: 'tool_use' as const, content: [toolUse(`t${i}`, 'echo', { at: '10:00' })] }));
    expect(await ask(scriptedLlm(...loop).llm)).toEqual({ text: '', outcome: 'too_many_rounds' });
  });

  it('asks for low effort and describes tools with JSON Schema from the Zod schemas', async () => {
    const { llm, requests } = scriptedLlm({ content: [text('Hi!')] });
    await ask(llm);
    expect(requests[0].output_config).toEqual({ effort: 'low' });
    expect(requests[0].tools![0]).toEqual(toApiTool(echo));
    expect(toApiTool(echo).input_schema).toMatchObject({
      type: 'object',
      properties: { at: { type: 'string' } },
      required: ['at'],
    });
    expect(toApiTool(echo).input_schema).not.toHaveProperty('$schema');
  });
});
