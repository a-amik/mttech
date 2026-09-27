import { useState } from 'react'
import { useStore, type Template } from '../store'
import { Button, HelpMark, Slider } from '@gravity-ui/uikit'
import { hh, num, ruDay } from '../data'
import { bandDay, delayCase, decidedLoad, fleetDay, priorityOf, tripsNeeded, type Adjust, type Ctx, type PlanSrc } from '../model'
import { capacityHour, carsOf, dirShare, loadPct, tripsHour } from '../settings'
import { accept, revoke, snooze, span, trips } from '../actions'
import type { Screen } from '../screen'
import { Key, Pri, RNum } from './Bits'
import DayChart from './DayChart'

/** С какой доли общих остановок маршрут вне задания стоит назвать в подсказке. */
const SHARED_MIN = 0.15

/** Принятое решение сразу превращается в сообщение пассажирам — как оповещения Optibus. */
function Notice({ route, w, t, n }: { route: string; w: { from: number; to: number }; t: number; n: number }) {
  const { notify } = useStore()
  const text = `Трамвай ${route}: с ${hh(w.from)} до ${hh(w.to)} вагоны ходят чаще — каждые ${num(60 / (t + n), 1)} мин вместо ${num(60 / t, 1)}.`
  return (
    <div className="b-notice">
      <h4>Сообщение пассажирам</h4>
      <p>{text}</p>
      <Button size="s" view="outlined" onClick={() => { navigator.clipboard?.writeText(text).catch(() => undefined); notify('Текст сообщения скопирован') }}>Скопировать</Button>
    </div>
  )
}

