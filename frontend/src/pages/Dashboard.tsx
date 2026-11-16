import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useBranch } from '../branchContext';
import { Bar, BarChart, Donut, RankList } from '../components/charts';
import { billHtml, getPrintSettings, printSlip, Tender } from '../print';
import { useAppSelector } from '../store';
import type { Branch, Order } from '../types';
import { fmt } from '../util';

/* ---------- types ---------- */
interface Kpis { sales: number; orders: number; tax: number; discounts: number; cancelledOrders: number; cancelledValue: number; itemsSold: number; avgOrder: number }
interface Summary {
  granularity: 'hour' | 'day';
  kpis: Kpis; previous: Kpis;
  series: { bucket: string; sales: number; orders: number }[];
  hourly: { hour: number; sales: number; orders: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
  byCategory: { name: string; revenue: number; qty: number }[];
  byType: { type: string; orders: number; sales: number }[];
  byPayment: { method: string; amount: number; count: number }[];
  byBranch: { branchId: string; name: string; orders: number; sales: number }[];
  byStaff: { userId: string; name: string; role: string; orders: number; sales: number }[];
  live: { byStatus: { status: string; count: number; value: number }[]; tables: { total: number; occupied: number } };
}
interface HistRow {
  id: string; orderNumber: string; status: string; type: string; total: number; subtotal: number; tax: number; discount: number;
  createdAt: string; branchId: string; branch: string; staff: string | null; tableLabel: string | null;
}
type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';
const PRESETS: [Preset, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['custom', 'Custom']];
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TYPE_LABEL: Record<string, string> = { DINE_IN: 'Dine-in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery' };
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', CARD: 'Card', ONLINE: 'Online' };
const LIVE_ORDER = ['SENT', 'PREPARING', 'READY', 'SERVED', 'OPEN'];

/* ---------- date helpers ---------- */
const sod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const key = (d: Date, hour: boolean) => `${ymd(d)}T${hour ? String(d.getHours()).padStart(2, '0') : '00'}:00`;

function rangeFor(p: Preset, cFrom: string, cTo: string): { from: Date; to: Date } {
  const today = sod(new Date());
  switch (p) {
    case 'today': return { from: today, to: addDays(today, 1) };
    case 'yesterday': return { from: addDays(today, -1), to: today };
    case '7d': return { from: addDays(today, -6), to: addDays(today, 1) };
    case '30d': return { from: addDays(today, -29), to: addDays(today, 1) };
    case 'month': return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: addDays(today, 1) };
    default: {
      const f = new Date(`${cFrom}T00:00:00`), t = new Date(`${cTo}T00:00:00`);
      return { from: f, to: addDays(isNaN(+t) ? f : t, 1) };
    }
  }
}

