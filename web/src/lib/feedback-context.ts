import { createContext, useContext } from 'react';

export type ToastKind = 'success' | 'error';

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface FeedbackState {
  toast: (message: string, kind?: ToastKind) => void;
  /** Opens a confirmation dialog and resolves to true when the user confirms. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

export const FeedbackContext = createContext<FeedbackState>({
  toast: () => {},
  confirm: async () => false,
});

export function useFeedback(): FeedbackState {
  return useContext(FeedbackContext);
}
