"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type Props = {
  data: [number, number][];
  format: (v: number) => string;
  height?: number;
  color?: string;
  loading?: boolean;
  /** Value labels down the right edge plus a dashed line at the window's opening value. */
  axis?: boolean;
  /** Called with the hovered point (or null) so the page header can show it. */
  onHover?: (p: [number, number] | null) => void;
};

const DAY = 86_400_000;

/** Round tick values (1, 2, 2.5, 5 × 10ⁿ) covering [lo, hi]. */
function niceTicks(lo: number, hi: number, want = 4) {
  const raw = (hi - lo) / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** Time ticks on whole days (or whole hours for short spans), spaced so labels never collide. */
function timeTicks(t0: number, t1: number, width: number) {
  const fit = Math.max(2, Math.floor(width / 84));
  const span = t1 - t0;
  if (span <= 2 * DAY) {
    const stepH = [1, 2, 3, 4, 6, 8, 12, 24].find((h) => span / (h * 3_600_000) <= fit) ?? 24;
    const step = stepH * 3_600_000;
    const out: number[] = [];
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t);
    return { ticks: out, hourly: true };
  }
  const stepD = [1, 2, 3, 5, 7, 10, 14, 15, 30].find((d) => span / (d * DAY) <= fit) ?? 30;
  const out: number[] = [];
  const first = new Date(t0);
  first.setHours(0, 0, 0, 0);
  for (let t = first.getTime() + (first.getTime() < t0 ? DAY : 0); t <= t1; t += stepD * DAY) out.push(t);
  return { ticks: out, hourly: false };
}

/** Dependency-free line/area chart: real-pixel sizing, round axis values, date ticks by time, hover. */
export function LineChart({ data, format, height = 200, color = "var(--accent)", loading, axis, onHover }: Props) {
  const id = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  const [hover, setHover] = useState<number | null>(null);

  // Draw at the container's real width so labels stay 11px instead of scaling with the SVG.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const g = useMemo(() => {
    if (data.length < 2) return null;
    const xs = data.map((d) => d[0]);
    const ys = data.map((d) => d[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (lo === hi) { lo -= Math.abs(lo) * 0.01 || 1; hi += Math.abs(hi) * 0.01 || 1; }
    const pad = (hi - lo) * 0.12;
    let yTicks = niceTicks(lo - pad, hi + pad);
    if (yTicks.length < 3) yTicks = niceTicks(lo - pad, hi + pad, 8);
    const y0 = Math.min(lo - pad, yTicks[0]), y1 = Math.max(hi + pad, yTicks[yTicks.length - 1]);
    const labelW = axis ? Math.max(...yTicks.map((v) => format(v).length)) * 6.6 + 12 : 0;
    const P = { t: 10, r: axis ? labelW : 6, b: 24, l: 6 };
    const H = height;
    const sx = (x: number) => P.l + ((x - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
    const sy = (y: number) => P.t + (1 - (y - y0) / (y1 - y0)) * (H - P.t - P.b);
    const pts = data.map(([x, y]) => [sx(x), sy(y)] as const);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - P.b} L${pts[0][0].toFixed(1)},${H - P.b} Z`;
    const tt = timeTicks(x0, x1, W - P.l - P.r);
    return { pts, line, area, yTicks, sy, sx, H, P, base: sy(data[0][1]), xt: tt.ticks, hourly: tt.hourly };
  }, [data, height, W, axis, format]);

  const fmtTick = (ms: number) =>
    g?.hourly
      ? new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const set = (i: number | null) => { setHover(i); onHover?.(i === null ? null : data[i]); };

  return (
    <div ref={box} className="w-full">
      {!g ? (
        loading ? <div className="animate-pulse rounded-2xl bg-card-2" style={{ height }} aria-label="Loading history" /> : null
      ) : (
        <svg
          width={W}
          height={g.H}
          viewBox={`0 0 ${W} ${g.H}`}
          className="block max-w-full select-none"
          role="img"
          aria-label="History chart"
          onMouseLeave={() => set(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * W;
            let lo = 0, hi = g.pts.length - 1;
            while (hi - lo > 1) { const m = (lo + hi) >> 1; if (g.pts[m][0] < x) lo = m; else hi = m; }
            set(Math.abs(g.pts[lo][0] - x) <= Math.abs(g.pts[hi][0] - x) ? lo : hi);
          }}
        >
          <defs>
            <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.12" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {axis && g.yTicks.map((v) => (
            <g key={v}>
              <line x1={g.P.l} x2={W - g.P.r} y1={g.sy(v)} y2={g.sy(v)} stroke="var(--line)" />
              <text x={W - 2} y={g.sy(v) + 4} fontSize="11" fill="var(--faint)" textAnchor="end" className="tabular">{format(v)}</text>
            </g>
          ))}
          {axis && <line x1={g.P.l} x2={W - g.P.r} y1={g.base} y2={g.base} stroke="var(--muted)" strokeDasharray="3 4" strokeOpacity="0.5" />}
          <path d={g.area} fill={`url(#fill-${id})`} />
          <path d={g.line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
          {g.xt.map((t) => {
            const x = g.sx(t);
            const edgeL = x - g.P.l < 26, edgeR = W - g.P.r - x < 26;
            return (
              <text key={t} x={x} y={g.H - 6} fontSize="11" fill="var(--faint)" textAnchor={edgeL ? "start" : edgeR ? "end" : "middle"}>{fmtTick(t)}</text>
            );
          })}
          {(() => {
            const i = hover ?? g.pts.length - 1;
            return (
              <>
                {hover !== null && <line x1={g.pts[i][0]} x2={g.pts[i][0]} y1={g.P.t} y2={g.H - g.P.b} stroke="var(--faint)" strokeDasharray="2 3" />}
                <circle cx={g.pts[i][0]} cy={g.pts[i][1]} r="8" fill={color} fillOpacity="0.12" />
                <circle cx={g.pts[i][0]} cy={g.pts[i][1]} r="3.5" fill={color} stroke="var(--bg)" strokeWidth="1.5" />
              </>
            );
          })()}
        </svg>
      )}
    </div>
  );
}
