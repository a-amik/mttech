import { useEffect, useRef, useState } from 'react'
import { Checkbox, Switch, TextInput } from '@gravity-ui/uikit'
import { hh, num, thousands } from '../data'
import { fleetDay, type Ctx } from '../model'
import { useStore } from '../store'
import { pick } from '../actions'
import { recastOf, type Screen } from '../screen'
import { IconChevron } from '../lib/icons'
import { stepOf } from '../lib/scale'
import { Key, RNum } from './Bits'
import RiskList from './RiskList'
import WindowCard from './WindowCard'

/** Три числа над панелью — крупно доля, рядом дробь, как у Optibus. */
export function Kpis({ ctx, sc }: { ctx: Ctx; sc: Screen }) {
  const now = useStore((s) => s.now)
  const thr = Number(ctx.s.threshold_pct)
  let ok = 0
  let all = 0
  for (const [id, d] of Object.entries(sc.days)) {
    for (let h = now; h < 24; h++) {
      if (!d.fc[h]) continue
      all++
      if (sc.after[id][h] < thr) ok++
    }
  }
  const ahead = sc.wins.filter((w) => w.to > now && w.prio <= 2)
  const decided = ahead.filter((w) => sc.decided(w)).length
  const total = Object.values(sc.days).reduce((a, d) => a + d.total, 0)
  return (
    <>
      <div className="b-kpis">
        <div title="Часы «маршрут × час» с этого часа до конца суток, где загрузка ниже порога с учётом принятых решений">
          <span>Ниже порога</span><b>{all ? num((ok / all) * 100) : 100}&nbsp;%</b><small>{ok}/{all}</small>
        </div>
        <div title="Окна первого и второго приоритета впереди: сколько из них уже с решением">
          <span>Решения</span><b className={decided < ahead.length ? 'warn' : ''}>{decided}</b><small>из {ahead.length}</small>
        </div>
        <div title="Посадки за сутки по десяти маршрутам">
          <span>Посадки</span><b>{thousands(total)}</b><small>за сутки</small>
        </div>
      </div>
      <RecastRow ctx={ctx} sc={sc} now={now} />
    </>
  )
}

/** Строка под тремя числами: пересчёт остатка дня по факту прошедших часов, в дни с фактом. */
function RecastRow({ ctx, sc, now }: { ctx: Ctx; sc: Screen; now: number }) {
  const setSettings = useStore((s) => s.setSettings)
  if (!Object.values(sc.days).some((d) => d.fact)) return null
  const on = Boolean(ctx.s.nowcast)
  const rc = recastOf(sc, now)
  const title = 'Отношение факта к прогнозу за часы до часа смены переносится на оставшиеся часы дня. Октябрь 2025: факт до 9:00 даёт +0,4 пп точности остатка дня, до 11:00 — +0,8 пп.'
  return (
    <div className="b-recast" title={title}>
      <Switch size="s" checked={on} onUpdate={(v) => setSettings({ ...ctx.s, nowcast: v })} aria-label="Пересчёт по факту" />
      {!on ? <span>Пересчёт по факту выключен</span>
        : !rc ? <span>По факту до {hh(now)}: часов мало</span>
        : <span>По факту до {hh(now)} <b>×{num(rc.k, 2)}</b> · остаток дня <b>{num(rc.score, 2)}</b>, без пересчёта {num(rc.plain, 2)}</span>}
    </div>
  )
}

/** Секция панели: заголовок сворачивает, поиск свой. */
function Fold({ id, title, count, children, keys }: { id: string; title: string; count?: number; keys?: React.ReactNode; children: (q: string) => React.ReactNode }) {
  const { folded, set } = useStore()
  const [q, setQ] = useState('')
  const shut = folded[id]
  return (
    <section className={`b-fold${shut ? ' shut' : ''}`}>
      <header>
        <button type="button" aria-expanded={!shut} onClick={() => set({ folded: { ...folded, [id]: !shut } })}>
          <IconChevron className="arr" /><b>{title}</b>{count !== undefined ? <span className="n">{count}</span> : null}
        </button>
        {keys}
      </header>
      {shut ? null : (
        <>
          <div className="b-fold-q"><TextInput size="s" value={q} onUpdate={setQ} placeholder="Номер маршрута" hasClear /></div>
          {children(q)}
        </>
      )}
    </section>
  )
}

