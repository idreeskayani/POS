import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { BASE, freshToken } from './api';

/** Subscribes to realtime events for one branch, e.g. { 'order:new': fn, 'order:updated': fn }. */
export function useBranchSocket(branchId: string | null, handlers: Record<string, (data: any) => void>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!branchId) return;
    let socket: ReturnType<typeof io> | null = null;
    let cancelled = false;
    (async () => {
      const token = await freshToken();
      if (cancelled || !token) return;
      socket = io(`${BASE}/ws`, { auth: { token }, transports: ['websocket'] });
      socket.on('connect', () => socket!.emit('join:branch', { branchId })); // no-op for branch-level users
      socket.on('disconnect', async (reason) => {
        if (reason === 'io server disconnect' && socket) { // token expired: reconnect with a fresh one
          socket.auth = { token: await freshToken() };
          socket.connect();
        }
      });
      for (const ev of Object.keys(ref.current)) socket.on(ev, (d) => ref.current[ev]?.(d));
    })();
    return () => { cancelled = true; socket?.disconnect(); };
  }, [branchId]);
}
