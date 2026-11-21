import { useEffect, useState } from 'react'

/** Lightweight SVG charts (no library): a line chart with optional extra lines/bands, and a donut. */
export interface Line {
  values: (number | null)[]
  color: string
  width?: number
  dash?: string
  label?: string
}

export interface Marker {
  i: number
  value: number
  label: string
  color: string
}

/**
 * Line chart. Optional: a shaded band (e.g. Bollinger Bands; null values are skipped), a value axis with three
 * labelled grid lines, a fixed value range (e.g. RSI 0–100) and markers (e.g. the shoulders and the head of a pattern).
 * The tooltip follows the mouse or a finger.
 */
export function LineChart({ x, lines, band, height = 220, testId, format = (v: number) => v.toFixed(0), axis = false, range, markers = [] }: { x: string[]; lines: Line[]; band?: { lo: (number | null)[]; hi: (number | null)[]; color: string }; height?: number; testId?: string; format?: (v: number) => string; axis?: boolean; range?: [number, number]; markers?: Marker[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = height
  const P = { l: 8, r: 8, t: 10, b: 22 }
  const all = [...lines.flatMap((l) => l.values), ...(band ? [...band.lo, ...band.hi] : []), ...markers.map((m) => m.value)].filter((v): v is number => v !== null && Number.isFinite(v))
  if (!all.length || x.length < 2) return <div className="flex h-40 items-center justify-center text-stone-400">–</div>
  let min = range ? range[0] : Math.min(...all)
  let max = range ? range[1] : Math.max(...all)
  if (min === max) {
    min -= 1
    max += 1
  }
  if (!range) {
    const pad = (max - min) * 0.06
    min -= pad
    max += pad
  }
  const sx = (i: number) => P.l + (i / (x.length - 1)) * (W - P.l - P.r)
  const sy = (v: number) => P.t + (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min)) * (H - P.t - P.b)
  const grid = axis ? [max - (max - min) * 0.1, (max + min) / 2, min + (max - min) * 0.1] : []
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left) / r.width) * (x.length - 1))
    setHover(Math.max(0, Math.min(x.length - 1, i)))
  }
  const path = (vals: readonly (number | null)[]) => {
    let d = ''
    let pen = false
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) return void (pen = false)
      d += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`
      pen = true
    })
    return d
  }
  const ticks = [...new Set([0, Math.floor((x.length - 1) / 2), x.length - 1])]
  // band: only where both edges are known
  let bandD = ''
  if (band) {
    const idx = band.lo.map((_v, i) => i).filter((i) => band.lo[i] != null && band.hi[i] != null && Number.isFinite(band.lo[i]!) && Number.isFinite(band.hi[i]!))
    if (idx.length > 1) bandD = `M${idx.map((i) => `${sx(i).toFixed(1)},${sy(band.hi[i]!).toFixed(1)}`).join('L')}L${[...idx].reverse().map((i) => `${sx(i).toFixed(1)},${sy(band.lo[i]!).toFixed(1)}`).join('L')}Z`
  }
  return (
    <div className="relative" data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-pan-y" onPointerLeave={() => setHover(null)} onPointerMove={move} onPointerDown={move} role="img">
        {grid.map((v, k) => (
          <g key={`g${k}`}>
            <line x1={P.l} x2={W - P.r} y1={sy(v)} y2={sy(v)} stroke="#e7e5e4" />
            <text x={W - P.r} y={sy(v) - 3} fontSize="10" fill="#78716c" textAnchor="end" stroke="white" strokeWidth="3" paintOrder="stroke">
              {format(v)}
            </text>
          </g>
        ))}
        {bandD && <path d={bandD} fill={band!.color} opacity={0.25} />}
        {lines.map((l, k) => {
          const d = path(l.values)
          // a line with no points yet (e.g. an animation at its start) is not drawn at all
          return d ? <path key={k} d={d} fill="none" stroke={l.color} strokeWidth={l.width ?? 2} strokeDasharray={l.dash} /> : null
        })}
        {markers
          .filter((m) => m.i >= 0 && m.i < x.length && Number.isFinite(m.value))
          .map((m, k) => (
            <g key={`m${k}`}>
              <circle cx={sx(m.i)} cy={sy(m.value)} r="4" fill={m.color} stroke="white" strokeWidth="1.5" />
              {m.label && (
                <text x={Math.min(W - P.r - 6, Math.max(P.l + 6, sx(m.i)))} y={Math.max(P.t + 10, sy(m.value) - 7)} fontSize="11" fontWeight="700" fill={m.color} textAnchor="middle" stroke="white" strokeWidth="3" paintOrder="stroke">
                  {m.label}
                </text>
              )}
            </g>
          ))}
        {ticks.map((i) => (
          <text key={i} x={sx(i)} y={H - 6} fontSize="11" fill="#78716c" textAnchor={i === 0 ? 'start' : i === x.length - 1 ? 'end' : 'middle'}>
            {x[i]}
          </text>
        ))}
        {hover !== null && <line x1={sx(hover)} x2={sx(hover)} y1={P.t} y2={H - P.b} stroke="#a8a29e" strokeDasharray="3 3" />}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute left-2 top-1 rounded-lg bg-white/95 px-2 py-1 text-xs shadow">
          <div className="font-semibold">{x[hover]}</div>
          {lines.map((l, k) =>
            l.values[hover] != null ? (
              <div key={k} style={{ color: l.color }}>
                {l.label ? `${l.label}: ` : ''}
                {format(l.values[hover]!)}
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Horizontal strip of bull (green) and bear (red) market periods over the dates of a chart. Plain HTML with a fixed
 * height (not a scaled SVG), so the labels stay readable on a phone.
 */
export function PhaseBar({ x, segments, labels, testId }: { x: string[]; segments: { kind: 'bull' | 'bear'; from: string; to: string }[]; labels: { bull: string; bear: string }; testId?: string }) {
  if (x.length < 2) return null
  const first = x[0]
  const last = x[x.length - 1]
  const pos = (d: string) => {
    if (d <= first) return 0
    if (d >= last) return x.length - 1
    let lo = 0
    let hi = x.length - 1
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (x[m] < d) lo = m + 1
      else hi = m
    }
    return lo
  }
  const pct = (i: number) => (i / (x.length - 1)) * 100
  const parts = segments.filter((s) => s.to >= first && s.from <= last).map((s) => ({ ...s, a: pct(pos(s.from)), b: pct(pos(s.to)) }))
  return (
    <div className="relative h-6 w-full overflow-hidden rounded bg-stone-100" role="img" aria-label={parts.map((p) => `${labels[p.kind]} ${p.from} – ${p.to}`).join(', ')} data-testid={testId}>
      {parts.map((p, k) => (
        <div key={k} className={`absolute inset-y-0 flex items-center justify-center overflow-hidden text-xs font-bold whitespace-nowrap text-white ${p.kind === 'bull' ? 'bg-up' : 'bg-down'}`} style={{ left: `${p.a}%`, width: `${Math.max(0.3, p.b - p.a)}%` }} data-phase={p.kind}>
          {p.b - p.a > 14 ? labels[p.kind] : ''}
        </div>
      ))}
    </div>
  )
}

export function Donut({ parts, size = 180, testId }: { parts: { label: string; value: number; color: string }[]; size?: number; testId?: string }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0)
  const r = 70
  const c = 2 * Math.PI * r
  let acc = 0
  return (
    <svg viewBox="0 0 180 180" width={size} height={size} data-testid={testId} role="img">
      <circle cx="90" cy="90" r={r} fill="none" stroke="#eee" strokeWidth="26" />
      {total > 0 &&
        parts
          .filter((p) => p.value > 0)
          .map((p) => {
            const len = (p.value / total) * c
            const el = <circle key={p.label} cx="90" cy="90" r={r} fill="none" stroke={p.color} strokeWidth="26" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 90 90)" />
            acc += len
            return el
          })}
    </svg>
  )
}

/** Semicircle gauge 0–100 with an animated needle (Fear & Greed). */
export function Gauge({ value, label, sub, testId, size = 220 }: { value: number; label: string; sub?: string; testId?: string; size?: number }) {
  const v = Math.max(0, Math.min(100, value))
  const angle = -90 + (v / 100) * 180
  const arc = (from: number, to: number, color: string) => {
    const a0 = Math.PI * (1 - from / 100)
    const a1 = Math.PI * (1 - to / 100)
    const p = (a: number, r: number) => `${100 + r * Math.cos(a)},${100 - r * Math.sin(a)}`
    return <path d={`M${p(a0, 80)} A80,80 0 0 1 ${p(a1, 80)}`} stroke={color} strokeWidth="18" fill="none" />
  }
  return (
    <figure className="flex flex-col items-center" data-testid={testId} data-value={Math.round(v)}>
      <svg viewBox="0 0 200 118" width={size} role="img" aria-label={`${label}: ${Math.round(v)}`}>
        {arc(0, 25, '#c0392b')}
        {arc(25, 45, '#e67e22')}
        {arc(45, 55, '#d6d3d1')}
        {arc(55, 75, '#7cb342')}
        {arc(75, 100, '#1f8a4c')}
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '100px 100px', transition: 'transform 1.4s cubic-bezier(.2,.9,.3,1.2)' }} className="gauge-needle">
          <line x1="100" y1="100" x2="100" y2="30" stroke="#12201f" strokeWidth="4" strokeLinecap="round" />
        </g>
        <circle cx="100" cy="100" r="8" fill="#12201f" />
        <text x="100" y="92" textAnchor="middle" fontSize="0" />
      </svg>
      <figcaption className="-mt-2 text-center">
        <div className="text-3xl font-extrabold num">{Math.round(v)}</div>
        <div className="font-bold text-sea">{label}</div>
        {sub && <div className="text-xs text-stone-500">{sub}</div>}
      </figcaption>
    </figure>
  )
}

/** Radar chart for 0–100 scores, grows in on mount. Labels sit outside the web, anchored away from it, and the
 * drawing area widens to fit the longest label (German labels are long), so no label is ever cut off. */
export function Radar({ axes, testId }: { axes: { label: string; value: number }[]; testId?: string }) {
  const n = axes.length
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n
    return `${(110 + r * Math.cos(a)).toFixed(1)},${(110 + r * Math.sin(a)).toFixed(1)}`
  }
  const labels = axes.map((a, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n
    const c = Math.cos(ang)
    const x = 110 + 90 * c
    const y = 110 + 92 * Math.sin(ang)
    const anchor: 'start' | 'middle' | 'end' = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle'
    const w = a.label.length * 6 // generous width estimate at font size 10
    const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2
    return { label: a.label, x, y, anchor, left, right: left + w }
  })
  const minX = Math.floor(Math.min(0, ...labels.map((l) => l.left)) - 4)
  const maxX = Math.ceil(Math.max(220, ...labels.map((l) => l.right)) + 4)
  return (
    <svg viewBox={`${minX} 0 ${maxX - minX} 220`} className="h-auto w-full max-w-sm" data-testid={testId} role="img">
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={axes.map((_, i) => pt(i, 80 * k)).join(' ')} fill="none" stroke="#e7e5e4" />
      ))}
      {axes.map((_, i) => (
        <line key={i} x1="110" y1="110" x2={pt(i, 80).split(',')[0]} y2={pt(i, 80).split(',')[1]} stroke="#e7e5e4" />
      ))}
      <polygon points={axes.map((a, i) => pt(i, (80 * Math.max(0, Math.min(100, a.value))) / 100)).join(' ')} fill="#16595a" fillOpacity="0.35" stroke="#0f3d3e" strokeWidth="2" className="radar-grow" />
      {labels.map((l, i) => (
        <text key={i} x={l.x.toFixed(1)} y={l.y.toFixed(1)} fontSize="10" textAnchor={l.anchor} dominantBaseline="middle" fill="#44403c">
          {l.label}
        </text>
      ))}
    </svg>
  )
}

/** Animated money flow from one source into buckets (widths ∝ amounts). */
export function Flow({ source, parts, testId }: { source: string; parts: { label: string; value: number; color: string }[]; testId?: string }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0) || 1
  const H = 220
  let y = 20
  return (
    <svg viewBox={`0 0 600 ${H}`} className="h-auto w-full" data-testid={testId} role="img">
      <rect x="0" y="20" width="110" height={H - 40} rx="14" fill="#0f3d3e" />
      <text x="55" y={H / 2} fill="white" fontSize="14" fontWeight="700" textAnchor="middle">
        {source}
      </text>
      {parts.map((p, k) => {
        const h = Math.max(6, ((H - 40 - (parts.length - 1) * 10) * Math.max(0, p.value)) / total)
        const ty = y
        y += h + 10
        const sy = 20 + ((H - 40) * parts.slice(0, k).reduce((a, q) => a + Math.max(0, q.value), 0)) / total
        const sh = ((H - 40) * Math.max(0, p.value)) / total
        const d = `M110,${sy} C300,${sy} 300,${ty} 470,${ty} L470,${ty + h} C300,${ty + h} 300,${sy + sh} 110,${sy + sh} Z`
        return (
          <g key={p.label} className="flow-in" style={{ animationDelay: `${k * 0.35}s` }}>
            <path d={d} fill={p.color} fillOpacity="0.55" />
            <rect x="470" y={ty} width="130" height={h} rx="8" fill={p.color} />
            <text x="535" y={ty + h / 2} fill="white" fontSize="12" fontWeight="700" textAnchor="middle" dominantBaseline="middle">
              {p.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Number that counts up to its value (once, on mount / change). */
export function CountUp({ value, format, ms = 1200, testId }: { value: number; format: (v: number) => string; ms?: number; testId?: string }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return setV(value)
    let raf = 0
    const t0 = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      setV(value * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return (
    <span className="num" data-testid={testId} data-value={Math.round(value)}>
      {format(v)}
    </span>
  )
}
