import type {
  AdminBooking,
  Availability,
  Block,
  BookingResult,
  Court,
  ManagedBooking,
  OpeningHours,
  PriceRule,
  Quote,
  Sport,
} from './types';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export class ApiError extends Error {
  readonly status: number;
  readonly messages: string[];

  constructor(status: number, messages: string[]) {
    super(messages.join(' '));
    this.status = status;
    this.messages = messages;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

/** Called when an admin request is rejected with 401, so the app can log out. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function request<T>(path: string, { method = 'GET', body, token }: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, ['Cannot reach the server. Please check your connection and try again.']);
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    const message = (data as { message?: string | string[] } | null)?.message;
    const messages = Array.isArray(message) ? message : [message ?? `Request failed (${res.status})`];
    throw new ApiError(res.status, messages);
  }
  return data as T;
}

const q = (params: Record<string, string | number>) =>
  '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  availability: (date: string, sport: Sport) => request<Availability>(`/availability${q({ date, sport })}`),
  quote: (courtId: string, startsAt: string, durationMinutes: number) =>
    request<Quote>(`/bookings/quote${q({ courtId, startsAt, durationMinutes })}`),
  createBooking: (body: {
    courtId: string;
    startsAt: string;
    durationMinutes: number;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
  }) => request<BookingResult>('/bookings', { method: 'POST', body }),
  manage: (token: string) => request<ManagedBooking>(`/bookings/manage/${encodeURIComponent(token)}`),
  cancel: (token: string) =>
    request<{ status: string }>(`/bookings/manage/${encodeURIComponent(token)}/cancel`, { method: 'POST' }),
  login: (email: string, password: string) =>
    request<{ accessToken: string }>('/auth/login', { method: 'POST', body: { email, password } }),

  admin: (token: string) => ({
    bookings: (date: string) => request<AdminBooking[]>(`/admin/bookings${q({ date })}`, { token }),
    cancelBooking: (id: string) => request<{ status: string }>(`/admin/bookings/${id}/cancel`, { method: 'POST', token }),
    courts: () => request<Court[]>('/admin/courts', { token }),
    createCourt: (body: Omit<Court, 'id'>) => request<Court>('/admin/courts', { method: 'POST', body, token }),
    updateCourt: (id: string, body: Partial<Omit<Court, 'id'>>) =>
      request<Court>(`/admin/courts/${id}`, { method: 'PATCH', body, token }),
    deleteCourt: (id: string) => request<void>(`/admin/courts/${id}`, { method: 'DELETE', token }),
    hours: () => request<OpeningHours[]>('/venue/hours'),
    setHours: (body: OpeningHours[]) => request<OpeningHours[]>('/admin/venue/hours', { method: 'PUT', body, token }),
    prices: () => request<PriceRule[]>('/venue/prices'),
    setPrices: (body: PriceRule[]) => request<PriceRule[]>('/admin/venue/prices', { method: 'PUT', body, token }),
    blocks: (date?: string) => request<Block[]>(`/admin/venue/blocks${date ? q({ date }) : ''}`, { token }),
    createBlock: (body: { courtId: string | null; startsAt: string; endsAt: string; reason: string }) =>
      request<Block>('/admin/venue/blocks', { method: 'POST', body, token }),
    deleteBlock: (id: string) => request<void>(`/admin/venue/blocks/${id}`, { method: 'DELETE', token }),
  }),
};

interface ErrorMessages {
  network: string;
  conflict: string;
  tooMany: string;
  invalidLogin: string;
  generic: string;
}

/** User-facing error text in the current language. Server validation messages are shown as-is. */
export function errorText(error: unknown, m: ErrorMessages): string {
  if (!(error instanceof ApiError)) return m.generic;
  if (error.status === 0) return m.network;
  if (error.status === 409) return m.conflict;
  if (error.status === 429) return m.tooMany;
  if (error.status === 401) return m.invalidLogin;
  if (error.status >= 500) return m.generic;
  return error.messages.join(' ');
}
