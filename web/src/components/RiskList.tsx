import { useState } from 'react'
import { useStore, decisionKey } from '../store'
import { hh, num } from '../data'
import type { Ctx, RiskWindow } from '../model'
import { onRoutes, pickWindow, span, trips, wins as winsWord } from '../actions'
import type { Screen } from '../screen'
import { Pri, RNum } from './Bits'
import { IconChevron } from '../lib/icons'
import WindowCard from './WindowCard'

/** Окна одной причины сворачиваются в строку, если их столько или больше: дождь не устраивает лавину. */
const GROUP_MIN = 3

type Item = { kind: 'win'; w: RiskWindow } | { kind: 'group'; key: string; label: string; items: RiskWindow[] }

/** Окна риска в боковой панели: под выбранным окном раскрывается его карточка. */
export default function RiskList({ ctx, sc, query = '', inline = true, onOpen, pastOpen = false }: { ctx: Ctx; sc: Screen; query?: string; inline?: boolean; onOpen?: () => void; pastOpen?: boolean }) {
  const { route, hour, day } = useStore()
  const { now, snoozed, openGroups, cardShut, cardIn, place, set } = useStore()
  const q = query.trim()
  const [showPast, setShowPast] = useState(pastOpen)
  const inPlace = (id: string) => !place || ctx.ds.depots?.[id]?.[0]?.[0] === place
  const ahead = sc.wins.filter((w) => w.to > now && inPlace(w.route) && (!q || w.route.startsWith(q)))
  const past = sc.wins.filter((w) => w.to <= now)
  const later = ahead.filter((w) => snoozed[decisionKey(day, w.key)])
  const live = ahead.filter((w) => !snoozed[decisionKey(day, w.key)])

  // Первый приоритет всегда своей строкой; прочие одной причины — в свёртку.
  const byCause = new Map<string, RiskWindow[]>()
  for (const w of live) if (w.prio > 1) byCause.set(w.cause.key, [...(byCause.get(w.cause.key) ?? []), w])
  const items: Item[] = []
  const placed = new Set<string>()
  for (const w of live) {
    const same = byCause.get(w.cause.key) ?? []
    if (w.prio > 1 && same.length >= GROUP_MIN) {
      if (!placed.has(w.cause.key)) items.push({ kind: 'group', key: w.cause.key, label: w.cause.label, items: same })
      placed.add(w.cause.key)
    } else items.push({ kind: 'win', w })
  }

  const row = (w: RiskWindow, sub = false) => {
    const dec = sc.decided(w)
    const sel = w.route === route && hour >= w.from && hour < w.to
    const after = dec ? Math.max(...sc.after[w.route].slice(w.from, w.to)) : 0
    const why = w.causes.filter((c) => c.key !== 'day').slice(0, 2).map((c) => c.label.toLowerCase()).join(', ') || 'дневной спрос'
    const open = inline && sel && !cardShut && cardIn !== 'routes'
    return (
      <div key={w.key} className={open ? 'b-open' : undefined}>
      <button type="button" className={`b-risk${sel ? ' sel' : ''}${sub ? ' sub' : ''}${dec ? ' done' : ''}`}
        onClick={() => (!inline ? (pickWindow(w), onOpen?.()) : sel ? set({ cardShut: !cardShut, cardIn: 'wins' }) : pickWindow(w))} aria-current={sel || undefined} aria-expanded={inline ? open : undefined}>
        <Pri p={w.prio} />
        <RNum id={w.route} />
        <span className="w">{span(w)}</span>
        <span className={`v${w.prio < 3 ? ' over' : ''}`}>{num(w.peak)} %</span>
        <span className="why">
          {why}
          {dec ? <> · <b className="ack">принято +{trips(dec.trips)}/ч → {num(after)} %</b></> : null}
        </span>
      </button>
      {open ? <WindowCard ctx={ctx} sc={sc} /> : null}
      </div>
    )
  }

  const group = (g: Extract<Item, { kind: 'group' }>) => {
    // Выбранное окно внутри свёртки раскрывает её: выбор виден во всех панелях.
    const inside = g.items.some((w) => w.route === route && hour >= w.from && hour < w.to)
    const open = openGroups[g.key] ?? inside
    const routes = new Set(g.items.map((w) => w.route)).size
    const top = Math.min(...g.items.map((w) => w.prio)) as RiskWindow['prio']
    return (
      <div key={`g-${g.key}`}>
        <button type="button" className={`b-group${open ? ' open' : ''}`} aria-expanded={open}
          onClick={() => set({ openGroups: { ...openGroups, [g.key]: !open } })}>
          <Pri p={top} />
          <span>
            <span className="t">{g.label}</span>
            <span className="n">{winsWord(g.items.length)} на {onRoutes(routes)} · одна причина</span>
          </span>
          <IconChevron className="arr" />
        </button>
        {open ? g.items.map((w) => row(w, true)) : null}
      </div>
    )
  }

  return (
    <div>
      {items.length ? items.map((it) => (it.kind === 'win' ? row(it.w) : group(it))) : (
        <p className="b-empty">
          {q ? `Окон риска у маршрута ${q} впереди нет.` : <>Окон риска впереди нет. Порог перегрузки {String(ctx.s.threshold_pct)} %, внимание от {String(ctx.s.warn_pct)} %,
          отсчёт с {hh(now)}.</>}
        </p>
      )}
      {later.length ? (
        <>
          <div className="b-cap small">Отложено · {later.length}</div>
          {later.map((w) => row(w))}
        </>
      ) : null}
      {past.length ? (
        <>
          <button type="button" className="b-cap small b-cap-btn" aria-expanded={showPast} onClick={() => setShowPast(!showPast)}>
            Прошло до {hh(now)} · {winsWord(past.length)}<IconChevron className="arr" />
          </button>
          {showPast ? <div className="b-past">{past.map((w) => row(w))}</div> : null}
        </>
      ) : null}
    </div>
  )
}
