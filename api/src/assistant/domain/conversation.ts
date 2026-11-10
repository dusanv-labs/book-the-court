import { z } from 'zod';

/** Limits that keep one conversation small (and cheap). The browser keeps the history and sends it each time. */
export const MAX_MESSAGES = 12;
export const MAX_USER_CHARS = 500;
export const MAX_ASSISTANT_CHARS = 2000;

const messageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.string().trim().min(1).max(MAX_USER_CHARS) }),
  z.object({ role: z.literal('assistant'), content: z.string().trim().min(1).max(MAX_ASSISTANT_CHARS) }),
]);

export const chatRequestSchema = z.object({
  /** Language of the page, used as a hint for the reply language. */
  language: z.enum(['en', 'sr']).default('en'),
  messages: z
    .array(messageSchema)
    .min(1)
    .max(MAX_MESSAGES, `At most ${MAX_MESSAGES} messages per conversation`)
    .refine((m) => m.every((msg, i) => msg.role === (i % 2 === 0 ? 'user' : 'assistant')), {
      message: 'Messages must alternate, starting with the user',
    })
    .refine((m) => m.at(-1)?.role === 'user', { message: 'The last message must be from the user' }),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** "HH:MM" local time, 00:00-24:00. */
export const timeOfDaySchema = z
  .string()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Expected time as HH:MM')
  .transform((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));

export function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