function fillSeries(s: Summary, from: Date, to: Date): Bar[] {
  const hour = s.granularity === 'hour';
  const map = new Map(s.series.map((x) => [x.bucket, x]));
  const out: Bar[] = [];
  const cur = hour ? new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours()) : sod(from);
  while (cur < to && out.length < 400) {
    const hit = map.get(key(cur, hour));
    out.push({
      label: hour ? cur.toLocaleTimeString([], { hour: 'numeric' }) : cur.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      value: hit?.sales ?? 0,
      tip: `${hit?.orders ?? 0} orders`,
    });
    if (hour) cur.setHours(cur.getHours() + 1); else cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const delta = (cur: number, prev: number) => (prev === 0 ? (cur > 0 ? null : 0) : ((cur - prev) / prev) * 100);

/* ---------- small components ---------- */
function Kpi({ label, value, sub, change, hint }: { label: string; value: string; sub?: string; change?: number | null | undefined; hint?: string }) {
  return (
    <div className="card kpi" title={hint}>
      <span className="muted small">{label}</span>
      <strong className="kpi-v">{value}</strong>
      <div className="kpi-sub">
        {change === undefined ? null : change === null ? <span className="chg up">new</span> : change === 0 ? <span className="muted small">no change</span> : (
          <span className={change > 0 ? 'chg up' : 'chg down'}>{change > 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%</span>
        )}
        {sub && <span className="muted small">{sub}</span>}
      </div>
    </div>
  );
}
const Section = ({ title, right, children, className = '' }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={`card section ${className}`}>
    <div className="row"><h3 className="grow">{title}</h3>{right}</div>
    {children}
  </section>
);

/* ---------- page ---------- */
export default function Dashboard() {
  const { branch: current } = useBranch();
  const user = useAppSelector((s) => s.auth.user!);
  const orgWide = user.branchId === null;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [preset, setPreset] = useState<Preset>('today');
  const [cFrom, setCFrom] = useState(ymd(new Date()));
  const [cTo, setCTo] = useState(ymd(new Date()));
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);

  useEffect(() => { api<Branch[]>('/branches').then(setBranches).catch(() => {}); }, []);

  const { from, to } = useMemo(() => rangeFor(preset, cFrom, cTo), [preset, cFrom, cTo]);
  const branchId = orgWide ? (branchFilter === 'all' ? '' : branchFilter) : user.branchId!;
  const currency = branches.find((b) => b.id === (branchId || current.id))?.currency ?? current.currency;
  const money = useCallback((n: number) => fmt(n, currency), [currency]);

  const load = useCallback(async () => {
    if (isNaN(+from) || isNaN(+to) || to <= from) { setError('Choose a valid date range'); return; }
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), tz: TZ, ...(branchId ? { branchId } : {}) });
      setData(await api<Summary>(`/reports/summary?${qs}`));
      setUpdated(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [from.getTime(), to.getTime(), branchId]);

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const trend = useMemo(() => (data ? fillSeries(data, from, to) : []), [data]);
  const hourly: Bar[] = useMemo(() => {
    if (!data) return [];
    const map = new Map(data.hourly.map((h) => [h.hour, h]));
    const peak = Math.max(0, ...data.hourly.map((h) => h.sales));
    return Array.from({ length: 24 }, (_, h) => ({
      label: `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`,
      value: map.get(h)?.sales ?? 0,
      tip: `${map.get(h)?.orders ?? 0} orders`,
      hl: peak > 0 && (map.get(h)?.sales ?? 0) === peak,
    }));
  }, [data]);

  const k = data?.kpis, pv = data?.previous;
  const peakHour = hourly.find((h) => h.hl);
  const bestDay = data && data.granularity === 'day' && trend.length > 1 ? [...trend].sort((a, b) => b.value - a.value)[0] : null;
  const liveCount = data?.live.byStatus.reduce((s, x) => s + x.count, 0) ?? 0;
  const liveValue = data?.live.byStatus.reduce((s, x) => s + x.value, 0) ?? 0;
  const rangeLabel = `${from.toLocaleDateString([], { dateStyle: 'medium' })} – ${addDays(to, -1).toLocaleDateString([], { dateStyle: 'medium' })}`;

  return (
    <div className="dash">
      <div className="card dash-head">
        <div className="row wrap">
          <div className="grow">
            <h2 style={{ margin: 0 }}>Dashboard</h2>
            <span className="muted small">{rangeLabel} · {TZ}{updated ? ` · updated ${updated.toLocaleTimeString()}` : ''}</span>
          </div>
          {orgWide && branches.length > 1 && (
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="all">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
        <div className="chips">
          {PRESETS.map(([p, label]) => <button key={p} className={p === preset ? 'chip active' : 'chip'} onClick={() => setPreset(p)}>{label}</button>)}
          {preset === 'custom' && (
            <span className="row">
              <input type="date" value={cFrom} max={cTo} onChange={(e) => setCFrom(e.target.value)} />
              <span className="muted">to</span>
              <input type="date" value={cTo} min={cFrom} onChange={(e) => setCTo(e.target.value)} />
            </span>
          )}
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {k && pv && data && (
        <>
          <div className="kpis">
            <Kpi label="Net sales" value={money(k.sales)} change={delta(k.sales, pv.sales)} sub="vs previous period" hint="Total of paid orders (incl. tax, after discounts)" />
            <Kpi label="Paid orders" value={String(k.orders)} change={delta(k.orders, pv.orders)} />
            <Kpi label="Average order value" value={money(k.avgOrder)} change={delta(k.avgOrder, pv.avgOrder)} />
            <Kpi label="Items sold" value={String(k.itemsSold)} change={delta(k.itemsSold, pv.itemsSold)} />
            <Kpi label="Tax collected" value={money(k.tax)} change={delta(k.tax, pv.tax)} />
            <Kpi label="Discounts given" value={money(k.discounts)} change={delta(k.discounts, pv.discounts)} />
            <Kpi label="Cancelled orders" value={String(k.cancelledOrders)} sub={money(k.cancelledValue)} />
            <Kpi label="Open right now" value={String(liveCount)} sub={`${money(liveValue)} unpaid`} />
          </div>

          <div className="insights">
            <div><span className="muted small">Peak hour</span><strong>{peakHour ? peakHour.label.replace('a', ' AM').replace('p', ' PM') : '—'}</strong></div>
            <div><span className="muted small">Best day</span><strong>{bestDay ? `${bestDay.label} · ${money(bestDay.value)}` : '—'}</strong></div>
            <div><span className="muted small">Best seller</span><strong>{data.topItems[0] ? `${data.topItems[0].name} (${data.topItems[0].qty})` : '—'}</strong></div>
            <div><span className="muted small">Top payment method</span><strong>{data.byPayment[0] ? METHOD_LABEL[data.byPayment[0].method] ?? data.byPayment[0].method : '—'}</strong></div>
            <div><span className="muted small">Discount rate</span><strong>{k.sales + k.discounts > 0 ? ((k.discounts / (k.sales + k.discounts)) * 100).toFixed(1) + '%' : '—'}</strong></div>
            <div><span className="muted small">Cancellation rate</span><strong>{k.orders + k.cancelledOrders > 0 ? ((k.cancelledOrders / (k.orders + k.cancelledOrders)) * 100).toFixed(1) + '%' : '—'}</strong></div>
          </div>

          <div className="dash-grid two-one">
            <Section title={`Sales ${data.granularity === 'hour' ? 'by hour' : 'by day'}`}>
              <BarChart data={trend} format={money} />
            </Section>
            <Section title="Live right now" right={<span className="muted small">auto-refreshes</span>}>
              <div className="live">
                {LIVE_ORDER.map((st) => {
                  const row = data.live.byStatus.find((x) => x.status === st);
                  return row || st !== 'OPEN' ? (
                    <div key={st} className="row"><span className={`badge ${st}`}>{st}</span><div className="spacer" /><strong>{row?.count ?? 0}</strong><span className="muted small">{money(row?.value ?? 0)}</span></div>
                  ) : null;
                })}
              </div>
              <div className="hr" />
              <div className="row"><span>Tables occupied</span><div className="spacer" /><strong>{data.live.tables.occupied} / {data.live.tables.total}</strong></div>
              <div className="meter"><div style={{ width: `${data.live.tables.total ? (data.live.tables.occupied / data.live.tables.total) * 100 : 0}%` }} /></div>
            </Section>
          </div>

          <div className="dash-grid two">
            <Section title="Sales by hour of day" right={<span className="muted small">peak hour in red</span>}>
              <BarChart data={hourly} format={money} height={200} color="#1c7ed6" />
            </Section>
            <Section title="Order types">
              <Donut slices={data.byType.map((t) => ({ label: TYPE_LABEL[t.type] ?? t.type, value: t.sales }))} format={money} centerLabel="sales" />
              <table className="tbl"><thead><tr><th>Type</th><th className="num">Orders</th><th className="num">Sales</th><th className="num">Avg</th></tr></thead>
                <tbody>{data.byType.map((t) => <tr key={t.type}><td>{TYPE_LABEL[t.type] ?? t.type}</td><td className="num">{t.orders}</td><td className="num">{money(t.sales)}</td><td className="num">{money(t.orders ? t.sales / t.orders : 0)}</td></tr>)}</tbody></table>
            </Section>
          </div>

          <div className="dash-grid two">
            <Section title="Top selling items" right={<span className="muted small">by revenue · top 10</span>}>
              <RankList rows={data.topItems.map((i) => ({ label: i.name, value: i.revenue, sub: `${i.qty} sold` }))} format={money} />
            </Section>
            <Section title="Sales by category">
              <Donut slices={data.byCategory.map((c) => ({ label: c.name, value: c.revenue }))} format={money} centerLabel="revenue" />
            </Section>
          </div>

          <div className="dash-grid two">
            <Section title="Payment methods" right={<span className="muted small">money received in period</span>}>
              <Donut slices={data.byPayment.map((p) => ({ label: METHOD_LABEL[p.method] ?? p.method, value: p.amount }))} format={money} centerLabel="received" />
              <table className="tbl"><thead><tr><th>Method</th><th className="num">Payments</th><th className="num">Amount</th></tr></thead>
                <tbody>{data.byPayment.map((p) => <tr key={p.method}><td>{METHOD_LABEL[p.method] ?? p.method}</td><td className="num">{p.count}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody></table>
            </Section>
            <Section title="Staff performance" right={<span className="muted small">orders taken</span>}>
              <table className="tbl"><thead><tr><th>Staff</th><th>Role</th><th className="num">Orders</th><th className="num">Sales</th><th className="num">Avg</th></tr></thead>
                <tbody>
                  {data.byStaff.length === 0 && <tr><td colSpan={5} className="muted">No data for this period.</td></tr>}
                  {data.byStaff.map((s) => <tr key={s.userId}><td>{s.name}</td><td><span className={`badge ${s.role}`}>{s.role}</span></td><td className="num">{s.orders}</td><td className="num">{money(s.sales)}</td><td className="num">{money(s.orders ? s.sales / s.orders : 0)}</td></tr>)}
                </tbody></table>
            </Section>
          </div>

          {orgWide && data.byBranch.length > 0 && (
            <Section title="Branch comparison">
              <table className="tbl"><thead><tr><th>Branch</th><th className="num">Orders</th><th className="num">Sales</th><th className="num">Avg order</th><th>Share</th></tr></thead>
                <tbody>{data.byBranch.map((b) => {
                  const total = data.byBranch.reduce((s, x) => s + x.sales, 0);
                  return (
                    <tr key={b.branchId}><td>{b.name}</td><td className="num">{b.orders}</td><td className="num">{money(b.sales)}</td><td className="num">{money(b.orders ? b.sales / b.orders : 0)}</td>
                      <td style={{ width: '28%' }}><div className="meter"><div style={{ width: `${total ? (b.sales / total) * 100 : 0}%` }} /></div></td></tr>
                  );
                })}</tbody></table>
            </Section>
          )}
        </>
      )}

      <OrderHistory from={from} to={to} branchId={branchId} branches={branches} fallbackBranch={current} money={money} refreshKey={updated?.getTime() ?? 0} />
    </div>
  );
}

/* ---------- order history ---------- */
function OrderHistory({ from, to, branchId, branches, fallbackBranch, money, refreshKey }: {
  from: Date; to: Date; branchId: string; branches: Branch[]; fallbackBranch: Branch; money: (n: number) => string; refreshKey: number;
}) {
  const [rows, setRows] = useState<HistRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const PAGE = 25;

  const fetchPage = useCallback(async (offset: number, query: string) => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), limit: String(PAGE), offset: String(offset), ...(branchId ? { branchId } : {}), ...(status ? { status } : {}), ...(query ? { q: query } : {}) });
      const r = await api<{ total: number; rows: HistRow[] }>(`/reports/orders?${qs}`);
      setTotal(r.total);
      setRows((prev) => (offset === 0 ? r.rows : [...prev, ...r.rows]));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [from.getTime(), to.getTime(), branchId, status]);

  useEffect(() => {
    const t = setTimeout(() => fetchPage(0, q.trim()), 250);
    return () => clearTimeout(t);
  }, [fetchPage, q, refreshKey]);

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Order', 'Date', 'Branch', 'Type', 'Table', 'Staff', 'Status', 'Subtotal', 'Discount', 'Tax', 'Total'];
    const lines = rows.map((r) => [r.orderNumber, new Date(r.createdAt).toLocaleString(), r.branch, TYPE_LABEL[r.type] ?? r.type, r.tableLabel ?? '', r.staff ?? '', r.status, r.subtotal, r.discount, r.tax, r.total].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Section title="Order history" right={<span className="muted small">{total} orders in range</span>}>
      <div className="row wrap">
        <input className="grow" placeholder="Search order number (e.g. BR1-0042)" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['PAID', 'CANCELLED', 'SENT', 'PREPARING', 'READY', 'SERVED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <button onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="table-scroll">
        <table className="tbl hist">
          <thead><tr><th>Order</th><th>Time</th><th>Branch</th><th>Type / table</th><th>Staff</th><th>Status</th><th className="num">Total</th></tr></thead>
          <tbody>
            {rows.length === 0 && !loading && <tr><td colSpan={7} className="muted">No orders found.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="click" onClick={() => setOpenId(r.id)}>
                <td><strong>{r.orderNumber}</strong></td>
                <td>{new Date(r.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{r.branch}</td>
                <td>{r.tableLabel ?? TYPE_LABEL[r.type] ?? r.type}</td>
                <td>{r.staff ?? '—'}</td>
                <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                <td className="num">{money(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length < total && <button className="ghost" disabled={loading} onClick={() => fetchPage(rows.length, q.trim())}>{loading ? 'Loading…' : `Load more (${total - rows.length} left)`}</button>}
      {openId && <OrderDetail id={openId} branches={branches} fallbackBranch={fallbackBranch} money={money} onClose={() => setOpenId(null)} />}
    </Section>
  );
}

interface Detail { order: Order & { branchId: string }; payments: { id: string; method: string; amount: number; reference: string | null; createdAt: string }[]; staff: string | null; tableLabel: string | null }

function OrderDetail({ id, branches, fallbackBranch, money, onClose }: { id: string; branches: Branch[]; fallbackBranch: Branch; money: (n: number) => string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<Detail>(`/reports/orders/${id}`).then(setD).catch((e) => setError(e.message)); }, [id]);

  const reprint = () => {
    if (!d) return;
    const branch = branches.find((b) => b.id === d.order.branchId) ?? fallbackBranch;
    const tenders: Tender[] = d.payments.map((p) => ({ method: p.method, tendered: p.amount, applied: p.amount }));
    printSlip(
      billHtml({ branch, order: d.order, where: d.tableLabel ?? (TYPE_LABEL[d.order.type] ?? d.order.type), cashier: d.staff ?? undefined, tenders, at: d.order.createdAt, reprint: true }),
      getPrintSettings().width,
    );
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card modal wide" onClick={(e) => e.stopPropagation()}>
        {error && <div className="error">{error}</div>}
        {!d && !error && <p className="muted">Loading…</p>}
        {d && (
          <>
            <div className="row">
              <h3 className="grow" style={{ margin: 0 }}>{d.order.orderNumber}</h3>
              <span className={`badge ${d.order.status}`}>{d.order.status}</span>
            </div>
            <div className="muted small">
              {new Date(d.order.createdAt).toLocaleString()} · {d.tableLabel ?? TYPE_LABEL[d.order.type] ?? d.order.type}{d.staff ? ` · taken by ${d.staff}` : ''}
            </div>
            <table className="tbl">
              <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
              <tbody>{d.order.items.map((i) => (
                <tr key={i.id}><td>{i.name}{i.notes && <div className="muted small">{i.notes}</div>}</td><td className="num">{i.quantity}</td><td className="num">{money(i.unitPrice)}</td><td className="num">{money(i.lineTotal)}</td></tr>
              ))}</tbody>
            </table>
            <div className="totals">
              <div><span>Subtotal</span><span>{money(d.order.subtotal)}</span></div>
              {d.order.discount > 0 && <div><span>Discount</span><span>-{money(d.order.discount)}</span></div>}
              <div><span>Tax</span><span>{money(d.order.tax)}</span></div>
              <div className="grand"><span>Total</span><span>{money(d.order.total)}</span></div>
            </div>
            <h4 style={{ margin: '4px 0' }}>Payments</h4>
            {d.payments.length === 0 && <p className="muted small">No payments recorded.</p>}
            {d.payments.map((p) => (
              <div key={p.id} className="row item-row"><span className="grow">{METHOD_LABEL[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}</span><span className="muted small">{new Date(p.createdAt).toLocaleTimeString()}</span><strong>{money(p.amount)}</strong></div>
            ))}
            <div className="row">
              <button className="ghost" onClick={onClose}>Close</button>
              <button className="primary grow" onClick={reprint}>Reprint bill</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
