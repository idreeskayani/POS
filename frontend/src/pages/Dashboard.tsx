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
  topItems: { menuItemId: string; name: string; qty: number; revenue: number }[];
  byCategory: { categoryId: string | null; name: string; revenue: number; qty: number }[];
  byType: { type: string; orders: number; sales: number }[];
  byPayment: { method: string; amount: number; count: number }[];
  byBranch: { branchId: string; name: string; orders: number; sales: number }[];
  byStaff: { userId: string; name: string; role: string; orders: number; sales: number }[];
  live: { byStatus: { status: string; count: number; value: number }[]; tables: { total: number; occupied: number } };
}
interface HistRow {
  id: string; orderNumber: string; status: string; type: string; total: number; subtotal: number; tax: number; discount: number;
  createdAt: string; branchId: string; branch: string; staff: string | null; tableLabel: string | null; items: string | null; methods: string | null;
}
interface OrdersPage { total: number; sum: number; sumTax: number; sumDiscount: number; rows: HistRow[] }
interface SoldItem { menuItemId: string; name: string; category: string; qty: number; revenue: number; orders: number }

/** What the details panel is showing. */
interface OrdersDrill { kind: 'orders'; title: string; extra?: Record<string, string>; live?: boolean; from?: Date; to?: Date; branchId?: string; emphasize?: 'tax' | 'discount' }
interface ItemsDrill { kind: 'items'; title: string }
type Drill = OrdersDrill | ItemsDrill;

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';
const PRESETS: [Preset, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['custom', 'Custom']];
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TYPE_LABEL: Record<string, string> = { DINE_IN: 'Dine-in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery' };
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', CARD: 'Card', ONLINE: 'Online' };
const LIVE_ORDER = ['SENT', 'PREPARING', 'READY', 'SERVED', 'OPEN'];
const PAID = { status: 'PAID' };

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

/** Bars for every hour/day of the range (empty ones included), each remembering its own time window. */
function fillSeries(s: Summary, from: Date, to: Date): { bars: Bar[]; windows: { from: Date; to: Date }[] } {
  const hour = s.granularity === 'hour';
  const map = new Map(s.series.map((x) => [x.bucket, x]));
  const bars: Bar[] = [];
  const windows: { from: Date; to: Date }[] = [];
  const cur = hour ? new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours()) : sod(from);
  while (cur < to && bars.length < 400) {
    const start = new Date(cur);
    const end = hour ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours() + 1) : addDays(start, 1);
    const hit = map.get(key(cur, hour));
    bars.push({
      label: hour ? cur.toLocaleTimeString([], { hour: 'numeric' }) : cur.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      value: hit?.sales ?? 0,
      tip: `${hit?.orders ?? 0} orders`,
    });
    windows.push({ from: start, to: end });
    if (hour) cur.setHours(cur.getHours() + 1); else cur.setDate(cur.getDate() + 1);
  }
  return { bars, windows };
}

const delta = (cur: number, prev: number) => (prev === 0 ? (cur > 0 ? null : 0) : ((cur - prev) / prev) * 100);
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

