import { useState } from 'react'

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
