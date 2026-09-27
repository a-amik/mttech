import { useState } from 'react'
import { num } from '../../data'
import { usePhone } from '../../lib/media'

// Графики «Отчётов»: тонкие линии, подписи набором, цвет — только у метки ряда. Каждый график
// отвечает на наведение: у линий — перекрестие и подсказка, у полос и точек — подсказка у метки.

export interface Series { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean; dots?: boolean }

export function Figure({ n, title, legend, children, note }: { n: number; title: React.ReactNode; legend?: { label: string; color: string; dashed?: boolean }[]; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <figure className="b-an-fig">
      <div className="h"><b>Рис. {n}.</b> {title}</div>
      {legend ? (
        <div className="lg">
          {legend.map((l) => <span key={l.label}><i className={l.dashed ? 'd' : undefined} style={{ background: l.color, borderColor: l.color }} />{l.label}</span>)}
        </div>
      ) : null}
      {children}
      {note ? <figcaption>{note}</figcaption> : null}
    </figure>
  )
}

/** Линии по общей оси X с подсказкой по наведению. Значения вне [lo, hi] прижаты к краю. */
export function LineChart({ x, series, lo, hi, fmt = (v) => num(v, 3), height = 240, ticks, bands, marks = true, width = 720 }: {
  x: string[]; series: Series[]; lo: number; hi: number; fmt?: (v: number) => string; height?: number; ticks?: number[]; width?: number
  bands?: { from: number; to: number; label: string }[]; marks?: boolean
}) {
  const [at, setAt] = useState<number | null>(null)
  // на телефоне сетка уже: подписи остаются читаемыми и не сжимаются вместе с картинкой
  const phone = usePhone()
  const W = phone ? Math.min(width, 380) : width
  const H = phone ? Math.round(height * 0.9) : height
  const R = 16
  const T = 12
  const B = 28
  const px = (i: number) => L + ((W - L - R) * (x.length === 1 ? 0.5 : i / (x.length - 1)))
  const py = (v: number) => H - B - ((H - T - B) * (Math.max(lo, Math.min(hi, v)) - lo)) / (hi - lo || 1)
  const tk = ticks ?? [lo, (lo + hi) / 2, hi]
  // поле слева — по самой длинной подписи оси, чтобы «831 тыс.» не обрезалось
  const L = Math.max(W < 500 ? 36 : 44, Math.max(...tk.map((v) => fmt(v).length)) * 6.6 + 12)
  const step = Math.max(1, Math.ceil(x.length / (W < 500 ? 5 : 12)))
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - r.left) / r.width) * W
    let best = 0
    x.forEach((_, i) => { if (Math.abs(px(i) - vx) < Math.abs(px(best) - vx)) best = i })
    setAt(best)
  }
  return (
    <div className="b-an-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" onMouseMove={onMove} onMouseLeave={() => setAt(null)}>
        {bands?.map((b) => (
          <g key={b.label} className="band">
            <rect x={px(b.from) - 4} y={T} width={Math.max(8, px(b.to) - px(b.from) + 8)} height={H - T - B} />
            <text x={px(b.from)} y={T + 11}>{b.label}</text>
          </g>
        ))}
        {tk.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={py(v)} y2={py(v)} className="grid" />
            <text x={L - 8} y={py(v) + 4} textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {x.map((lab, i) => (i % step === 0 || i === x.length - 1 ? <text key={i} x={px(i)} y={H - 8} textAnchor={x.length > 1 && i === 0 ? 'start' : x.length > 1 && i === x.length - 1 ? 'end' : 'middle'}>{lab}</text> : null))}
        {series.map((s) => {
          let d = ''
          s.values.forEach((v, i) => { if (v === null) return; d += `${d && s.values[i - 1] !== null ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}` })
          return (
            <g key={s.key}>
              {s.dots ? null : <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />}
              {marks ? s.values.map((v, i) => (v === null ? null : <circle key={i} cx={px(i)} cy={py(v)} r={at === i ? 5 : 3.5} fill={s.color} className="mk" />)) : null}
            </g>
          )
        })}
        {at !== null ? <line x1={px(at)} x2={px(at)} y1={T} y2={H - B} className="cross" /> : null}
      </svg>
      {at !== null ? (
        <div className="tip" style={{ left: `${(px(at) / W) * 100}%` }}>
          <b>{x[at]}</b>
          {series.filter((s) => s.values[at] !== null).map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}<em>{fmt(s.values[at]!)}</em></span>)}
        </div>
      ) : null}
    </div>
  )
}

