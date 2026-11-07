import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setUnauthorizedHandler } from './api';
import { AuthContext } from './auth-context';

const STORAGE_KEY = 'btc_admin_token';

/** Reads the expiry from a JWT payload (no signature check; the API verifies tokens). */
function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return !payload.exp || payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

function readToken(): string | null {
  try {
    const t = sessionStorage.getItem(STORAGE_KEY);
    return t && !isExpired(t) ? t : null;
  } catch {
    return null;
  }
}

// The token is kept in sessionStorage: it is cleared when the browser tab is closed.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readToken);

  const login = useCallback((t: string) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* storage unavailable: keep the token in memory only */
    }
    setToken(t);
  }, []);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const value = useMemo(() => ({ token, login, logout }), [token, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
