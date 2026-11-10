import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n/context';
import { api, ApiError } from '../lib/api';
import { formatDayOf, formatPrice } from '../lib/time';
import type { AssistantSuggestion, Availability, AvailabilityCourt, BookingResult } from '../lib/types';
import { BookingDialog } from './BookingDialog';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: AssistantSuggestion[];
  /** Shown in the chat but not sent to the model (errors, notices). */
  local?: boolean;
}

/** Mirror the API limits (12 messages per conversation, 500 characters per question, 2000 per reply). */
const MAX_MESSAGES = 12;
const MAX_CHARS = 500;
const MAX_REPLY_CHARS = 2000;

/**
 * The model only sees the text of its earlier replies, not the tool results behind them, so a short
 * note about the cards it showed goes along with the reply. It stays factual and within the API limit.
 */
function withShownCards(content: string, suggestions?: AssistantSuggestion[]): string {
  if (!suggestions?.length) return content;
  const cards = suggestions
    .map((s) => `${s.courtName} (${s.sport}, ${s.indoor ? 'indoor' : 'outdoor'}) ${s.date} ${s.startTime}-${s.endTime}, ${s.price} ${s.currency}`)
    .join('; ');
  const note = `\n\n[Cards shown: ${cards}]`;
  return content.slice(0, MAX_REPLY_CHARS - note.length) + note;
}

function SparkIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"
      />
    </svg>
  );
}

/**
 * Floating AI booking assistant. The browser keeps the conversation and sends it with every question;
 * suggested times open the normal booking dialog, so the visitor always confirms the booking themselves.
 */
