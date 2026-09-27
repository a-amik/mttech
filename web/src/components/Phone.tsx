import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Select } from '@gravity-ui/uikit'
import { hh, num, thousands } from '../data'
import { fleetDay, type Ctx } from '../model'
import { useStore } from '../store'
import { pick, setHorizon, setView } from '../actions'
import type { Screen } from '../screen'
import { stepOf } from '../lib/scale'
import { IconCalendar, IconGrid, IconMap, IconPlay, IconTable } from '../lib/icons'
import { RNum } from './Bits'
import { Kpis } from './SidePanel'
import RiskList from './RiskList'
import WindowCard from './WindowCard'

// Телефон — для дежурного в дороге: что горит, карточка окна, решение. Каждый раздел — свой экран,
// карточка открывается поверх всего листом; клавиш на сенсорном экране нет.

type Tab = 'wins' | 'routes'
interface PhoneUi { tab: Tab; sheet: boolean; set: (p: Partial<Omit<PhoneUi, 'set'>>) => void }
export const usePhoneUi = create<PhoneUi>((set) => ({ tab: 'wins', sheet: false, set: (p) => set(p) }))

const HOURS = Array.from({ length: 19 }, (_, i) => i + 5)

type Section = Tab | 'map' | 'live' | 'month'
const NAV: { key: Section; label: string; icon: React.ReactNode }[] = [
  { key: 'wins', label: 'Окна', icon: <IconGrid /> },
  { key: 'routes', label: 'Маршруты', icon: <IconTable /> },
  { key: 'map', label: 'Карта', icon: <IconMap /> },
  { key: 'live', label: 'Живой день', icon: <IconPlay /> },
  { key: 'month', label: 'Месяц', icon: <IconCalendar /> },
]

export function PhoneNav() {
  const { horizon, view } = useStore()
  const { tab, set } = usePhoneUi()
  const active: Section = horizon !== 'day' ? 'month' : view === 'map' ? 'map' : view === 'live' ? 'live' : tab
  const go = (k: Section) => {
    set({ sheet: false })
    if (k === 'month') setHorizon('month')
    else if (k === 'map' || k === 'live') setView(k)
    else { setView('grid'); set({ tab: k }) }
    window.scrollTo({ top: 0 })
  }
  return (
    <nav className="b-rail b-phnav" aria-label="Разделы">
      {NAV.map((i) => (
        <button key={i.key} type="button" className={`b-rail-i${active === i.key ? ' on' : ''}`} aria-current={active === i.key ? 'page' : undefined} onClick={() => go(i.key)}>
          {i.icon}<span>{i.label}</span>
        </button>
      ))}
    </nav>
  )
}

/** Площадка выпуска: на телефоне фильтр живёт над списком, а не в шапке. */
function PlaceSelect({ ctx }: { ctx: Ctx }) {
  const { place, set } = useStore()
  const depots = ctx.ds.depots ?? {}
  const places = [...new Set(Object.values(depots).map((p) => p[0]?.[0]).filter(Boolean))].sort()
  if (places.length < 2) return null
  const routesOf = (p: string) => Object.entries(depots).filter(([, v]) => v[0]?.[0] === p).map(([r]) => r).sort((a, b) => Number(a) - Number(b))
  return (
    <div className="b-ph-place">
      <Select size="m" width="max" value={[place || 'all']} onUpdate={([v]) => set({ place: v === 'all' ? '' : v })}
        options={[{ value: 'all', content: 'Все площадки' }, ...places.map((p) => ({ value: p, content: `Площадка ${p} · ${routesOf(p).join(', ')}` }))]} />
    </div>
  )
}