function RouteList({ ctx, sc, query }: { ctx: Ctx; sc: Screen; query: string }) {
  const { route, hour, cardShut, cardIn, mapHidden, place, set } = useStore()
  const thr = Number(ctx.s.threshold_pct)
  const q = query.trim().toLowerCase()
  const list = ctx.ds.routes.filter((r) =>
    (!place || ctx.ds.depots?.[r.id]?.[0]?.[0] === place) && (!q || r.id.startsWith(q) || r.name.toLowerCase().includes(q)))
  // Карточка раскрывается под маршрутом, если выбор не попал в окно риска из списка выше.
  const inWin = Boolean(sc.winAt(route, hour)) && cardIn !== 'routes'
  // Флажок отмечен — маршрут на карте. Общий флажок: все на карте или ни одного.
  const toggleMap = (id: string, on: boolean) => set({ mapHidden: on ? mapHidden.filter((x) => x !== id) : [...mapHidden, id] })
  const ids = ctx.ds.routes.map((r) => r.id)
  const allOn = mapHidden.length === 0
  const someOn = mapHidden.length < ids.length

  return (
    <div>
      <label className="b-route-all">
        <Checkbox size="m" checked={allOn} indeterminate={!allOn && someOn} onUpdate={() => set({ mapHidden: allOn ? ids : [] })} />
        <span>Все маршруты на&nbsp;карте</span>
        <small>{ids.length - mapHidden.length} из&nbsp;{ids.length}</small>
      </label>
      {list.map((r) => {
        const d = sc.days[r.id]
        const sel = r.id === route
        const open = sel && !cardShut && !inWin
        const peak = d.total ? d.load[d.peakHour] : 0
        const fleet = fleetDay(ctx, r.id, sc.day)
        return (
          <div key={r.id} className={open ? 'b-open' : undefined}>
            <div className={`b-route${sel ? ' sel' : ''}`}>
              <Checkbox size="m" checked={!mapHidden.includes(r.id)} onUpdate={(on) => toggleMap(r.id, on)} title="Маршрут на карте" />
              <button type="button" aria-expanded={open}
                onClick={() => (sel ? set({ cardShut: !cardShut, cardIn: 'routes' }) : pick(r.id, d.total ? d.peakHour : hour, 'routes'))}>
                <RNum id={r.id} off={!d.total} />
                <span className="nm">{fleet?.low ? <em className="fl" title="Вагонов на линии против обычного при таком расписании">выпуск {num(fleet.pct)} %</em> : null}{r.name}</span>
                <span className="t">{d.total ? thousands(d.total) : '—'}</span>
                <span className={`v${peak >= thr ? ' over' : ''}`} style={{ ['--lv' as string]: `var(--b-l${stepOf(peak)})` }}>{d.total ? `${num(peak)} %` : ''}</span>
              </button>
            </div>
            {open ? <WindowCard ctx={ctx} sc={sc} /> : null}
          </div>
        )
      })}
    </div>
  )
}

/** Левая панель дня: числа, окна риска и маршруты. Выбор раскрывает карточку прямо под строкой. */
export default function SidePanel({ ctx, sc }: { ctx: Ctx; sc: Screen }) {
  const { route, hour, cardShut, now } = useStore()
  const box = useRef<HTMLElement>(null)
  const ahead = sc.wins.filter((w) => w.to > now).length

  // Выбор с сетки или карты прокручивает панель к раскрытой карточке; исходный выбор при открытии — нет.
  const initial = useRef(`${route}:${hour}`)
  useEffect(() => {
    if (initial.current === `${route}:${hour}`) return
    initial.current = ''
    box.current?.querySelector('.b-open')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [route, hour, cardShut])

  return (
    <aside className="b-side" ref={box} aria-label="Окна риска и маршруты">
      <Kpis ctx={ctx} sc={sc} />
      <Fold id="wins" title={ctx.s.f_fare ? "Окна риска · с безбилетниками" : "Окна риска"} count={ahead} keys={<span className="b-keys"><Key k="j" /><Key k="k" /></span>}>
        {(q) => <RiskList ctx={ctx} sc={sc} query={q} />}
      </Fold>
      <Fold id="routes" title="Маршруты" count={ctx.ds.routes.length}>
        {(q) => <RouteList ctx={ctx} sc={sc} query={q} />}
      </Fold>
    </aside>
  )
}
