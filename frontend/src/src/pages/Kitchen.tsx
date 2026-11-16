import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useBranch } from '../branchContext';
import PrintSettingsPanel from '../components/PrintSettingsPanel';
import { getPrintSettings, kotHtml, PrintSettings, printSlip } from '../print';
import { useBranchSocket } from '../socket';
import { useAppSelector } from '../store';
import type { Order, Table } from '../types';
import { beep, minutesSince } from '../util';

const STATES = ['SENT', 'PREPARING', 'READY'];
const COLS: [string, string][] = [['SENT', 'New'], ['PREPARING', 'Preparing'], ['READY', 'Ready for pickup']];

export default function Kitchen() {
  const { branch } = useBranch();
  const role = useAppSelector((s) => s.auth.user!.role);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [error, setError] = useState('');
  const [ps, setPs] = useState<PrintSettings>(getPrintSettings());
  const printed = useRef(new Set<string>());
  const [, tick] = useState(0);

  useEffect(() => {
    setError('');
    Promise.all([
      api<Order[]>(`/branches/${branch.id}/orders?status=${STATES.join(',')}`),
      api<Table[]>(`/branches/${branch.id}/tables`),
    ]).then(([o, t]) => { setOrders(o); setTables(t); o.forEach((x) => printed.current.add(x.id)); }).catch((e) => setError(e.message));
  }, [branch.id]);

  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  const label = (o: Order) => tables.find((t) => t.id === o.tableId)?.label ?? o.type.replace('_', ' ').toLowerCase();
  const print = (o: Order) => printSlip(kotHtml({ branch, order: o, where: label(o) }), ps.width);

  const upsert = (o: Order) =>
    setOrders((prev) => {
      const rest = prev.filter((x) => x.id !== o.id);
      return STATES.includes(o.status) ? [...rest, o].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : rest;
    });

  useBranchSocket(branch.id, {
    'order:new': (o: Order) => {
      upsert(o);
      beep();
      if (ps.kitchenAuto && !printed.current.has(o.id)) { printed.current.add(o.id); print(o); }
    },
    'order:updated': upsert,
  });

  const move = async (o: Order, status: string) => {
    setError('');
    try { upsert(await api<Order>(`/branches/${branch.id}/orders/${o.id}/status`, { method: 'PATCH', body: { status } })); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <div className="kitchen">
      {error && <div className="error">{error}</div>}
      <PrintSettingsPanel settings={ps} onChange={setPs} mode="kitchen" />
      <div className="cols">
        {COLS.map(([status, title]) => {
          const list = orders.filter((o) => o.status === status);
          return (
            <section key={status} className="col">
              <h3>{title} <span className="count">{list.length}</span></h3>
              {list.length === 0 && <p className="muted">Nothing here.</p>}
              {list.map((o) => {
                const mins = minutesSince(o.createdAt);
                return (
                  <article key={o.id} className={`ticket ${mins >= 15 && status !== 'READY' ? 'late' : ''}`}>
                    <header className="row">
                      <strong>{o.orderNumber}</strong>
                      <span className="muted">{label(o)}</span>
                      <div className="spacer" />
                      <span className="timer">{mins}m</span>
                    </header>
                    <ul>
                      {o.items.map((i) => (
                        <li key={i.id}>
                          <b>{i.quantity}×</b> {i.name}
                          {i.notes && <div className="note">↳ {i.notes}</div>}
                        </li>
                      ))}
                    </ul>
                    {o.notes && <div className="note">Note: {o.notes}</div>}
                    <div className="row">
                      <button className="ghost" onClick={() => print(o)}>Print</button>
                      {status === 'SENT' && <button className="primary grow" onClick={() => move(o, 'PREPARING')}>Start preparing</button>}
                      {status === 'PREPARING' && <button className="primary grow" onClick={() => move(o, 'READY')}>Order ready</button>}
                      {status === 'READY' && role !== 'KITCHEN' && <button className="grow" onClick={() => move(o, 'SERVED')}>Collected / served</button>}
                      {status === 'READY' && role === 'KITCHEN' && <span className="muted grow">Waiting for waiter…</span>}
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