/** Маршруты: полоса часов 05—23 цветом загрузки; касание часа открывает карточку. */
function Routes({ ctx, sc, open }: { ctx: Ctx; sc: Screen; open: () => void }) {
  const { place } = useStore()
  const thr = Number(ctx.s.threshold_pct)
  const list = ctx.ds.routes.filter((r) => !place || ctx.ds.depots?.[r.id]?.[0]?.[0] === place)
  const go = (id: string, h: number) => { pick(id, h, 'routes'); open() }
  return (
    <div className="b-ph-routes">
      <div className="b-ph-axis" aria-hidden="true">
        {HOURS.map((h) => <span key={h}>{h % 4 === 1 ? String(h).padStart(2, '0') : ''}</span>)}
      </div>
      {list.map((r) => {
        const d = sc.days[r.id]
        const load = sc.after[r.id]
        const peak = d.total ? load[d.peakHour] : 0
        const fleet = fleetDay(ctx, r.id, sc.day)
        return (
          <div key={r.id} className={`b-ph-route${d.total ? '' : ' off'}`}>
            <button type="button" className="hd" disabled={!d.total} onClick={() => go(r.id, d.peakHour)}>
              <RNum id={r.id} off={!d.total} />
              <span className="nm">{fleet?.low ? <em className="fl">выпуск {num(fleet.pct)} %</em> : null}{r.name}</span>
              <span className="t">{d.total ? thousands(d.total) : 'не работает'}</span>
              {d.total ? <span className={`v${peak >= thr ? ' over' : ''}`}>{num(peak)} %</span> : null}
            </button>
            {d.total ? (
              <div className="strip">
                {HOURS.map((h) => (
                  <button key={h} type="button" className={load[h] >= thr ? 'over' : ''} style={{ background: `var(--b-l${stepOf(load[h])})` }}
                    aria-label={`Маршрут ${r.id}, ${hh(h)}: ${num(load[h])} %`} onClick={() => go(r.id, h)} />
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
      <p className="b-ph-note">Цвет — загрузка часа, оценка; обводка — выше порога {thr} %. Касание часа открывает карточку.</p>
    </div>
  )
}

export function PhoneDay({ ctx, sc }: { ctx: Ctx; sc: Screen }) {
  const { tab, set } = usePhoneUi()
  const open = () => set({ sheet: true })
  return (
    <main className="b-ph">
      <PlaceSelect ctx={ctx} />
      {tab === 'wins' ? (
        <>
          <Kpis ctx={ctx} sc={sc} />
          <h2 className="b-ph-h">{ctx.s.f_fare ? "Окна риска · с безбилетниками" : "Окна риска"}</h2>
          <RiskList ctx={ctx} sc={sc} inline={false} onOpen={open} pastOpen />
        </>
      ) : (
        <>
          <h2 className="b-ph-h">Маршруты по часам</h2>
          <Routes ctx={ctx} sc={sc} open={open} />
        </>
      )}
    </main>
  )
}

const HUB = /метро|мцк|мцд|вокзал|площадь|платформа/i

/** Линия маршрута столбиком, как в приложениях метро: концы и пересадки, по кнопке — все остановки. */
function StopList({ ctx }: { ctx: Ctx }) {
  const route = useStore((s) => s.route)
  const [all, setAll] = useState(false)
  const names = (ctx.ds.routes.find((x) => x.id === route)?.stops ?? []).map((s) => s.name)
    .filter((nm, i, arr) => nm !== arr[i - 1])
  const n = names.length
  if (!n) return <p className="b-ph-note">Остановок маршрута {route} нет в справочнике организаторов.</p>
  const key = names.map((nm, i) => i === 0 || i === n - 1 || HUB.test(nm))
  const shown = names.map((nm, i) => ({ nm, i })).filter((x) => all || key[x.i])
  return (
    <>
      <ol className="b-stops">
        {shown.map(({ nm, i }) => <li key={i} className={key[i] ? 'hub' : ''}>{nm}</li>)}
      </ol>
      <button type="button" className="b-lnk" onClick={() => setAll(!all)}>{all ? 'Только концы и пересадки' : `Все остановки: ${n}`}</button>
      <p className="b-ph-note">Загрузка по остановкам не измеряется: в валидациях нет остановки.</p>
    </>
  )
}

/** Карточка окна или часа — лист снизу: ручка, подложка, свайп вниз закрывает. */
export function PhoneSheet({ ctx, sc }: { ctx: Ctx; sc: Screen }) {
  const { sheet, set } = usePhoneUi()
  const route = useStore((s) => s.route)
  const [drag, setDrag] = useState(0)
  const start = useRef<number | null>(null)
  // Системная кнопка «назад» закрывает лист, а не уводит со страницы.
  useEffect(() => {
    if (!sheet) return
    history.pushState({ sheet: true }, '')
    const onPop = () => set({ sheet: false })
    window.addEventListener('popstate', onPop)
    document.documentElement.classList.add('b-locked')
    return () => {
      window.removeEventListener('popstate', onPop)
      document.documentElement.classList.remove('b-locked')
    }
  }, [sheet, set])
  if (!sheet) return null
  const close = () => history.back()
  const onStart = (e: React.TouchEvent) => { start.current = e.touches[0].clientY }
  const onMove = (e: React.TouchEvent) => { if (start.current !== null) setDrag(Math.max(0, e.touches[0].clientY - start.current)) }
  const onEnd = () => {
    if (drag > 90) close()
    start.current = null
    setDrag(0)
  }
  return (
    <div className="b-sheet-wrap">
      <div className="b-sheet-bg" onClick={close} />
      <div className="b-sheet" role="dialog" aria-modal="true" aria-label={`Маршрут ${route}`}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}>
        <header onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
          <i className="grip" aria-hidden="true" />
          <button type="button" className="x" onClick={close}>Закрыть</button>
        </header>
        <div className="b-sheet-body">
          <WindowCard ctx={ctx} sc={sc} />
          <h4 className="b-ph-h small">Линия маршрута {route}</h4>
          <StopList ctx={ctx} />
        </div>
      </div>
    </div>
  )
}