export function AssistantWidget({ onBooked }: { onBooked: (result: BookingResult) => void }) {
  const { m, lang } = useI18n();
  const t = m.assistant;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    data: Availability;
    court: AvailabilityCourt;
    slotIndex: number;
    duration: number;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const status = useQuery({ queryKey: ['assistant-status'], queryFn: api.assistantStatus, staleTime: 5 * 60_000 });

  const chat = useMutation({
    mutationFn: (history: ChatMessage[]) =>
      api.assistantChat({
        language: lang,
        messages: history.filter((msg) => !msg.local).map(({ role, content, suggestions }) => ({
          role,
          content: withShownCards(content, suggestions),
        })),
      }),
    onSuccess: (reply) =>
      setMessages((prev) => [...prev, { role: 'assistant', content: reply.reply, suggestions: reply.suggestions }]),
    onError: (error, history) => {
      // The unanswered question is dropped from what the model sees, so the conversation stays valid.
      const asked = history.at(-1);
      setMessages((prev) => [
        ...prev.slice(0, -1),
        ...(asked ? [{ ...asked, local: true }] : []),
        { role: 'assistant', content: errorMessage(error), local: true },
      ]);
      if (error instanceof ApiError && error.code === 'DAILY_LIMIT') void status.refetch();
    },
  });

  function errorMessage(error: unknown): string {
    if (!(error instanceof ApiError)) return t.errors.generic;
    if (error.code === 'DAILY_LIMIT' || error.code === 'IP_LIMIT' || error.code === 'UNAVAILABLE') return t.errors[error.code];
    if (error.status === 0) return t.errors.network;
    if (error.status === 429) return t.errors.tooMany;
    return t.errors.generic;
  }

  const sent = messages.filter((msg) => !msg.local).length;
  const tooLong = sent >= MAX_MESSAGES - 1;
  const unavailable = status.data && !status.data.available;

  // A new reply is shown from its first line (the cards follow below); anything else scrolls to the end.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const last = [...list.querySelectorAll<HTMLElement>('[data-message]')].at(-1);
    const top = !chat.isPending && last?.dataset.message === 'assistant' ? last.offsetTop - 16 : list.scrollHeight;
    list.scrollTo({ top, behavior: 'smooth' });
  }, [messages, chat.isPending]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selection) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, selection]);

  if (!status.data?.enabled) return null;

  function ask(text: string) {
    const question = text.trim().slice(0, MAX_CHARS);
    if (!question || chat.isPending || tooLong) return;
    // Only messages the model has seen are sent; local notices stay on screen only.
    const history: ChatMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(history);
    setDraft('');
    chat.mutate(history);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    ask(draft);
  }

  async function book(s: AssistantSuggestion) {
    const key = `${s.courtId}-${s.startsAt}`;
    setOpening(key);
    try {
      const data = await queryClient.fetchQuery({
        queryKey: ['availability', s.date, s.sport],
        queryFn: () => api.availability(s.date, s.sport),
        staleTime: 0,
      });
      const court = data.courts.find((c) => c.id === s.courtId);
      const slotIndex =
        court?.slots.findIndex((slot) => Date.parse(slot.startsAt) === Date.parse(s.startsAt) && slot.status === 'free') ?? -1;
      if (!court || slotIndex < 0) {
        setMessages((prev) => [...prev, { role: 'assistant', content: t.errors.taken, local: true }]);
        return;
      }
      setSelection({ data, court, slotIndex, duration: s.durationMinutes });
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'assistant', content: errorMessage(error), local: true }]);
    } finally {
      setOpening(null);
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-4 z-40 inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 print:hidden"
        >
          <SparkIcon />
          {t.open}
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label={t.title}
          className="fixed inset-x-2 bottom-2 z-40 flex h-[min(36rem,calc(100dvh-1rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[24rem] print:hidden"
        >
          <header className="flex items-center gap-3 border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
            <SparkIcon className="h-5 w-5 text-emerald-300" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">{t.title}</h2>
              <p className="text-xs text-slate-300">{t.badge}</p>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                disabled={chat.isPending}
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                {t.newChat}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t.close}
              className="rounded-md p-1 text-slate-200 hover:bg-white/10"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          <div ref={listRef} className="relative flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4" aria-live="polite">
            <Bubble role="assistant">{t.intro}</Bubble>
            {messages.length === 0 && !unavailable && (
              <div className="flex flex-col items-start gap-2">
                {t.examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => ask(example)}
                    className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-left text-sm text-emerald-800 hover:bg-emerald-50"
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} data-message={msg.role} className="space-y-2">
                <Bubble role={msg.role} muted={msg.local && msg.role === 'assistant'}>
                  {msg.content}
                </Bubble>
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <ul className="space-y-2">
                    {msg.suggestions.map((s) => {
                      const key = `${s.courtId}-${s.startsAt}`;
                      return (
                        <li key={key} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                          <div className="min-w-0 flex-1 text-sm">
                            <p className="font-semibold text-slate-900">
                              {s.startTime}–{s.endTime} · {s.courtName}
                            </p>
                            <p className="text-slate-600">
                              {formatDayOf(s.startsAt, undefined, m.locale)} · {m.sports[s.sport]} ·{' '}
                              {s.indoor ? m.common.indoor : m.common.outdoor}
                            </p>
                            <p className="text-slate-600">
                              {s.durationMinutes} {m.common.min} · <span className="font-medium text-slate-900">{formatPrice(s.price, s.currency)}</span>
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void book(s)}
                            disabled={opening !== null}
                            aria-label={`${t.book}: ${s.courtName}, ${s.startTime}`}
                            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-emerald-300"
                          >
                            {opening === key ? t.opening : t.book}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
            {chat.isPending && (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                {t.thinking}
              </p>
            )}
            {unavailable && <Bubble role="assistant" muted>{t.errors.DAILY_LIMIT}</Bubble>}
            {tooLong && <p className="text-center text-xs text-slate-500">{t.tooLong}</p>}
          </div>

          <form onSubmit={submit} className="border-t border-slate-200 bg-white p-3">
            <div className="flex items-end gap-2">
              <label className="sr-only" htmlFor="assistant-input">
                {t.placeholder}
              </label>
              <textarea
                id="assistant-input"
                ref={inputRef}
                rows={1}
                value={draft}
                maxLength={MAX_CHARS}
                disabled={unavailable || tooLong}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    ask(draft);
                  }
                }}
                placeholder={t.placeholder}
                className="max-h-28 min-h-10 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 disabled:bg-slate-100"
              />
              <button
                type="submit"
                disabled={!draft.trim() || chat.isPending || unavailable || tooLong}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-300"
              >
                {t.send}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-slate-500">{t.disclaimer}</p>
          </form>
        </section>
      )}

      {selection && (
        <BookingDialog
          data={selection.data}
          court={selection.court}
          slotIndex={selection.slotIndex}
          initialDuration={selection.duration}
          rememberable
          onClose={() => setSelection(null)}
          onBooked={(result) => {
            setSelection(null);
            setOpen(false);
            onBooked(result);
          }}
          onConflict={() => {
            setSelection(null);
            setMessages((prev) => [...prev, { role: 'assistant', content: t.errors.taken, local: true }]);
          }}
        />
      )}
    </>
  );
}

function Bubble({ role, muted = false, children }: { role: 'user' | 'assistant'; muted?: boolean; children: string }) {
  const { m } = useI18n();
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-600 px-3 py-2 text-sm whitespace-pre-wrap text-white">
          <span className="sr-only">{m.assistant.you}: </span>
          {children}
        </p>
      </div>
    );
  }
  return (
    <p
      className={`max-w-[90%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap ${
        muted ? 'border border-amber-200 bg-amber-50 text-amber-900' : 'border border-slate-200 bg-white text-slate-800'
      }`}
    >
      {children}
    </p>
  );
}
