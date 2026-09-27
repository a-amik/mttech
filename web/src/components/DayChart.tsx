import { hh, num } from '../data'

interface Props {
  fc: number[]
  band: number[][]
  fact: number[] | null
  threshold: number[]
  hour: number
  alt?: { values: number[]; color: string; label: string }[]
}

const W = 348
const H = 150
const PAD = { l: 34, r: 6, t: 8, b: 18 }

export default function DayChart({ fc, band, fact, threshold, hour, alt = [] }: Props) {
  const max = Math.max(1, ...band.map((b) => b[1]), ...(fact ?? []), ...alt.flatMap((a) => a.values)) * 1.08
  const x = (h: number) => PAD.l + ((W - PAD.l - PAD.r) * (h + 0.5)) / 24
  const y = (v: number) => H - PAD.b - ((H - PAD.t - PAD.b) * v) / max
  const line = (vals: number[]) => vals.map((v, h) => `${h ? 'L' : 'M'}${x(h).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const area =
    band.map((b, h) => `${h ? 'L' : 'M'}${x(h).toFixed(1)},${y(b[1]).toFixed(1)}`).join('') +
    band.slice().reverse().map((b, i) => `L${x(23 - i).toFixed(1)},${y(b[0]).toFixed(1)}`).join('') + 'Z'
  const ticks = [0, max / 2, max].map((v) => Math.round(v / 100) * 100)
  const thr = threshold.map((v) => Math.min(v, max))

  return (
    <svg className="b-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Посадки по часам: прогноз, интервал и факт">
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
          <text x={PAD.l - 4} y={y(t) + 3} textAnchor="end">{num(t)}</text>
        </g>
      ))}
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={h} x={x(h)} y={H - 4} textAnchor="middle">{hh(h).slice(0, 2)}</text>
      ))}
      <path className="band" d={area} />
      <path className="thr" fill="none" d={thr.map((v, h) => (v ? `${h && thr[h - 1] ? 'L' : 'M'}${x(h).toFixed(1)},${y(v).toFixed(1)}` : '')).join('')} />
      {alt.map((a) => (
        <path key={a.label} d={line(a.values)} fill="none" stroke={a.color} strokeWidth="1.5" />
      ))}
      <path className="fc" d={line(fc)} />
      {fact?.map((v, h) => <circle key={h} className="fact" cx={x(h)} cy={y(v)} r="2.2" />)}
      <line className="now" x1={x(hour)} x2={x(hour)} y1={PAD.t} y2={H - PAD.b} />
    </svg>
  )
}
