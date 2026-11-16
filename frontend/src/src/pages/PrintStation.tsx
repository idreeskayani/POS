import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useBranch } from '../branchContext';
import { getPrintSettings, kotHtml, PrintSettings, printSlip, savePrintSettings } from '../print';
import { useBranchSocket } from '../socket';
import type { Order, Table } from '../types';
import { beep } from '../util';

const KEY = 'pos_printed';
const loadPrinted = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };

/**
 * Kitchen printer station: leave this page open on the PC that is connected to the kitchen thermal printer.
 * Every new order prints automatically as a kitchen slip. A 15s poll catches anything missed while offline.
 */
export default function PrintStation() {
  const { branch } = useBranch();
  const [ps, setPs] = useState<PrintSettings>(getPrintSettings());
  const [live, setLive] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const [log, setLog] = useState<{ order: Order; at: Date }[]>([]);
  const printed = useRef<Set<string>>(loadPrinted());
  const psRef = useRef(ps); psRef.current = ps;
  const tablesRef = useRef(tables); tablesRef.current = tables;

  const whereOf = (o: Order) => tablesRef.current.find((t) => t.id === o.tableId)?.label ?? o.type.replace('_', ' ').toLowerCase();

  const printOrder = (o: Order, manual = false) => {
    if (!manual && printed.current.has(o.id)) return;
    printed.current.add(o.id);
    localStorage.setItem(KEY, JSON.stringify([...printed.current].slice(-300)));
    printSlip(kotHtml({ branch, order: o, where: whereOf(o) }), psRef.current.width);
    if (!manual) beep();
    setLog((l) => [{ order: o, at: new Date() }, ...l.filter((x) => x.order.id !== o.id || manual)].slice(0, 30));
  };

  const poll = async () => {
    try {
      const [t, list] = await Promise.all([
        api<Table[]>(`/branches/${branch.id}/tables`),
        api<Order[]>(`/branches/${branch.id}/orders?status=SENT`),
      ]);
      setTables(t); tablesRef.current = t;
      list
        .filter((o) => !printed.current.has(o.id) && Date.now() - new Date(o.createdAt).getTime() < 30 * 60000)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .forEach((o, i) => setTimeout(() => printOrder(o), i * 1500));
    } catch { /* retry on next poll */ }
  };

  useEffect(() => {
    poll();
    const t = setInterval(poll, 15000);
    return () => clearInterval(t);
  }, [branch.id]);

  useBranchSocket(branch.id, {
    connect: () => setLive(true),
    disconnect: () => setLive(false),
    'order:new': (o: Order) => printOrder(o),
  });

  const setWidth = (w: 58 | 80) => { const next = { ...ps, width: w }; savePrintSettings(next); setPs(next); };
  const testPrint = () => {
    const fake: any = {
      id: 'test', orderNumber: 'TEST-0000', createdAt: new Date().toISOString(), notes: null,
      items: [{ id: '1', name: 'Test item', quantity: 1, notes: 'printer check' }],
    };
    printSlip(kotHtml({ branch, order: fake, where: 'Test' }), ps.width);
  };

  return (
    <div className="station">
      <div className="card station-card">
        <h2>Kitchen printer · {branch.name}</h2>
        <div className={live ? 'status on' : 'status off'}>
          <span className="pulse-dot" /> {live ? 'Connected. New orders print automatically.' : 'Reconnecting… (orders are still checked every 15 seconds)'}
        </div>
        <p className="muted">Keep this page open on the PC connected to the kitchen thermal printer. The kitchen only needs the slip: no screen interaction required.</p>
        <div className="row wrap">
          <label className="row">Paper
            <select value={ps.width} onChange={(e) => setWidth(Number(e.target.value) as 58 | 80)}>
              <option value={80}>80 mm</option><option value={58}>58 mm</option>
            </select>
          </label>
          <button onClick={testPrint}>Test print</button>
        </div>
        <p className="muted small">
          To print without the Windows print dialog each time, start Chrome/Edge with <code>--kiosk-printing</code> and set the thermal printer as the default printer.
          The browser must stay open and the PC must not sleep.
        </p>
      </div>

      <div className="card">
        <h3>Recently printed</h3>
        {log.length === 0 && <p className="muted">Nothing printed in this session yet.</p>}
        {log.map(({ order, at }) => (
          <div key={order.id + at.getTime()} className="row item-row">
            <strong>{order.orderNumber}</strong>
            <span className="muted grow">{whereOf(order)} · {order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</span>
            <span className="muted small">{at.toLocaleTimeString()}</span>
            <button className="ghost" onClick={() => printOrder(order, true)}>Reprint</button>
          </div>
        ))}
      </div>
    </div>
  );
}
