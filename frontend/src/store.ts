import { configureStore, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { getAuth } from './api';
import type { User } from './types';

const auth = createSlice({
  name: 'auth',
  initialState: { user: getAuth()?.user ?? null } as { user: User | null },
  reducers: { setUser(s, a: PayloadAction<User | null>) { s.user = a.payload; } },
});

const branch = createSlice({
  name: 'branch',
  initialState: { id: localStorage.getItem('pos_branch') } as { id: string | null },
  reducers: {
    setBranch(s, a: PayloadAction<string | null>) {
      s.id = a.payload;
      if (a.payload) localStorage.setItem('pos_branch', a.payload);
    },
  },
});

export interface CartLine { menuItemId: string; name: string; price: number; quantity: number; notes?: string }
const cart = createSlice({
  name: 'cart',
  initialState: { items: [] as CartLine[], tableId: '', type: 'TAKEAWAY', discount: 0, notes: '' },
  reducers: {
    addItem(s, a: PayloadAction<{ menuItemId: string; name: string; price: number }>) {
      const line = s.items.find((i) => i.menuItemId === a.payload.menuItemId);
      if (line) line.quantity += 1; else s.items.push({ ...a.payload, quantity: 1 });
    },
    changeQty(s, a: PayloadAction<{ menuItemId: string; delta: number }>) {
      const line = s.items.find((i) => i.menuItemId === a.payload.menuItemId);
      if (!line) return;
      line.quantity += a.payload.delta;
      if (line.quantity <= 0) s.items = s.items.filter((i) => i !== line);
    },
    setLineNotes(s, a: PayloadAction<{ menuItemId: string; notes: string }>) {
      const line = s.items.find((i) => i.menuItemId === a.payload.menuItemId);
      if (line) line.notes = a.payload.notes;
    },
    setTable(s, a: PayloadAction<string>) { s.tableId = a.payload; },
    setType(s, a: PayloadAction<string>) { s.type = a.payload; },
    setDiscount(s, a: PayloadAction<number>) { s.discount = a.payload; },
    setNotes(s, a: PayloadAction<string>) { s.notes = a.payload; },
    clear(s) { s.items = []; s.tableId = ''; s.type = 'TAKEAWAY'; s.discount = 0; s.notes = ''; },
  },
});

export const { setUser } = auth.actions;
export const { setBranch } = branch.actions;
export const cartActions = cart.actions;

export const store = configureStore({ reducer: { auth: auth.reducer, branch: branch.reducer, cart: cart.reducer } });
export type RootState = ReturnType<typeof store.getState>;
export const useAppDispatch = useDispatch.withTypes<typeof store.dispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
