import type Anthropic from '@anthropic-ai/sdk';
import { ConflictException } from '@nestjs/common';
import { z } from 'zod';
import { type AssistantLlm, defineTool, runAgent, toApiTool, type UsageTotals } from './agent.js';
import { timeOfDaySchema } from './domain/conversation.js';

/** A fake model that returns prepared responses in order and records every request. */
function scriptedLlm(...responses: Partial<Anthropic.Message>[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const llm: AssistantLlm = {
    createMessage: async (params) => {
      requests.push(structuredClone(params));
      const next = responses.shift();
      if (!next) throw new Error('No more scripted responses');
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
const newUsage = (): UsageTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 });

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

const ask = (llm: AssistantLlm, usage = newUsage()) =>
  runAgent({ llm, model: 'claude-haiku-5-5', system: 'test', tools: [echo, busy], usage, messages: [{ role: 'user', content: 'hi' }] });

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
    expect(usage).toEqual({ calls: 2, inputTokens: 2000, outputTokens: 200, costMicroUsd: 2 * (100 + 50) });
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
