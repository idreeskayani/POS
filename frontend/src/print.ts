import type { Branch, Order } from './types';
import { round2 } from './util';

/* ---------- settings (stored per device/browser) ---------- */
export interface PrintSettings {
  width: 58 | 80;       // paper width in mm
  autoKot: boolean;     // cashier: ALSO print the kitchen slip on this device when an order is sent
  autoBill: boolean;    // cashier: print bill slip after payment
}
const DEFAULTS: PrintSettings = { width: 80, autoKot: false, autoBill: true };
export const getPrintSettings = (): PrintSettings => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('pos_print') || '{}') }; } catch { return DEFAULTS; }
};
export const savePrintSettings = (s: PrintSettings) => localStorage.setItem('pos_print', JSON.stringify(s));

/* ---------- helpers ---------- */
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const num = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (n: number, cur: string) => `${cur} ${num(n)}`;
const when = (d: string | Date) => new Date(d).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
const METHOD: Record<string, string> = { CASH: 'Cash', CARD: 'Card', ONLINE: 'Online' };

const CSS = `
*{box-sizing:border-box}
body{margin:0 auto;padding:2mm 0;color:#000;font-family:"Courier New",Consolas,monospace;font-size:12px;line-height:1.35}
.c{text-align:center}.b{font-weight:700}.big{font-size:16px}.xl{font-size:22px}
.hr{border-top:1px dashed #000;margin:5px 0}
.r{display:flex;justify-content:space-between;gap:6px}.r>span:first-child{flex:1}
.note{padding-left:10px;font-style:italic}.item{margin:3px 0}
.tot{font-size:15px;font-weight:700}.chg{font-size:17px;font-weight:700}
`;

/** Prints an HTML snippet as a thermal slip via a hidden iframe (uses the browser's print dialog / default printer). */
export function printSlip(inner: string, width: number) {
  const printable = width === 58 ? 48 : 72; // usable mm on 58mm / 80mm paper
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow!.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${width}mm auto;margin:0}body{width:${printable}mm}${CSS}</style></head><body>${inner}</body></html>`);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 150);
}

/* ---------- Kitchen order slip (no prices) ---------- */
export function kotHtml(o: { branch: Branch; order: Order; where: string; by?: string }) {
  const { branch, order, where, by } = o;
  const qty = order.items.reduce((s, i) => s + i.quantity, 0);
  return `
<div class="c b">${esc(branch.name)}</div>
<div class="c b big">KITCHEN ORDER</div>
<div class="c b xl">${esc(order.orderNumber)}</div>
<div class="c b big">${esc(where.toUpperCase())}</div>
<div class="hr"></div>
<div class="r"><span>${esc(when(order.createdAt))}</span><span>${by ? 'By ' + esc(by) : ''}</span></div>
<div class="hr"></div>
${order.items.map((i) => `<div class="item big b">${i.quantity} x ${esc(i.name)}</div>${i.notes ? `<div class="note">** ${esc(i.notes)}</div>` : ''}`).join('')}
${order.notes ? `<div class="hr"></div><div class="b">NOTE: ${esc(order.notes)}</div>` : ''}
<div class="hr"></div>
<div class="c">${qty} item(s)</div>`;
}

/* ---------- Customer bill ---------- */
export interface Tender { method: string; tendered: number; applied: number }

export function billHtml(o: { branch: Branch; order: Order; where: string; cashier?: string; tenders?: Tender[]; at?: string | Date; reprint?: boolean }) {
  const { branch, order, where, cashier } = o;
  const cur = branch.currency;
  const tenders = o.tenders ?? [];
  const applied = round2(tenders.reduce((s, t) => s + t.applied, 0));
  const change = round2(tenders.reduce((s, t) => s + (t.tendered - t.applied), 0));
  const balance = round2(Math.max(0, order.total - applied));
  const paid = tenders.length > 0 && balance <= 0;

  return `
<div class="c b big">${esc(branch.name)}</div>
${branch.address ? `<div class="c">${esc(branch.address)}</div>` : ''}
<div class="hr"></div>
<div class="r"><span>Order: <b>${esc(order.orderNumber)}</b></span><span>${esc(where)}</span></div>
<div class="r"><span>${esc(when(o.at ?? new Date()))}</span><span>${cashier ? esc(cashier) : ''}</span></div>
${o.reprint ? `<div class="c b">*** DUPLICATE COPY ***</div>` : ''}
<div class="hr"></div>
${order.items.map((i) => `<div class="item"><div>${esc(i.name)}</div><div class="r"><span>&nbsp;&nbsp;${i.quantity} x ${num(i.unitPrice)}</span><span>${num(i.lineTotal)}</span></div>${i.notes ? `<div class="note">${esc(i.notes)}</div>` : ''}</div>`).join('')}
<div class="hr"></div>
<div class="r"><span>Subtotal</span><span>${num(order.subtotal)}</span></div>
${order.discount > 0 ? `<div class="r"><span>Discount</span><span>-${num(order.discount)}</span></div>` : ''}
${order.tax > 0 ? `<div class="r"><span>Tax (${num(branch.taxRate)}%)</span><span>${num(order.tax)}</span></div>` : ''}
<div class="hr"></div>
<div class="r tot"><span>TOTAL</span><span>${money(order.total, cur)}</span></div>
<div class="hr"></div>
${tenders.length === 0 ? `<div class="c b">** PRE-BILL - NOT PAID **</div>` : ''}
${tenders.map((t) => `<div class="r"><span>${METHOD[t.method] ?? t.method} received</span><span>${money(t.tendered, cur)}</span></div>`).join('')}
${change > 0 ? `<div class="r chg"><span>CHANGE</span><span>${money(change, cur)}</span></div>` : ''}
${tenders.length > 0 && balance > 0 ? `<div class="r b"><span>Balance due</span><span>${money(balance, cur)}</span></div>` : ''}
${paid ? `<div class="c b">PAID</div>` : ''}
<div class="hr"></div>
<div class="c">Thank you! Visit again.</div>`;
}