/* ---------- small components ---------- */
function Kpi({ label, value, sub, change, hint, onClick }: { label: string; value: string; sub?: string; change?: number | null | undefined; hint?: string; onClick?: () => void }) {
  return (
    <div
      className={`card kpi ${onClick ? 'clickable' : ''}`} title={hint}
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onClick={onClick} onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}
    >
      <span className="muted small">{label}</span>
      <strong className="kpi-v">{value}</strong>
      <div className="kpi-sub">
        {change === undefined ? null : change === null ? <span className="chg up">new</span> : change === 0 ? <span className="muted small">no change</span> : (
          <span className={change > 0 ? 'chg up' : 'chg down'}>{change > 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%</span>
        )}
        {sub && <span className="muted small">{sub}</span>}
        {onClick && <span className="kpi-go">View →</span>}
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
  const [stack, setStack] = useState<Drill[]>([]);

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

  const { bars: trend, windows } = useMemo(() => (data ? fillSeries(data, from, to) : { bars: [] as Bar[], windows: [] }), [data]);
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

  /* drill-down openers */
  const open = (d: Drill) => setStack([d]);
  const openPaid = () => open({ kind: 'orders', title: 'Paid orders', extra: PAID });
  const openItem = (i: { menuItemId: string; name: string }) => open({ kind: 'orders', title: `Orders with ${i.name}`, extra: { ...PAID, menuItemId: i.menuItemId } });
  const openCategory = (c: { categoryId: string | null; name: string }) => c.categoryId && open({ kind: 'orders', title: `Orders with ${c.name}`, extra: { ...PAID, categoryId: c.categoryId } });
  const openType = (type: string) => open({ kind: 'orders', title: `${TYPE_LABEL[type] ?? type} orders`, extra: { ...PAID, type } });
  const openMethod = (m: string) => open({ kind: 'orders', title: `Paid with ${METHOD_LABEL[m] ?? m}`, extra: { ...PAID, paymentMethod: m } });
  const openHour = (h: number) => open({ kind: 'orders', title: `Paid orders at ${hourLabel(h)}`, extra: { ...PAID, hour: String(h) } });
  const openBucket = (i: number) => open({ kind: 'orders', title: `Paid orders · ${trend[i].label}`, extra: PAID, from: windows[i].from, to: windows[i].to });
  const openLive = (status?: string) => open({ kind: 'orders', title: status ? `${status} orders right now` : 'Open orders right now', live: true, extra: status ? { status } : undefined });

  const k = data?.kpis, pv = data?.previous;
  const peakHour = hourly.findIndex((h) => h.hl);
  const bestDayIdx = data && data.granularity === 'day' && trend.length > 1 ? trend.reduce((best, b, i) => (b.value > trend[best].value ? i : best), 0) : -1;
  const liveCount = data?.live.byStatus.reduce((s, x) => s + x.count, 0) ?? 0;
  const liveValue = data?.live.byStatus.reduce((s, x) => s + x.value, 0) ?? 0;
  const rangeLabel = `${from.toLocaleDateString([], { dateStyle: 'medium' })} – ${addDays(to, -1).toLocaleDateString([], { dateStyle: 'medium' })}`;
  const current_ = stack[stack.length - 1];

  return (
    <div className="dash">
      <div className="card dash-head">
        <div className="row wrap">
          <div className="grow">
            <h2 style={{ margin: 0 }}>Dashboard</h2>
            <span className="muted small">{rangeLabel} · {TZ}{updated ? ` · updated ${updated.toLocaleTimeString()}` : ''} · click any card, bar or row to see the orders behind it</span>
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
            <Kpi label="Net sales" value={money(k.sales)} change={delta(k.sales, pv.sales)} sub="vs previous" hint="Total of paid orders (incl. tax, after discounts)" onClick={openPaid} />
            <Kpi label="Paid orders" value={String(k.orders)} change={delta(k.orders, pv.orders)} onClick={openPaid} />
            <Kpi label="Average order value" value={money(k.avgOrder)} change={delta(k.avgOrder, pv.avgOrder)} onClick={openPaid} />
            <Kpi label="Items sold" value={String(k.itemsSold)} change={delta(k.itemsSold, pv.itemsSold)} onClick={() => open({ kind: 'items', title: 'Items sold' })} />
            <Kpi label="Tax collected" value={money(k.tax)} change={delta(k.tax, pv.tax)} onClick={() => open({ kind: 'orders', title: 'Tax collected', extra: { ...PAID, hasTax: '1' }, emphasize: 'tax' })} />
            <Kpi label="Discounts given" value={money(k.discounts)} change={delta(k.discounts, pv.discounts)} onClick={() => open({ kind: 'orders', title: 'Discounts given', extra: { ...PAID, hasDiscount: '1' }, emphasize: 'discount' })} />
            <Kpi label="Cancelled orders" value={String(k.cancelledOrders)} sub={money(k.cancelledValue)} onClick={() => open({ kind: 'orders', title: 'Cancelled orders', extra: { status: 'CANCELLED' } })} />
            <Kpi label="Open right now" value={String(liveCount)} sub={`${money(liveValue)} unpaid`} onClick={() => openLive()} />
          </div>

          <div className="insights">
            <div className={peakHour >= 0 ? 'clickable' : ''} onClick={() => peakHour >= 0 && openHour(peakHour)}><span className="muted small">Peak hour</span><strong>{peakHour >= 0 ? hourLabel(peakHour) : '—'}</strong></div>
            <div className={bestDayIdx >= 0 ? 'clickable' : ''} onClick={() => bestDayIdx >= 0 && openBucket(bestDayIdx)}><span className="muted small">Best day</span><strong>{bestDayIdx >= 0 ? `${trend[bestDayIdx].label} · ${money(trend[bestDayIdx].value)}` : '—'}</strong></div>
            <div className={data.topItems[0] ? 'clickable' : ''} onClick={() => data.topItems[0] && openItem(data.topItems[0])}><span className="muted small">Best seller</span><strong>{data.topItems[0] ? `${data.topItems[0].name} (${data.topItems[0].qty})` : '—'}</strong></div>
            <div className={data.byPayment[0] ? 'clickable' : ''} onClick={() => data.byPayment[0] && openMethod(data.byPayment[0].method)}><span className="muted small">Top payment method</span><strong>{data.byPayment[0] ? METHOD_LABEL[data.byPayment[0].method] ?? data.byPayment[0].method : '—'}</strong></div>
            <div><span className="muted small">Discount rate</span><strong>{k.sales + k.discounts > 0 ? ((k.discounts / (k.sales + k.discounts)) * 100).toFixed(1) + '%' : '—'}</strong></div>
            <div><span className="muted small">Cancellation rate</span><strong>{k.orders + k.cancelledOrders > 0 ? ((k.cancelledOrders / (k.orders + k.cancelledOrders)) * 100).toFixed(1) + '%' : '—'}</strong></div>
          </div>

          <div className="dash-grid two-one">
            <Section title={`Sales ${data.granularity === 'hour' ? 'by hour' : 'by day'}`}>
              <BarChart data={trend} format={money} onBarClick={openBucket} />
            </Section>
            <Section title="Live right now" right={<span className="muted small">auto-refreshes</span>}>
              <div className="live">
                {LIVE_ORDER.map((st) => {
                  const row = data.live.byStatus.find((x) => x.status === st);
                  return row || st !== 'OPEN' ? (
                    <div key={st} className={`row ${row ? 'clickable live-row' : ''}`} onClick={() => row && openLive(st)}>
                      <span className={`badge ${st}`}>{st}</span><div className="spacer" /><strong>{row?.count ?? 0}</strong><span className="muted small">{money(row?.value ?? 0)}</span>
                    </div>
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
              <BarChart data={hourly} format={money} height={200} color="#1c7ed6" onBarClick={openHour} />
            </Section>
            <Section title="Order types">
              <Donut slices={data.byType.map((t) => ({ label: TYPE_LABEL[t.type] ?? t.type, value: t.sales }))} format={money} centerLabel="sales" onSliceClick={(i) => openType(data.byType[i].type)} />
              <table className="tbl"><thead><tr><th>Type</th><th className="num">Orders</th><th className="num">Sales</th><th className="num">Avg</th></tr></thead>
                <tbody>{data.byType.map((t) => <tr key={t.type} className="click" onClick={() => openType(t.type)}><td>{TYPE_LABEL[t.type] ?? t.type}</td><td className="num">{t.orders}</td><td className="num">{money(t.sales)}</td><td className="num">{money(t.orders ? t.sales / t.orders : 0)}</td></tr>)}</tbody></table>
            </Section>
          </div>

          <div className="dash-grid two">
            <Section title="Top selling items" right={<button className="ghost" onClick={() => open({ kind: 'items', title: 'Items sold' })}>All items</button>}>
              <RankList rows={data.topItems.map((i) => ({ label: i.name, value: i.revenue, sub: `${i.qty} sold` }))} format={money} onRowClick={(i) => openItem(data.topItems[i])} />
            </Section>
            <Section title="Sales by category">
              <Donut slices={data.byCategory.map((c) => ({ label: c.name, value: c.revenue }))} format={money} centerLabel="revenue" onSliceClick={(i) => openCategory(data.byCategory[i])} />
            </Section>
          </div>

          <div className="dash-grid two">
            <Section title="Payment methods" right={<span className="muted small">money received in period</span>}>
              <Donut slices={data.byPayment.map((p) => ({ label: METHOD_LABEL[p.method] ?? p.method, value: p.amount }))} format={money} centerLabel="received" onSliceClick={(i) => openMethod(data.byPayment[i].method)} />
              <table className="tbl"><thead><tr><th>Method</th><th className="num">Payments</th><th className="num">Amount</th></tr></thead>
                <tbody>{data.byPayment.map((p) => <tr key={p.method} className="click" onClick={() => openMethod(p.method)}><td>{METHOD_LABEL[p.method] ?? p.method}</td><td className="num">{p.count}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody></table>
            </Section>
            <Section title="Staff performance" right={<span className="muted small">orders taken</span>}>
              <table className="tbl"><thead><tr><th>Staff</th><th>Role</th><th className="num">Orders</th><th className="num">Sales</th><th className="num">Avg</th></tr></thead>
                <tbody>
                  {data.byStaff.length === 0 && <tr><td colSpan={5} className="muted">No data for this period.</td></tr>}
                  {data.byStaff.map((s) => (
                    <tr key={s.userId} className="click" onClick={() => open({ kind: 'orders', title: `Orders by ${s.name}`, extra: { ...PAID, staffId: s.userId } })}>
                      <td>{s.name}</td><td><span className={`badge ${s.role}`}>{s.role}</span></td><td className="num">{s.orders}</td><td className="num">{money(s.sales)}</td><td className="num">{money(s.orders ? s.sales / s.orders : 0)}</td>
                    </tr>
                  ))}
                </tbody></table>
            </Section>
          </div>

          {orgWide && data.byBranch.length > 0 && (
            <Section title="Branch comparison">
              <table className="tbl"><thead><tr><th>Branch</th><th className="num">Orders</th><th className="num">Sales</th><th className="num">Avg order</th><th>Share</th></tr></thead>
                <tbody>{data.byBranch.map((b) => {
                  const total = data.byBranch.reduce((s, x) => s + x.sales, 0);
                  return (
                    <tr key={b.branchId} className="click" onClick={() => open({ kind: 'orders', title: `${b.name} · paid orders`, extra: PAID, branchId: b.branchId })}>
                      <td>{b.name}</td><td className="num">{b.orders}</td><td className="num">{money(b.sales)}</td><td className="num">{money(b.orders ? b.sales / b.orders : 0)}</td>
                      <td style={{ width: '28%' }}><div className="meter"><div style={{ width: `${total ? (b.sales / total) * 100 : 0}%` }} /></div></td>
                    </tr>
                  );
                })}</tbody></table>
            </Section>
          )}
        </>
      )}

      <Section title="Order history" right={<span className="muted small">all orders in the selected range</span>}>
        <OrdersList from={from} to={to} branchId={branchId} branches={branches} fallbackBranch={current} money={money} refreshKey={updated?.getTime() ?? 0} withStatus />
      </Section>

      {current_ && (
        <Drawer title={current_.title} canBack={stack.length > 1} onBack={() => setStack((s) => s.slice(0, -1))} onClose={() => setStack([])}>
          {current_.kind === 'items' ? (
            <ItemsList from={from} to={to} branchId={branchId} money={money} onPick={(i) => setStack((s) => [...s, { kind: 'orders', title: `Orders with ${i.name}`, extra: { ...PAID, menuItemId: i.menuItemId } }])} />
          ) : (
            <OrdersList
              key={JSON.stringify([current_.title, current_.extra, current_.live])}
              from={current_.from ?? from} to={current_.to ?? to} branchId={current_.branchId ?? branchId}
              extra={current_.extra} live={current_.live} emphasize={current_.emphasize}
              branches={branches} fallbackBranch={current} money={money} refreshKey={0}
            />
          )}
        </Drawer>
      )}
    </div>
  );
}

/* ---------- slide-in details panel ---------- */
function Drawer({ title, canBack, onBack, onClose, children }: { title: string; canBack: boolean; onBack: () => void; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          {canBack && <button className="ghost" onClick={onBack}>← Back</button>}
          <h3 className="grow">{title}</h3>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/* ---------- every item sold ---------- */
function ItemsList({ from, to, branchId, money, onPick }: { from: Date; to: Date; branchId: string; money: (n: number) => string; onPick: (i: SoldItem) => void }) {
  const [items, setItems] = useState<SoldItem[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), ...(branchId ? { branchId } : {}) });
    api<SoldItem[]>(`/reports/items?${qs}`).then(setItems).catch((e) => setError(e.message));
  }, [from.getTime(), to.getTime(), branchId]);
  const shown = (items ?? []).filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack">
      {error && <div className="error">{error}</div>}
      <input placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!items && !error && <p className="muted">Loading…</p>}
      {items && <div className="muted small">{items.reduce((s, i) => s + i.qty, 0)} items sold · {money(items.reduce((s, i) => s + i.revenue, 0))} · click an item to see its orders</div>}
      <div className="table-scroll">
        <table className="tbl">
          <thead><tr><th>Item</th><th>Category</th><th className="num">Qty</th><th className="num">Orders</th><th className="num">Revenue</th></tr></thead>
          <tbody>
            {items && shown.length === 0 && <tr><td colSpan={5} className="muted">No items sold in this period.</td></tr>}
            {shown.map((i) => (
              <tr key={i.menuItemId + i.name} className="click" onClick={() => onPick(i)}>
                <td><strong>{i.name}</strong></td><td>{i.category}</td><td className="num">{i.qty}</td><td className="num">{i.orders}</td><td className="num">{money(i.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- orders list (order history + every drill-down) ---------- */
function OrdersList({ from, to, branchId, extra, live, emphasize, withStatus, branches, fallbackBranch, money, refreshKey }: {
  from: Date; to: Date; branchId: string; extra?: Record<string, string>; live?: boolean; emphasize?: 'tax' | 'discount'; withStatus?: boolean;
  branches: Branch[]; fallbackBranch: Branch; money: (n: number) => string; refreshKey: number;
}) {
  const [rows, setRows] = useState<HistRow[]>([]);
  const [agg, setAgg] = useState({ total: 0, sum: 0, sumTax: 0, sumDiscount: 0 });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const PAGE = 25;
  const extraKey = JSON.stringify(extra ?? {});

  const fetchPage = useCallback(async (offset: number, query: string) => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({
        limit: String(PAGE), offset: String(offset), tz: TZ,
        ...(live ? { live: '1' } : { from: from.toISOString(), to: to.toISOString() }),
        ...(branchId ? { branchId } : {}),
        ...(extra ?? {}),
        ...(withStatus && status ? { status } : {}),
        ...(query ? { q: query } : {}),
      });
      const r = await api<OrdersPage>(`/reports/orders?${qs}`);
      setAgg({ total: r.total, sum: r.sum, sumTax: r.sumTax, sumDiscount: r.sumDiscount });
      setRows((prev) => (offset === 0 ? r.rows : [...prev, ...r.rows]));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [from.getTime(), to.getTime(), branchId, status, live, extraKey, withStatus]);

  useEffect(() => {
    const t = setTimeout(() => fetchPage(0, q.trim()), 250);
    return () => clearTimeout(t);
  }, [fetchPage, q, refreshKey]);

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Order', 'Date', 'Branch', 'Type', 'Table', 'Staff', 'Items', 'Paid with', 'Status', 'Subtotal', 'Discount', 'Tax', 'Total'];
    const lines = rows.map((r) => [r.orderNumber, new Date(r.createdAt).toLocaleString(), r.branch, TYPE_LABEL[r.type] ?? r.type, r.tableLabel ?? '', r.staff ?? '', r.items ?? '', r.methods ?? '', r.status, r.subtotal, r.discount, r.tax, r.total].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="stack">
      <div className="summary-bar">
        <span><strong>{agg.total}</strong> orders</span>
        <span>Total <strong>{money(agg.sum)}</strong></span>
        {emphasize === 'tax' && <span>Tax <strong>{money(agg.sumTax)}</strong></span>}
        {emphasize === 'discount' && <span>Discounts <strong>{money(agg.sumDiscount)}</strong></span>}
      </div>
      <div className="row wrap">
        <input className="grow" placeholder="Search order number (e.g. BR1-0042)" value={q} onChange={(e) => setQ(e.target.value)} />
        {withStatus && (
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['PAID', 'CANCELLED', 'SENT', 'PREPARING', 'READY', 'SERVED'].map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        <button onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="table-scroll">
        <table className="tbl hist">
          <thead>
            <tr>
              <th>Order</th><th>Time</th><th>Type / table</th><th>Items</th><th>Status</th>
              {emphasize === 'tax' && <th className="num">Tax</th>}
              {emphasize === 'discount' && <th className="num">Discount</th>}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && <tr><td colSpan={8} className="muted">No orders found.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="click" onClick={() => setOpenId(r.id)}>
                <td><strong>{r.orderNumber}</strong><div className="muted small">{r.branch}{r.staff ? ` · ${r.staff}` : ''}</div></td>
                <td>{new Date(r.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{r.tableLabel ?? TYPE_LABEL[r.type] ?? r.type}</td>
                <td className="items-cell">{r.items ?? '—'}{r.methods && <div className="muted small">Paid: {r.methods}</div>}</td>
                <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                {emphasize === 'tax' && <td className="num">{money(r.tax)}</td>}
                {emphasize === 'discount' && <td className="num">{money(r.discount)}</td>}
                <td className="num">{money(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length < agg.total && <button className="ghost" disabled={loading} onClick={() => fetchPage(rows.length, q.trim())}>{loading ? 'Loading…' : `Load more (${agg.total - rows.length} left)`}</button>}
      {openId && <OrderDetail id={openId} branches={branches} fallbackBranch={fallbackBranch} money={money} onClose={() => setOpenId(null)} />}
    </div>
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
    <div className="modal-bg" onClick={(e) => { e.stopPropagation(); onClose(); }}>
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
