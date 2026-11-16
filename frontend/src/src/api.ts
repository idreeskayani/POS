import type { User } from './types';

export const BASE: string = import.meta.env.VITE_API_URL ?? `http://${location.hostname}:3000`;
const KEY = 'pos_auth';

export interface Auth { accessToken: string; refreshToken: string; user: User }
export const getAuth = (): Auth | null => {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
};
export const saveAuth = (a: Auth | null) => (a ? localStorage.setItem(KEY, JSON.stringify(a)) : localStorage.removeItem(KEY));

let refreshing: Promise<string | null> | null = null;
function refreshOnce(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const a = getAuth();
      if (!a) return null;
      const r = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: a.refreshToken }),
      });
      if (!r.ok) { saveAuth(null); location.reload(); return null; }
      const data = await r.json();
      saveAuth({ ...a, accessToken: data.accessToken, refreshToken: data.refreshToken });
      return data.accessToken as string;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** Access token that is valid for at least 30 more seconds (refreshes if needed). */
export async function freshToken(): Promise<string | null> {
  const a = getAuth();
  if (!a) return null;
  try {
    const exp = JSON.parse(atob(a.accessToken.split('.')[1])).exp * 1000;
    if (exp - Date.now() > 30000) return a.accessToken;
  } catch { /* fall through to refresh */ }
  return refreshOnce();
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const call = (token?: string | null) =>
    fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res = await call(getAuth()?.accessToken);
  if (res.status === 401 && getAuth()) {
    const t = await refreshOnce();
    if (t) res = await call(t);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? res.statusText);
  return data as T;
}
