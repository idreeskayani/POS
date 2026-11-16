import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useBranch } from '../branchContext';
import PrintSettingsPanel from '../components/PrintSettingsPanel';
import { billHtml, getPrintSettings, kotHtml, PrintSettings, printSlip, Tender } from '../print';
import { useBranchSocket } from '../socket';
import { cartActions, useAppDispatch, useAppSelector } from '../store';
import type { Branch, Category, Order, Table } from '../types';
import { fmt, round2, uuid } from '../util';

const ACTIVE = ['OPEN', 'SENT', 'PREPARING', 'READY', 'SERVED'];
type Method = 'CASH' | 'CARD' | 'ONLINE';

export default function Pos() {
  const { branch } = useBranch();
  const dispatch = useAppDispatch();
  const cart = useAppSelector((s) => s.cart);
  const user = useAppSelector((s) => s.auth.user!);
  const role = user.role;
  const [menu, setMenu] = useState<Category[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [catId, setCatId] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'cart' | 'orders'>('cart');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [payFor, setPayFor] = useState<Order | null>(null);
  const [ps, setPs] = useState<PrintSettings>(getPrintSettings());
  const cur = branch.currency;

  const whereOf = (o: Order) => tables.find((t) => t.id === o.tableId)?.label ?? o.type.replace('_', ' ').toLowerCase();
  const loadTables = () => api<Table[]>(`/branches/${branch.id}/tables`).then(setTables).catch(() => {});

  useEffect(() => {
    dispatch(cartActions.clear());
    setError('');
    Promise.all([
      api<Category[]>(`/menu?branchId=${branch.id}`),
      api<Table[]>(`/branches/${branch.id}/tables`),
      api<Order[]>(`/branches/${branch.id}/orders?status=${ACTIVE.join(',')}`),
    ])
      .then(([m, t, o]) => {
        setMenu(m); setTables(t); setOrders(o); setCatId(m[0]?.id ?? '');
      })
      .catch((e) => setError(e.message));
  }, [branch.id]);

  const upsert = (o: Order) => {
    setOrders((prevList) => {
      const rest = prevList.filter((x) => x.id !== o.id);
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

  const printKot = (o: Order) => printSlip(kotHtml({ branch, order: o, where: whereOf(o), by: user.name }), ps.width);
  const printPreBill = (o: Order) => printSlip(billHtml({ branch, order: o, where: whereOf(o), cashier: user.name }), ps.width);

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
      if (ps.autoKot) printKot(order);
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
        <PrintSettingsPanel settings={ps} onChange={setPs} />
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
          <button className={tab === 'orders' ? 'tab active' : 'tab'} onClick={() => setTab('orders')}>
            Orders ({orders.length})
          </button>
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
              <div key={o.id} className={`order ${o.status}`}>
                <div className="row">
                  <strong>{o.orderNumber}</strong>
                  <span className={`badge ${o.status}`}>{o.status === 'SENT' ? 'IN KITCHEN' : o.status}</span>
                  <span className="muted">{whereOf(o)}</span>
                  <div className="spacer" />
                  <strong>{fmt(o.total, cur)}</strong>
                </div>
                <div className="muted small">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</div>
                <div className="row actions wrap">
                  <button className="ghost" onClick={() => printKot(o)}>Kitchen slip</button>
                  <button className="ghost" onClick={() => printPreBill(o)}>Print bill</button>
                  {(o.status === 'SENT' || role === 'OWNER' || role === 'ADMIN') && (
                    <button className="ghost danger" onClick={() => confirm('Cancel this order?') && setStatus(o, 'CANCELLED')}>Cancel</button>
                  )}
                  {role !== 'WAITER' && <button className="primary" onClick={() => setPayFor(o)}>Bill &amp; pay</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>

      {payFor && (
        <PayModal
          order={payFor}
          branch={branch}
          where={whereOf(payFor)}
          cashier={user.name}
          settings={ps}
          onPaid={upsert}
          onClose={() => setPayFor(null)}
        />
      )}
    </div>
  );
}

const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step;

function PayModal({ order, branch, where, cashier, settings, onPaid, onClose }: {
  order: Order; branch: Branch; where: string; cashier: string; settings: PrintSettings;
  onPaid: (o: Order) => void; onClose: () => void;
}) {
  const cur = branch.currency;
  const [method, setMethod] = useState<Method>('CASH');
  const [due, setDue] = useState(order.total);
  const [received, setReceived] = useState('');
  const [reference, setReference] = useState('');
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [paidOrder, setPaidOrder] = useState<Order>(order);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // If part of this bill was already paid earlier, start from the real balance
  useEffect(() => {
    api<{ balance: number }>(`/branches/${branch.id}/orders/${order.id}/balance`).then((r) => setDue(r.balance)).catch(() => {});
  }, []);

  const rec = Number(received) || 0;
  const change = method === 'CASH' ? Math.max(0, round2(rec - due)) : 0;
  const remaining = Math.max(0, round2(due - rec));
  const invalid = rec <= 0 || (method !== 'CASH' && rec > due);
  const quick = useMemo(
    () => [...new Set([due, ceilTo(due, 100), ceilTo(due, 500), ceilTo(due, 1000)])].filter((n) => n >= due).sort((a, b) => a - b).slice(0, 4),
    [due],
  );

  const printBill = (list: Tender[], o: Order) =>
    printSlip(billHtml({ branch, order: o, where, cashier, tenders: list }), settings.width);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api<{ order: Order; paid: number; balance: number; change: number }>(
        `/branches/${branch.id}/orders/${order.id}/pay`,
        { method: 'POST', body: { method, amount: rec, reference: reference || undefined } },
      );
      const next = [...tenders, { method, tendered: rec, applied: round2(rec - r.change) }];
      setTenders(next); setPaidOrder(r.order); onPaid(r.order);
      if (r.balance > 0) {
        setDue(r.balance); setReceived('');
        setMsg(`Partial payment taken. Remaining balance: ${fmt(r.balance, cur)}`);
      } else {
        setDone(true); setMsg('');
        if (settings.autoBill) printBill(next, r.order);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const totalReceived = round2(tenders.reduce((s, t) => s + t.tendered, 0));
  const totalChange = round2(tenders.reduce((s, t) => s + (t.tendered - t.applied), 0));

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Payment · {order.orderNumber}</h3>
        <div className="sum"><span>Bill total</span><strong>{fmt(order.total, cur)}</strong></div>

        {!done ? (
          <>
            {due !== order.total && <div className="sum"><span>Balance due</span><strong>{fmt(due, cur)}</strong></div>}
            <div className="chips">
              {(['CASH', 'CARD', 'ONLINE'] as const).map((m) => (
                <button type="button" key={m} className={m === method ? 'chip active' : 'chip'} onClick={() => setMethod(m)}>{m}</button>
              ))}
            </div>

            <label className="muted">{method === 'CASH' ? 'Cash received from customer' : 'Amount paid'}</label>
            <input className="bigin" type="number" min={0} step="any" autoFocus value={received}
              onChange={(e) => setReceived(e.target.value)} placeholder={`e.g. ${quick[quick.length - 1] ?? due}`} />
            <div className="chips">
              {quick.map((n) => (
                <button type="button" key={n} className="chip" onClick={() => setReceived(String(n))}>{n === due ? 'Exact' : n}</button>
              ))}
            </div>

            {rec > 0 && (
              method === 'CASH' && rec >= due ? (
                <div className="change"><span>Return change</span><strong>{fmt(change, cur)}</strong></div>
              ) : rec < due ? (
                <div className="partial">Partial payment · remaining after this: <strong>{fmt(remaining, cur)}</strong></div>
              ) : (
                method !== 'CASH' && <div className="ok">Exact amount</div>
              )
            )}
            {method !== 'CASH' && <input placeholder="Reference / last 4 digits (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />}
            {msg && <div className="ok">{msg}</div>}
            {error && <div className="error">{error}</div>}
            <div className="row">
              <button type="button" className="ghost" onClick={onClose}>Cancel</button>
              <button className="primary grow" disabled={busy || invalid}>{busy ? 'Processing…' : 'Confirm payment'}</button>
            </div>
          </>
        ) : (
          <>
            <div className="ok">Payment complete</div>
            <div className="sum"><span>Cash / amount received</span><strong>{fmt(totalReceived, cur)}</strong></div>
            <div className="change"><span>Change returned</span><strong>{fmt(totalChange, cur)}</strong></div>
            <div className="row">
              <button type="button" onClick={() => printBill(tenders, paidOrder)}>Print bill</button>
              <button type="button" className="primary grow" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