const PRIO_NAME = ['ниже порога внимания', 'приоритет 1', 'приоритет 2', 'приоритет 3, внимание']
const pct = (v: number, d = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), d)} %`
const markFormat = (v: number) => num(v)

/** Шаблоны поправок: готовый набор ползунков одним нажатием. Значения при включении — отправная точка, не замер. */
export function templateOn(t: Template, adj: Adjust, route: string): boolean {
  return t === 'holiday' ? Boolean(adj.dayPct) : t === 'rain' ? Boolean(adj.rain)
    : t === 'snow' ? adj.snowPct !== 0 : t === 'closure' ? adj.closure?.route === route : adj.event?.route === route
}

export function templateToggle(t: Template, adj: Adjust, route: string, hour: number, want = !templateOn(t, adj, route)): Partial<Adjust> {
  const on = !want
  switch (t) {
    case 'holiday': return { dayPct: on ? 0 : -50 }
    case 'rain': return { rain: !on, weather: true }
    case 'snow': return { snowPct: on ? 0 : -10 }
    case 'closure': return { closure: on ? null : { route, pct: 30 } }
    case 'event': return { event: on ? null : { route, from: Math.max(5, hour), to: Math.min(24, hour + 3), pct: 30 } }
  }
}

export const TEMPLATES: { key: Template; label: string }[] = [
  { key: 'holiday', label: 'Праздник' },
  { key: 'rain', label: 'Дождь' },
  { key: 'snow', label: 'Снег' },
  { key: 'closure', label: 'Закрытие участка' },
  { key: 'event', label: 'Событие' },
]

/** Числа выбранного окна или часа — одни для карточки в панели и для блока загрузки справа. */
function useWindow(ctx: Ctx, sc: Screen) {
  const { route, hour, day, extra } = useStore()
  const d = sc.days[route]
  const w = sc.winAt(route, hour)
  const thr = Number(ctx.s.threshold_pct)
  const h0 = w ? w.peakHour : hour
  const load = d.load[h0]
  const bandAll = bandDay(ctx, route, day, d.fc)
  const bandB = bandAll[h0]
  const band: [number, number] = w ? w.band : [loadPct(ctx.s, route, h0, bandB[0], d.plan), loadPct(ctx.s, route, h0, bandB[1], d.plan)]
  const dec = w ? sc.decided(w) : undefined
  const need = w ? tripsNeeded(ctx, w, d.load) : 0
  const n = dec ? dec.trips : w && extra?.key === w.key ? extra.n : need
  const hoursOf = w ? Array.from({ length: w.to - w.from }, (_, i) => w.from + i) : [h0]
  const after = Math.max(...hoursOf.map((h) => decidedLoad(ctx, route, h, d.load[h], n, d.plan)))
  return { route, d, w, thr, h0, load, bandAll, band, dec, need, n, after }
}

const PLAN_SRC: Record<PlanSrc, (day: number) => string> = {
  date: (day) => `расписание transport.mos.ru на ${ruDay(day, false)}`,
  type: () => 'типовое расписание октября для такого дня',
  interval: () => 'интервал из настроек, допущение',
}

/** Предложение против спроса: рейсы по расписанию, посадки на рейс, выпуск прошедшего дня. */
function Supply({ ctx, sc }: { ctx: Ctx; sc: Screen }) {
  const { route, h0, d } = useWindow(ctx, sc)
  const { day } = useStore()
  const t = tripsHour(ctx.s, route, h0, d.plan)
  const fleet = fleetDay(ctx, route, day)
  return (
    <section className="b-block">
      <h4>Рейсы и выпуск<HelpMark iconSize="s" className="b-help">
        Рейсы в одну сторону — {PLAN_SRC[d.planSrc](day)}. Посадки на рейс — в более нагруженную сторону, её доля {num(dirShare(ctx.s, h0) * 100)} % — допущение из настроек.
        {fleet ? ` Вагоны — по валидациям, из обычного числа при ${num(fleet.planTrips)} рейсах за день.` : ''}
      </HelpMark></h4>
      <ul className="b-why">
        <li><span>Рейсы в {hh(h0)}</span><b>{t ? `${num(t, Number.isInteger(t) ? 0 : 1)} в час, раз в ${num(60 / t, 1)} мин` : 'рейсов нет'}</b></li>
        {t ? <li><span>Посадок на рейс, {d.fact && ctx.s.show_fact ? 'факт' : 'прогноз'}</span><b>{num(((d.fact && ctx.s.show_fact ? d.fact[h0] : d.fc[h0]) * dirShare(ctx.s, h0)) / t)}</b></li> : null}
        {ctx.s.load_basis === 'usual' && ctx.s[`usual_${route}`] ? <li><span>Обычный будний пик</span><b>{num(Number(ctx.s[`usual_${route}`]))} на рейс = {String(ctx.s.usual_pct)} %</b></li> : null}
        {fleet ? (
          <li><span>Вагоны за день</span>
            <b className={fleet.low ? 'b-low' : ''}>{num(fleet.trams)} из {num(fleet.usual)}, {num(fleet.pct)} %</b></li>
        ) : null}
      </ul>
      {fleet?.low ? <p className="b-hint">Выпуск ниже нормы: провал посадок в этот день — не спрос.</p> : null}
    </section>
  )
}

/** Загрузка выбранного маршрута и часа: крупная цифра, график дня, интервал против порога. */
export function LoadBlock({ ctx, sc }: { ctx: Ctx; sc: Screen }) {
  const { route, d, w, thr, h0, load, bandAll, band, dec, n, after } = useWindow(ctx, sc)
  if (!d.total) return null
  const thrLine = d.fc.map((_, h) => (capacityHour(ctx.s, route, h, d.plan) * thr) / 100)
  const fact = ctx.s.show_fact ? d.fact : null
  const max = Math.max(130, Math.ceil((band[1] + 10) / 10) * 10)
  const at = (v: number) => `${Math.min(100, (v / max) * 100)}%`
  return (
    <div className="b-load">
      <div className="b-big">
        <b className={load >= thr ? 'over' : ''}>{num(load)} %</b>
        <span>загрузка в {hh(h0)}, оценка{ctx.s.f_fare ? ', с безбилетниками' : ''}<br />{num(d.fc[h0])} посадок{d.fact && ctx.s.show_fact ? `, факт ${num(d.fact[h0])}` : ''}</span>
      </div>
      <DayChart fc={d.fc} band={bandAll} fact={fact} threshold={thrLine} hour={h0} />
      <div className="b-chart-legend">
        <span><i style={{ background: 'var(--b-accent)' }} />прогноз</span>
        <span><i style={{ background: 'var(--b-accent)', opacity: 0.2, height: 8 }} />разброс истории</span>
        {fact ? <span><i style={{ background: 'var(--b-text)', width: 6, height: 6, borderRadius: 3 }} />факт</span> : null}
        <span><i style={{ background: 'var(--b-over)' }} />порог</span>
      </div>
      <div className="b-ib" aria-hidden="true">
        <div className="axis" />
        <div className="rng" style={{ left: at(band[0]), width: `calc(${at(band[1])} - ${at(band[0])})` }} />
        <div className="th" style={{ left: at(thr) }} />
        <div className="pt" style={{ left: at(load) }} />
        {n && (dec || w) ? <div className="nw" style={{ left: at(after) }} /> : null}
      </div>
      <div className="b-ibl"><span>0</span><span>разброс {num(band[0])}—{num(band[1])} % · порог {thr}</span><span>{max}</span></div>
    </div>
  )
}

/** С какого опоздания в долях интервала следующий вагон заметно догоняет опоздавший. */
const CATCH_UP = 0.5

/** Сценарий «рейс опоздал»: опоздание приходит от диспетчера или предиктора задержек, загрузку считает наша модель. */
function Delay({ ctx, sc }: { ctx: Ctx; sc: Screen }) {
  const { route, d, h0, load, thr } = useWindow(ctx, sc)
  const [delay, setDelay] = useState(3)
  const c = delayCase(ctx, route, h0, load, delay, d.plan)
  if (!c) return null
  const max = Math.min(30, Math.max(10, Math.ceil(c.interval * 2)))
  return (
    <section className="b-block">
      <h4>Если рейс опоздает</h4>
      <div className="b-adj">
        <div className="b-adj-row">
          <span>Опоздание рейса в {hh(h0)}</span><b>{delay} мин</b>
          <Slider size="s" min={0} max={max} step={1} value={Math.min(delay, max)} tooltipDisplay="off" markFormat={markFormat} aria-label="Опоздание рейса"
            onUpdate={(v) => setDelay(v as number)} />
          <small>Задаёт диспетчер или предиктор задержек за 10—15 минут до остановки. Интервал по плану — {num(c.interval, 1)} мин.</small>
        </div>
      </div>
      <p className="b-eff">
        Опоздавший рейс: <b>{num(load)} %</b> → <b className={c.late >= thr ? 'over' : 'to'}>{num(c.late)} %</b>
        <br />Следующий за ним: {num(load)} → {num(c.next)} %{c.pair ? ', догоняет — вагоны идут парой' : ''}
      </p>
      {c.late >= thr ? (
        <p className="b-eff b-alt">
          Вагон в&nbsp;разрыв перед опоздавшим: оба рейса по&nbsp;<b className={c.relief >= thr ? 'over' : 'to'}>{num(c.relief)} %</b>.
        </p>
      ) : (
        <p className="b-eff b-alt">Порог {thr} % не&nbsp;пересечён.</p>
      )}
      {!c.pair && delay >= c.interval * CATCH_UP ? (
        <p className="b-hint">Следующий вагон догоняет опоздавший: его стоит придержать на&nbsp;конечной, иначе вагоны пойдут парой.</p>
      ) : null}
      <small className="b-muted">
        Оценка: посадки на&nbsp;рейс растут с&nbsp;интервалом перед ним. Сколько пассажиров копится, пока вагона нет, — допущение в&nbsp;настройках, {String(ctx.s.delay_random_pct)} %.
      </small>
    </section>
  )
}

export default function WindowCard({ ctx, sc }: { ctx: Ctx; sc: Screen }) {
  const { route, hour } = useStore()
  const { set } = useStore()
  const r = ctx.ds.routes.find((x) => x.id === route)!
  const d = sc.days[route]
  const w = sc.winAt(route, hour)
  const thr = Number(ctx.s.threshold_pct)

  if (d.total === 0) {
    return (
      <div className="b-card" aria-live="polite">
        <h3 className="b-card-h"><RNum id={route} off />Маршрут {route}</h3>
        <p className="b-muted">
          Маршрут в этот день не работает: версия в справочнике действует с {r.since ? new Date(r.since).toLocaleDateString('ru-RU') : 'неизвестной даты'}.
          По ответу организаторов до этой даты в эталоне нули.
        </p>
      </div>
    )
  }

  const { h0, load, dec, need, n, after } = useWindow(ctx, sc)
  const prio = w ? w.prio : priorityOf(ctx.s, load)
  const t = tripsHour(ctx.s, route, h0, d.plan)
  const setN = (k: number) => w && set({ extra: { key: w.key, n: Math.max(1, Math.min(Math.ceil(t * 2), k)) } })
  const shared = (ctx.ds.network?.routes ?? [])
    .map((x) => [x.id, x.overlap[route] ?? 0] as [string, number])
    .filter(([, v]) => v >= SHARED_MIN).sort((a, b) => b[1] - a[1]).slice(0, 3)

  return (
    <div className="b-card" aria-live="polite">
      <h3 className="b-card-h"><RNum id={route} />{w ? span(w) : `${hh(hour)}—${hh(hour + 1)}`}</h3>
      <p className="b-muted b-card-sub"><Pri p={prio} /> {r.stops.length ? r.name : `Маршрут ${route}`} · {PRIO_NAME[prio]}</p>
      <LoadBlock ctx={ctx} sc={sc} />

      <ul className="b-why">
        {(w ? w.causes : []).map((c) => (
          <li key={c.key}><span>{c.label}</span><b>{c.pct !== undefined ? pct(c.pct) : c.key === 'am' || c.key === 'pm' ? `рейс каждые ${num(60 / t, 1)} мин` : ''}</b></li>
        ))}
        {!w ? <li><span>Ниже порога внимания {String(ctx.s.warn_pct)} %</span><b>решение не нужно</b></li> : null}
      </ul>

      <Supply ctx={ctx} sc={sc} />

      {w && (need > 0 || dec) ? (
        <section className={`b-rec${dec ? ' done' : ''}`}>
          <h4>{dec ? 'Решение принято' : prio === 3 ? 'Можно заранее' : 'Рекомендация'}<HelpMark iconSize="s" className="b-help">
            Рейсы — до загрузки {String(ctx.s.target_pct)} % в каждом часе окна, сверх {d.planSrc === 'interval' ? 'интервала из настроек' : 'расписания'}. Сцепка и число вагонов в составе — в настройках маршрута.
          </HelpMark></h4>
          <div className="b-step">
            <Button size="m" view="outlined" disabled={Boolean(dec) || n <= 1} onClick={() => setN(n - 1)} aria-label="Меньше рейсов">−</Button>
            <output>+{trips(n)} в час</output>
            <Button size="m" view="outlined" disabled={Boolean(dec)} onClick={() => setN(n + 1)} aria-label="Больше рейсов">+</Button>
          </div>
          <p className="b-eff">
            Загрузка <b>{num(w.peak)} %</b> → <b className={after >= thr ? 'over' : 'to'}>{num(after)} %</b>
            {' '}· интервал {num(60 / t, 1)} → {num(60 / (t + n), 1)} мин
          </p>
          {carsOf(ctx.s, route) === 1 ? (
            <p className="b-eff b-alt">
              Или сцепка из&nbsp;двух вагонов на&nbsp;выходах окна: <b>{num(w.peak)} %</b> → <b className={w.peak / 2 >= thr ? 'over' : 'to'}>{num(w.peak / 2)} %</b> без новых рейсов.
            </p>
          ) : null}
          <div className="b-btns">
            {dec ? (
              <Button size="m" view="outlined" onClick={() => revoke(w)}>Снять решение</Button>
            ) : (
              <>
                <Button size="m" view="action" onClick={() => accept(w, n)}><span className="b-btn">Принять<Key k="a" /></span></Button>
                <Button size="m" view="outlined" onClick={() => snooze(w)}>Отложить</Button>
              </>
            )}
          </div>
          {shared.length ? (
            <p className="b-muted b-short">
              Общие остановки: {shared.map(([id]) => id).join(', ')}
              <HelpMark iconSize="s" className="b-help">
                Через остановки маршрута {route} идут ещё {shared.map(([id, v]) => `${id} (${num(v * 100)} % остановок)`).join(', ')}.
                Часть пассажиров окна может уехать на них; при их отключении нагрузка придёт сюда.
              </HelpMark>
            </p>
          ) : null}
          {dec ? <Notice route={route} w={w} t={t} n={dec.trips} /> : null}
        </section>
      ) : null}

      <Delay key={`${route}@${h0}`} ctx={ctx} sc={sc} />

    </div>
  )
}
