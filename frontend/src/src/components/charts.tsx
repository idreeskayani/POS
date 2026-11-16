import { useState } from 'react';

export const PALETTE = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#d6336c', '#5c7cfa'];

export const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  return String(Math.round(n));
};

function niceMax(v: number) {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / e;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * e;
}

export interface Bar { label: string; value: number; tip?: string; hl?: boolean }

export function BarChart({ data, format, height = 230, color = '#e8590c' }: { data: Bar[]; format: (n: number) => string; height?: number; color?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, padL = 46, padR = 8, padT = 12, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const step = innerW / Math.max(1, data.length);
  const bw = Math.min(42, Math.max(2, step * 0.68));
  const every = Math.ceil(data.length / 12);
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
        {ticks.map((t) => {
          const y = padT + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#e9ecef" />
              <text x={padL - 6} y={y + 4} textAnchor="end" className="axis">{compact(t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = max ? (d.value / max) * innerH : 0;
          const x = padL + i * step + (step - bw) / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * step} y={padT} width={step} height={innerH} fill="transparent" />
              <rect x={x} y={padT + innerH - h} width={bw} height={Math.max(h, d.value > 0 ? 1 : 0)} rx={2}
                fill={d.hl ? '#c92a2a' : color} opacity={hover === null || hover === i ? 1 : 0.55} />
              {i % every === 0 && <text x={padL + i * step + step / 2} y={H - 8} textAnchor="middle" className="axis">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      <div className="chart-tip">
        {hover !== null ? <><strong>{data[hover].label}</strong>: {format(data[hover].value)}{data[hover].tip ? ` · ${data[hover].tip}` : ''}</> : <span className="muted">Hover a bar for details</span>}
      </div>
    </div>
  );
}

export function Donut({ slices, format, centerLabel }: { slices: { label: string; value: number }[]; format: (n: number) => string; centerLabel?: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 120 120" className="donut">
        <circle cx="60" cy="60" r={R} fill="none" stroke="#eef1f5" strokeWidth="16" />
        {total > 0 && slices.map((s, i) => {
          const frac = s.value / total;
          const el = (
            <circle key={s.label} cx="60" cy="60" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="16"
              strokeDasharray={`${frac * C} ${C - frac * C}`} strokeDashoffset={-acc * C} transform="rotate(-90 60 60)" />
          );
          acc += frac;
          return el;
        })}
        <text x="60" y="58" textAnchor="middle" className="donut-total">{compact(total)}</text>
        {centerLabel && <text x="60" y="72" textAnchor="middle" className="axis">{centerLabel}</text>}
      </svg>
      <ul className="legend">
        {slices.length === 0 && <li className="muted">No data</li>}
        {slices.map((s, i) => (
          <li key={s.label}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="grow">{s.label}</span>
            <strong>{format(s.value)}</strong>
            <span className="muted small">{total ? Math.round((s.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RankList({ rows, format }: { rows: { label: string; value: number; sub?: string }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="muted">No data for this period.</p>;
  return (
    <div className="rank">
      {rows.map((r, i) => (
        <div key={r.label + i} className="rank-row">
          <div className="rank-head">
            <span><span className="rank-n">{i + 1}</span>{r.label}</span>
            <span><strong>{format(r.value)}</strong>{r.sub && <span className="muted small"> · {r.sub}</span>}</span>
          </div>
          <div className="rank-bar"><div style={{ width: `${(r.value / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} /></div>
        </div>
      ))}
    </div>
  );
}
