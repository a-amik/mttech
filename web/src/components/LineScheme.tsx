import { useRef, useState } from 'react'
import { HelpMark } from '@gravity-ui/uikit'
import { forecastDay, planDay, sinceByMarks, sinceByPlan, waitingAt, type Ctx } from '../model'
import { tripsHour } from '../settings'
import { useMarks, type Mark } from './LiveView'
import { dowOf, isoOf } from '../data'
import { useStore } from '../store'
import { useWidth } from '../lib/media'
import type { Screen } from '../screen'

const HUB = /метро|мцк|мцд|вокзал|площадь|платформа/i
const BARS = 44
const Y = 22 + BARS

const norm = (s: string) => s.replace(/[«»"“”]/g, '').trim().toLowerCase()

/** Посадки по остановкам в час: прогноз маршрута × доля остановки; две стороны движения отдельно. */
function stopBoardings(ctx: Ctx, route: string, day: number, hour: number) {
  const st = ctx.ds.stops?.routes[route]
  if (!st) return null
  const type = ctx.ds.stops!.days[isoOf(day)] ?? (dowOf(day) >= 5 ? 'weekend' : 'weekday')
  const total = forecastDay(ctx, route, day)[hour] ?? 0
  const [names0, names1] = st.names
  const [sh0, sh1] = st.shares[type][hour]
  // остановка обратной стороны — та же точка по имени, иначе зеркальная по порядку
  const at = new Map(names0.map((n, i) => [norm(n), i]))
  const there = new Array(names0.length).fill(0)
  const back = new Array(names0.length).fill(0)
  sh0.forEach((s, i) => { there[i] += s * total })
  sh1.forEach((s, k) => {
    const i = at.get(norm(names1[k])) ?? names0.length - 1 - k
    if (i >= 0 && i < back.length) back[i] += s * total
  })
  return { names: names0, there, back, total, confidence: st.confidence, to: names0[names0.length - 1], from: names0[0] }
}

/** Сколько ждут на остановках в этот час: поток остановки × минуты с прошлого вагона. Оценка. */
function stopWaits(ctx: Ctx, route: string, day: number, hour: number, b: NonNullable<ReturnType<typeof stopBoardings>>, marks: Mark[] | null) {
  const t = tripsHour(ctx.s, route, hour, planDay(ctx, route, day).trips)
  const interval = t ? 60 / t : 0
  const coords = new Map(ctx.ds.routes.find((x) => x.id === route)!.stops.map((s) => [norm(s.name), s]))
  const mine = (marks ?? []).filter((m) => m.route === route && !m.stale)
  return b.names.map((nm, i) => {
    const at = coords.get(norm(nm))
    const byMarks = at && mine.length ? sinceByMarks(at, mine) : null
    const since = byMarks ?? sinceByPlan(t)
    const flow = b.there[i] + b.back[i]
    return { name: nm, flow, since, glonass: byMarks !== null, wait: waitingAt(flow, since), crowd: byMarks !== null && interval > 0 && byMarks > Number(ctx.s.wait_gap_x) * interval, interval }
  })
}

/** Линия выбранного маршрута — под сеткой и таблицей. */
export default function LineBlock({ ctx }: { ctx: Ctx; sc: Screen }) {
  const { route, day, hour } = useStore()
  const b = stopBoardings(ctx, route, day, hour)
  const hh = String(hour).padStart(2, '0')
  const marks = useMarks()
  const [sel, setSel] = useState<number | null>(null)
  const waits = b ? stopWaits(ctx, route, day, hour, b, marks?.items ?? null) : null
  const top = waits ? waits.reduce((m, w, i) => (w.wait > waits[m].wait ? i : m), 0) : 0
  const card = waits ? waits[sel !== null && sel < waits.length ? sel : top] : null
  return (
    <section className="b-line">
      <div className="b-bar">
        <h2>Линия маршрута {route}</h2>
        <span className="b-legend">
          {b ? (
            <>
              <span className="est">оценка<HelpMark iconSize="s" className="b-help">Посадки по остановкам в {hh}:00 — оценка: точность ±1—2 остановки, направление рейсов {b.confidence}.</HelpMark></span>
              <span><i className="there" />в сторону {b.to}</span>
              <span><i className="back" />в сторону {b.from}</span>
            </>
          ) : (
            <span className="est">без оценки по остановкам<HelpMark iconSize="s" className="b-help">Направление рейсов по валидациям не определилось или истории нет.</HelpMark></span>
          )}
          <span title="Пересадка на метро, МЦК, МЦД, вокзал"><i className="hub" />пересадка</span>
        </span>
      </div>
      <LineScheme ctx={ctx} sel={sel} onSel={setSel} waits={waits} />
      {card ? (
        <div className="b-stopcard">
          <b>{card.name}</b>
          <span>ждут ≈ {Math.round(card.wait)}</span>
          <span>с прошлого вагона {Math.round(card.since)} мин</span>
          {card.crowd ? <span className="crowd">копятся</span> : null}
          <HelpMark iconSize="s" className="b-help">
            Оценка: посадки остановки в {hh}:00 ({Math.round(card.flow)} в час) × минуты с прохода прошлого вагона ÷ 60.
            {card.glonass ? ' Минуты — по отметкам ГЛОНАСС.' : ` ГЛОНАСС нет: минуты — половина интервала по расписанию, ${Math.round(card.interval)} мин.`}
            {sel === null ? ' Показана остановка, где ждут больше всего; нажмите на другую на схеме.' : ''}
          </HelpMark>
        </div>
      ) : null}
    </section>
  )
}

/** Остановки маршрута по порядку: концы и пересадки подписаны, над остановкой — посадки часа, если оценены. */
export function LineScheme({ ctx, sel = null, onSel, waits = null }: { ctx: Ctx; sel?: number | null; onSel?: (i: number) => void; waits?: ReturnType<typeof stopWaits> | null }) {
  const { route, day, hour } = useStore()
  const box = useRef<HTMLDivElement>(null)
  const W = Math.max(320, useWidth(box))
  const r = ctx.ds.routes.find((x) => x.id === route)!
  const b = stopBoardings(ctx, route, day, hour)
  // с долями — остановки из расписания: к ним привязаны посадки; без них — справочник
  const names = b ? b.names : r.stops.map((s) => s.name)
  const n = names.length
  const x0 = 24
  const dx = n > 1 ? (W - 2 * x0) / (n - 1) : 0
  const x = (i: number) => x0 + dx * i
  const hub = names.map((nm) => HUB.test(nm))
  const peak = b ? Math.max(1, ...b.there.map((v, i) => v + b.back[i])) : 1
  const bw = Math.max(3, Math.min(12, dx * 0.6))
  const h = (v: number) => (v / peak) * (BARS - 6)

  // Подписи: концы, затем пересадки; лишние, что налезают, не ставятся.
  const want = names.map((_, i) => ({ i, rank: i === 0 || i === n - 1 ? 0 : hub[i] ? 2 : 9 }))
    .filter((c) => c.rank < 9).sort((a, b) => a.rank - b.rank || a.i - b.i)
  // Ширина подписи по числу знаков: кегль 10,5, средний знак около 6 px.
  const extent = (i: number, text: string): [number, number] => {
    const len = Math.min(text.length, 26) * 6
    return i === 0 ? [x(i) - 6, x(i) - 6 + len] : i === n - 1 ? [x(i) + 6 - len, x(i) + 6] : [x(i) - len / 2, x(i) + len / 2]
  }
  const rows: { i: number; row: number; text: string; e: [number, number] }[] = []
  for (const c of want) {
    const text = names[c.i].replace(/^(Метро|Станция метро|м\.)\s*/i, 'м. ')
    const e = extent(c.i, text)
    for (const row of [0, 1]) {
      if (!rows.some((p) => p.row === row && p.e[0] < e[1] + 10 && e[0] < p.e[1] + 10)) { rows.push({ i: c.i, row, text, e }); break }
    }
  }
  const H = Y + 54

  return (
    <div ref={box}>
        {n ? (
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Схема линии маршрута ${route}: ${n} остановок`}>
            {b && names.map((nm, i) => (
              <g key={`b${i}`}>
                <rect className="there" x={x(i) - bw / 2} y={Y - 8 - h(b.there[i])} width={bw} height={h(b.there[i])} />
                <rect className="back" x={x(i) - bw / 2} y={Y - 8 - h(b.there[i]) - h(b.back[i])} width={bw} height={h(b.back[i])} />
                <title>{`${nm}: ${Math.round(b.there[i])} в сторону ${b.to}, ${Math.round(b.back[i])} в сторону ${b.from} — оценка`}</title>
              </g>
            ))}
            <line className="rail" x1={x(0)} y1={Y} x2={x(n - 1)} y2={Y} />
            {names.map((nm, i) => (
              <g key={i} className={`stop${onSel ? ' pick' : ''}`} onClick={onSel ? () => onSel(i) : undefined}>
                {onSel ? <circle cx={x(i)} cy={Y} r={Math.max(8, dx / 2)} className="hit" /> : null}
                {waits?.[i]?.crowd ? <circle cx={x(i)} cy={Y} r={9} className="crowd" /> : null}
                <circle cx={x(i)} cy={Y} r={hub[i] || i === 0 || i === n - 1 ? 6 : dx < 14 ? 3.5 : 4.5} className={`${hub[i] ? 'hub' : ''}${sel === i ? ' sel' : ''}`} />
                <title>{waits?.[i] ? `${nm}: ждут ≈ ${Math.round(waits[i].wait)}, с прошлого вагона ${Math.round(waits[i].since)} мин — оценка` : nm}</title>
              </g>
            ))}
            {rows.map((p) => (
              <text key={p.i} x={x(p.i)} y={Y + 24 + p.row * 16} textAnchor={p.i === 0 ? 'start' : p.i === n - 1 ? 'end' : 'middle'}
                dx={p.i === 0 ? -6 : p.i === n - 1 ? 6 : 0}>{p.text.length > 26 ? `${p.text.slice(0, 25)}…` : p.text}</text>
            ))}
          </svg>
        ) : (
          <p className="b-empty">Остановок маршрута {route} нет в справочнике организаторов: посадки даны по маршруту целиком.</p>
        )}
    </div>
  )
}
