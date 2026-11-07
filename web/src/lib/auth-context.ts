import { createContext, useContext } from 'react';

export interface AuthState {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Admin token; only use inside AdminLayout, which guarantees a logged-in user. */
export function useAdminToken(): string {
  return useAuth().token ?? '';
}

/** Private link for managing a booking (hash routing, works on static hosting). */
export function manageUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}#/manage/${token}`;
}
