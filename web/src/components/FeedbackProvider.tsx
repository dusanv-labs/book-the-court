import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/context';
import { FeedbackContext, type ConfirmOptions, type ToastKind } from '../lib/feedback-context';
import { Button } from './ui';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/** Toast notifications (bottom of the screen) and a styled confirmation dialog. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { m } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, message, kind }]); // show at most 3 at once
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const close = (result: boolean) => {
    pending?.resolve(result);
    setPending(null);
  };

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
              t.kind === 'error' ? 'bg-red-700 text-white' : 'bg-slate-900 text-white'
            }`}
          >
            <span aria-hidden="true">{t.kind === 'error' ? '⚠' : '✓'}</span>
            {t.message}
          </div>
        ))}
      </div>
      {pending && <ConfirmDialog options={pending} onClose={close} cancelFallback={m.common.cancel} confirmFallback={m.common.confirm} />}
    </FeedbackContext.Provider>
  );
}

function ConfirmDialog({
  options,
  onClose,
  cancelFallback,
  confirmFallback,
}: {
  options: ConfirmOptions;
  onClose: (result: boolean) => void;
  cancelFallback: string;
  confirmFallback: string;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => onClose(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-bold">
          {options.title}
        </h2>
        {options.text && <p className="mt-2 text-sm text-slate-600">{options.text}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onClose(false)}>
            {options.cancelLabel ?? cancelFallback}
          </Button>
          <Button
            ref={confirmRef}
            className={options.danger ? '!bg-red-600 hover:!bg-red-700' : ''}
            onClick={() => onClose(true)}
          >
            {options.confirmLabel ?? confirmFallback}
          </Button>
        </div>
      </div>
    </div>
  );
}