/** Горизонтальные полосы от общей нулевой линии; подпись значения у конца полосы. */
export function Bars({ rows, max, fmt, lo = 0 }: { rows: { label: string; value: number; color: string; note?: string; strong?: boolean }[]; max: number; fmt: (v: number) => string; lo?: number }) {
  return (
    <div className="b-an-bars">
      {rows.map((r) => (
        <div key={r.label} className={`r${r.strong ? ' on' : ''}`} title={r.note ? `${r.label}: ${fmt(r.value)} · ${r.note}` : `${r.label}: ${fmt(r.value)}`}>
          <span className="l">{r.label}</span>
          <span className="t"><i style={{ width: `${Math.max(1, ((r.value - lo) / (max - lo)) * 100)}%`, background: r.color }} /></span>
          <span className="v">{fmt(r.value)}</span>
          {r.note ? <span className="n">{r.note}</span> : null}
        </div>
      ))}
    </div>
  )
}

/** Разница со знаком: вправо — лучше, влево — хуже; ноль посередине. */
export function Diverging({ rows, span, fmt }: { rows: { label: string; groups: { label: string; value: number }[] }[]; span: number; fmt: (v: number) => string }) {
  return (
    <div className="b-an-div">
      {rows.map((r) => (
        <div key={r.label} className="g">
          <span className="l">{r.label}</span>
          <div className="rs">
            {r.groups.map((g) => {
              const w = Math.min(50, (Math.abs(g.value) / span) * 50)
              return (
                <div key={g.label} className="r" title={`${r.label}, ${g.label}: ${fmt(g.value)}`}>
                  <span className="k">{g.label}</span>
                  <span className="t">
                    <i className={g.value >= 0 ? 'up' : 'dn'} style={g.value >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} />
                    <b className="z" />
                  </span>
                  <span className={`v ${g.value >= 0 ? 'up' : 'dn'}`}>{fmt(g.value)}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Тепловая таблица: чем выше счёт, тем гуще синий; лучшее в строке — полужирным. */
export function HeatTable({ rows, cols, cell, fmt, lo, hi, head }: {
  rows: { key: string; label: string; note?: string }[]; cols: { key: string; label: string; color: string }[]
  cell: (row: string, col: string) => number | null; fmt: (v: number) => string; lo: number; hi: number; head: string
}) {
  // цвет — насколько ячейка близка к лучшей в своей строке: так видно, кто держится рядом с лидером
  const step = (v: number, best: number) => {
    const d = best - v
    return d <= 0.0005 ? 4 : d <= 0.003 ? 3 : d <= 0.01 ? 2 : d <= (hi - lo) / 4 ? 1 : 0
  }
  return (
    <div className="b-an-heat">
      <table>
        <thead><tr><th>{head}</th>{cols.map((c) => <th key={c.key}><i style={{ background: c.color }} />{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const vals = cols.map((c) => cell(r.key, c.key))
            const best = Math.max(...vals.filter((v): v is number => v !== null))
            return (
              <tr key={r.key}>
                <td>{r.label}{r.note ? <small>{r.note}</small> : null}</td>
                {vals.map((v, i) => v === null
                  ? <td key={i} className="none">—</td>
                  : <td key={i} className={`s${step(v, best)}${v === best ? ' best' : ''}`} title={`${r.label}, ${cols[i].label}: ${fmt(v)}`}>{fmt(v)}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Плитки чисел: число, подпись, источник. */
export function Tiles({ items }: { items: { value: string; label: string; note?: string }[] }) {
  return (
    <div className={`b-an-tiles n${items.length}`}>
      {items.map((t) => (
        <div key={t.label}>
          <b>{t.value}</b>
          <span>{t.label}</span>
          {t.note ? <small>{t.note}</small> : null}
        </div>
      ))}
    </div>
  )
}
