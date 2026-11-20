import { useEffect, useState } from 'react'

/** Lightweight SVG charts (no library): a line chart with optional extra lines/bands, and a donut. */
export interface Line {
  values: (number | null)[]
  color: string
  width?: number
  dash?: string
  label?: string
}

export function LineChart({ x, lines, band, height = 220, testId, format = (v: number) => v.toFixed(0) }: { x: string[]; lines: Line[]; band?: { lo: number[]; hi: number[]; color: string }; height?: number; testId?: string; format?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = height
  const P = { l: 8, r: 8, t: 10, b: 22 }
  const all = [...lines.flatMap((l) => l.values), ...(band ? [...band.lo, ...band.hi] : [])].filter((v): v is number => v !== null && Number.isFinite(v))
  if (!all.length || x.length < 2) return <div className="flex h-40 items-center justify-center text-stone-400">–</div>
  let min = Math.min(...all)
  let max = Math.max(...all)
  if (min === max) {
    min -= 1
    max += 1
  }
  const pad = (max - min) * 0.06
  min -= pad
  max += pad
  const sx = (i: number) => P.l + (i / (x.length - 1)) * (W - P.l - P.r)
  const sy = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b)
  const path = (vals: (number | null)[]) => {
    let d = ''
    let pen = false
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) return void (pen = false)
      d += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`
      pen = true
    })
    return d
  }
  const ticks = [0, Math.floor((x.length - 1) / 2), x.length - 1]
  return (
    <div className="relative" data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" onMouseLeave={() => setHover(null)} onMouseMove={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
        const i = Math.round(((e.clientX - r.left) / r.width) * (x.length - 1))
        setHover(Math.max(0, Math.min(x.length - 1, i)))
      }} role="img">
        {band && <path d={`${path(band.hi)}${band.lo.map((_v, i) => `L${sx(band.lo.length - 1 - i).toFixed(1)},${sy(band.lo[band.lo.length - 1 - i]).toFixed(1)}`).join('')}Z`} fill={band.color} opacity={0.25} />}
        {lines.map((l, k) => (
          <path key={k} d={path(l.values)} fill="none" stroke={l.color} strokeWidth={l.width ?? 2} strokeDasharray={l.dash} />
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

/** Radar chart for 0–100 scores, grows in on mount. */
export function Radar({ axes, testId }: { axes: { label: string; value: number }[]; testId?: string }) {
  const n = axes.length
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n
    return `${(110 + r * Math.cos(a)).toFixed(1)},${(110 + r * Math.sin(a)).toFixed(1)}`
  }
  return (
    <svg viewBox="0 0 220 220" className="h-auto w-full max-w-xs" data-testid={testId} role="img">
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={axes.map((_, i) => pt(i, 80 * k)).join(' ')} fill="none" stroke="#e7e5e4" />
      ))}
      {axes.map((_, i) => (
        <line key={i} x1="110" y1="110" x2={pt(i, 80).split(',')[0]} y2={pt(i, 80).split(',')[1]} stroke="#e7e5e4" />
      ))}
      <polygon points={axes.map((a, i) => pt(i, (80 * Math.max(0, Math.min(100, a.value))) / 100)).join(' ')} fill="#16595a" fillOpacity="0.35" stroke="#0f3d3e" strokeWidth="2" className="radar-grow" />
      {axes.map((a, i) => {
        const [x, y] = pt(i, 100).split(',').map(Number)
        return (
          <text key={a.label} x={x} y={y} fontSize="10" textAnchor="middle" dominantBaseline="middle" fill="#44403c">
            {a.label}
          </text>
        )
      })}
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
