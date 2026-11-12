import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useBranch } from '../branchContext';
import { useBranchSocket } from '../socket';
import { cartActions, useAppDispatch, useAppSelector } from '../store';
import type { Category, Order, Table } from '../types';
import { fmt, round2, uuid } from '../util';

const ACTIVE = ['OPEN', 'SENT', 'PREPARING', 'READY', 'SERVED'];

export default function Pos() {
  const { branch } = useBranch();
  const dispatch = useAppDispatch();
  const cart = useAppSelector((s) => s.cart);
  const role = useAppSelector((s) => s.auth.user!.role);
  const [menu, setMenu] = useState<Category[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [catId, setCatId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'cart' | 'orders'>('cart');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [payFor, setPayFor] = useState<Order | null>(null);
  const cur = branch.currency;

  const loadTables = () => api<Table[]>(`/branches/${branch.id}/tables`).then(setTables).catch(() => {});

  useEffect(() => {
    dispatch(cartActions.clear());
    setError('');
    Promise.all([
      api<Category[]>(`/menu?branchId=${branch.id}`),
      api<Table[]>(`/branches/${branch.id}/tables`),
      api<Order[]>(`/branches/${branch.id}/orders?status=${ACTIVE.join(',')}`),
    ])
      .then(([m, t, o]) => { setMenu(m); setTables(t); setOrders(o); setCatId(m[0]?.id ?? ''); })
      .catch((e) => setError(e.message));
  }, [branch.id]);

  const upsert = (o: Order) => {
    setOrders((prev) => {
      const rest = prev.filter((x) => x.id !== o.id);
      return ACTIVE.includes(o.status) ? [o, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : rest;
    });
    loadTables();
  };
  useBranchSocket(branch.id, { 'order:updated': upsert });

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) return menu.flatMap((c) => c.items).filter((i) => i.name.toLowerCase().includes(q));
    return menu.find((c) => c.id === catId)?.items ?? [];
  }, [menu, catId, search]);

  const subtotal = round2(cart.items.reduce((s, i) => s + i.price * i.quantity, 0));
  const discount = Math.min(cart.discount || 0, subtotal);
  const tax = round2(((subtotal - discount) * branch.taxRate) / 100);
  const total = round2(subtotal - discount + tax);
  const tableLabel = (id: string | null) => tables.find((t) => t.id === id)?.label;

  const send = async () => {
    setBusy(true); setError('');
    try {
      const order = await api<Order>(`/branches/${branch.id}/orders`, {
        method: 'POST',
        body: {
          id: uuid(), // idempotency key
          tableId: cart.tableId || undefined,
          type: cart.tableId ? 'DINE_IN' : cart.type,
          notes: cart.notes || undefined,
          discount: discount || undefined,
          items: cart.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity, notes: i.notes || undefined })),
        },
      });
      upsert(order);
      dispatch(cartActions.clear());
      setTab('orders');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (o: Order, status: string) => {
    setError('');
    try { upsert(await api<Order>(`/branches/${branch.id}/orders/${o.id}/status`, { method: 'PATCH', body: { status } })); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <div className="pos">
      <section className="menu-pane">
        <div className="row">
          <input className="grow" placeholder="Search menu…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {!search && (
          <div className="chips">
            {menu.map((c) => (
              <button key={c.id} className={c.id === catId ? 'chip active' : 'chip'} onClick={() => setCatId(c.id)}>{c.name}</button>
            ))}
          </div>
        )}
        {menu.length === 0 && <p className="muted pad">No menu yet. Add categories and items in Admin → Menu.</p>}
        <div className="grid">
          {items.map((i) => (
            <button
              key={i.id}
              className="tile"
              disabled={!i.isAvailable}
              onClick={() => dispatch(cartActions.addItem({ menuItemId: i.id, name: i.name, price: i.price }))}
            >
              <span className="tile-name">{i.name}</span>
              <span className="tile-price">{i.isAvailable ? fmt(i.price, cur) : 'Unavailable'}</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="side card">
        <div className="tabs">
          <button className={tab === 'cart' ? 'tab active' : 'tab'} onClick={() => setTab('cart')}>
            Cart{cart.items.length ? ` (${cart.items.reduce((s, i) => s + i.quantity, 0)})` : ''}
          </button>
          <button className={tab === 'orders' ? 'tab active' : 'tab'} onClick={() => setTab('orders')}>Orders ({orders.length})</button>
        </div>
        {error && <div className="error">{error}</div>}

        {tab === 'cart' ? (
          <div className="cart">
            <div className="row">
              <select className="grow" value={cart.tableId} onChange={(e) => dispatch(cartActions.setTable(e.target.value))}>
                <option value="">No table</option>
                {tables.map((t) => <option key={t.id} value={t.id}>{t.label}{t.status === 'OCCUPIED' ? ' (occupied)' : ''}</option>)}
              </select>
              {!cart.tableId && (
                <select value={cart.type} onChange={(e) => dispatch(cartActions.setType(e.target.value))}>
                  <option value="TAKEAWAY">Takeaway</option>
                  <option value="DELIVERY">Delivery</option>
                </select>
              )}
            </div>
            <div className="lines">
              {cart.items.length === 0 && <p className="muted pad">Tap items to add them.</p>}
              {cart.items.map((l) => (
                <div key={l.menuItemId} className="line">
                  <div className="grow">
                    <div>{l.name}</div>
                    <input className="mini" placeholder="Note (e.g. no onions)" value={l.notes ?? ''}
                      onChange={(e) => dispatch(cartActions.setLineNotes({ menuItemId: l.menuItemId, notes: e.target.value }))} />
                  </div>
                  <div className="qty">
                    <button onClick={() => dispatch(cartActions.changeQty({ menuItemId: l.menuItemId, delta: -1 }))}>−</button>
                    <span>{l.quantity}</span>
                    <button onClick={() => dispatch(cartActions.changeQty({ menuItemId: l.menuItemId, delta: 1 }))}>+</button>
                  </div>
                  <div className="amt">{fmt(l.price * l.quantity, cur)}</div>
                </div>
              ))}
            </div>
            <input placeholder="Order note (optional)" value={cart.notes} onChange={(e) => dispatch(cartActions.setNotes(e.target.value))} />
            <div className="totals">
              <div><span>Subtotal</span><span>{fmt(subtotal, cur)}</span></div>
              <div>
                <span>Discount</span>
                <input className="mini num" type="number" min={0} value={cart.discount || ''} placeholder="0"
                  onChange={(e) => dispatch(cartActions.setDiscount(Number(e.target.value)))} />
              </div>
              <div><span>Tax ({branch.taxRate}%)</span><span>{fmt(tax, cur)}</span></div>
              <div className="grand"><span>Total</span><span>{fmt(total, cur)}</span></div>
            </div>
            <div className="row">
              <button className="ghost" onClick={() => dispatch(cartActions.clear())} disabled={!cart.items.length}>Clear</button>
              <button className="primary grow" onClick={send} disabled={busy || !cart.items.length}>{busy ? 'Sending…' : 'Send to kitchen'}</button>
            </div>
          </div>
        ) : (
          <div className="orders">
            {orders.length === 0 && <p className="muted pad">No active orders.</p>}
            {orders.map((o) => (
              <div key={o.id} className="order">
                <div className="row">
                  <strong>{o.orderNumber}</strong>
                  <span className={`badge ${o.status}`}>{o.status}</span>
                  <span className="muted">{tableLabel(o.tableId) ?? o.type.replace('_', ' ').toLowerCase()}</span>
                  <div className="spacer" />
                  <strong>{fmt(o.total, cur)}</strong>
                </div>
                <div className="muted small">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</div>
                <div className="row actions">
                  {o.status === 'READY' && <button onClick={() => setStatus(o, 'SERVED')}>Mark served</button>}
                  {(o.status === 'SENT' || (o.status === 'PREPARING' && role !== 'WAITER' && role !== 'CASHIER')) && (
                    <button className="ghost danger" onClick={() => confirm('Cancel this order?') && setStatus(o, 'CANCELLED')}>Cancel</button>
                  )}
                  {role !== 'WAITER' && <button className="primary" onClick={() => setPayFor(o)}>Pay</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>

      {payFor && (
        <PayModal
          order={payFor}
          branchId={branch.id}
          currency={cur}
          onPaid={upsert}
          onClose={() => setPayFor(null)}
        />
      )}
    </div>
  );
}

function PayModal({ order, branchId, currency, onPaid, onClose }: {
  order: Order; branchId: string; currency: string; onPaid: (o: Order) => void; onClose: () => void;
}) {
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'ONLINE'>('CASH');
  const [due, setDue] = useState(order.total);
  const [amount, setAmount] = useState(String(order.total));
  const [reference, setReference] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = await api<{ order: Order; paid: number; balance: number; change: number }>(
        `/branches/${branchId}/orders/${order.id}/pay`,
        { method: 'POST', body: { method, amount: Number(amount), reference: reference || undefined } },
      );
      onPaid(r.order);
      if (r.balance > 0) {
        setDue(r.balance); setAmount(String(r.balance));
        setMsg(`Partial payment received. Remaining: ${fmt(r.balance, currency)}`);
      } else {
        setDone(true);
        setMsg(r.change > 0 ? `Paid in full. Change due: ${fmt(r.change, currency)}` : 'Paid in full.');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h3>Pay {order.orderNumber}</h3>
        <div className="grand row"><span>Amount due</span><div className="spacer" /><span>{fmt(due, currency)}</span></div>
        {!done && (
          <>
            <div className="chips">
              {(['CASH', 'CARD', 'ONLINE'] as const).map((m) => (
                <button key={m} className={m === method ? 'chip active' : 'chip'} onClick={() => setMethod(m)}>{m}</button>
              ))}
            </div>
            <label className="muted small">Amount received (split bills: enter part of the total)</label>
            <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
            {method !== 'CASH' && <input placeholder="Reference / last 4 digits (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />}
          </>
        )}
        {msg && <div className="ok">{msg}</div>}
        {error && <div className="error">{error}</div>}
        <div className="row">
          <button className="ghost" onClick={onClose}>{done ? 'Close' : 'Cancel'}</button>
          {done && <button onClick={() => window.print()}>Print</button>}
          {!done && <button className="primary grow" onClick={submit} disabled={busy || !(Number(amount) > 0)}>{busy ? 'Processing…' : 'Take payment'}</button>}
        </div>
      </div>
    </div>
  );
}
