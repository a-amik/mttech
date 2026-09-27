import { DAYS, FACT_DAYS, dowOf, hh, isoOf, type Dataset } from './data'
import { isPeak, loadPct, loadWithTrips, tripsHour, type Settings } from './settings'

export interface Adjust {
  level: number
  weather: boolean
  snowPct: number
  event: { route: string; from: number; to: number; pct: number } | null
  closure: { route: string; pct: number } | null
  /** Дождь по слову диспетчера, когда в прогнозе погоды его нет (шаблон поправок). */
  rain?: boolean
  /** Праздник или особый день ко всей сети, % (шаблон поправок). */
  dayPct?: number
  /** Отключённые маршруты вне задания: их пассажиры переходят на общие остановки. */
  off?: string[]
}

export const ADJUST_DEFAULT: Adjust = { level: 1, weather: true, snowPct: 0, event: null, closure: null }

// Пороги и эффекты внешних факторов живут в settings (группа «Внешние факторы»);
// здесь — запасные значения для мест, где настроек нет под рукой.
export const RAIN_MM = 5
export const RAIN_EFFECT = -0.021
// Множители, уже зашитые в предрасчёт лучшей попытки: тумблеры считают отклонение от них.
const BAKED_R5_LEVEL = 0.71
const BAKED_NYE = 0.5

/** Подмена дня из имитационного стенда: синтетический «факт» по маршрутам. */
export interface SimDay {
  idx: number
  fact: Record<string, number[]>
  label: string
}

export interface Ctx {
  ds: Dataset
  s: Settings
  adj: Adjust
  model: string
  sim: SimDay | null
  /** Час смены: до него часы уже прошли, с него считаются окна и пересчёт по факту. */
  now: number
}

/** Первый час работы линии; раньше — только технологические валидации. */
export const FIRST_HOUR = 5

export const isHoliday = (ctx: Ctx, idx: number) => ctx.ds.context.calendar[isoOf(idx)] === 1 && dowOf(idx) < 5

function baseDay(ctx: Ctx, route: string, idx: number): number[] {
  const { ds, s } = ctx
  if (idx < FACT_DAYS) return ds.series.backtest[route][idx]
  const nd = (ds.models.nd[ctx.model] ?? ds.models.nd[ds.models.main])[route]
  const i = idx - FACT_DAYS
  if (route === '5' && s.route5_start === '2025-11-01' && isoOf(idx) < '2025-12-16') {
    const same = nd.findIndex((_, j) => j + FACT_DAYS >= idxOfIso('2025-12-16') && dowOf(j + FACT_DAYS) === dowOf(idx))
    return same >= 0 ? nd[same] : nd[i]
  }
  if (isHoliday(ctx, idx) && s.weekend_as === 'saturday') {
    const shift = (5 - dowOf(idx) + 7) % 7
    const j = Math.min(DAYS - 1, idx + shift) - FACT_DAYS
    if (j >= 0 && j < nd.length) return nd[j]
  }
  return nd[i]
}

const idxOfIso = (iso: string) => Math.round((Date.parse(iso) - Date.parse('2025-09-01')) / 86_400_000)

export interface Factor { label: string; pct: number; key?: string }

export function factors(ctx: Ctx, route: string, idx: number): Factor[] {
  const out: Factor[] = []
  const w = ctx.ds.context.weather[isoOf(idx)]
  if (ctx.adj.level !== 1) out.push({ label: 'Уровень сезона', pct: (ctx.adj.level - 1) * 100 })
  if (ctx.adj.dayPct) out.push({ label: 'Праздник', pct: ctx.adj.dayPct })
  const s = ctx.s
  const rainPct = Number(s.rain_pct)
  if (s.f_rain && ctx.adj.weather && w && w[1] >= Number(s.rain_mm)) out.push({ key: 'rain', label: `Дождь ${w[1].toFixed(1)} мм`, pct: rainPct })
  else if (ctx.adj.rain) out.push({ key: 'rain', label: 'Дождь, по слову диспетчера', pct: rainPct })
  const snowPct = ctx.adj.snowPct || (s.f_snow ? Number(s.snow_pct) : 0)
  if (snowPct && w && w[2] > 0) out.push({ key: 'snow', label: `Снег ${w[2].toFixed(1)} см`, pct: snowPct * Math.min(1, w[2] / 5) })
  if (s.f_ice && ctx.ds.factors?.[isoOf(idx)]?.ice_rain) out.push({ key: 'ice', label: 'Ледяной дождь', pct: Number(s.ice_pct) })
  if (route === '5' && Number(s.r5_level) !== BAKED_R5_LEVEL) out.push({ key: 'r5', label: 'Уровень маршрута 5', pct: (Number(s.r5_level) / BAKED_R5_LEVEL - 1) * 100 })
  if (ctx.adj.closure?.route === route) out.push({ label: 'Закрыт участок', pct: -ctx.adj.closure.pct })
  for (const id of ctx.adj.off ?? []) {
    const share = ctx.ds.network?.routes.find((r) => r.id === id)?.overlap[route]
    if (share) out.push({ key: `off-${id}`, label: `Отключён маршрут ${id}`, pct: share * Number(ctx.s.net_shift_pct) })
  }
  return out
}

/** Прогноз дня с поправками, без пересчёта по факту прошедших часов. */
export function forecastPlain(ctx: Ctx, route: string, idx: number): number[] {
  const base = baseDay(ctx, route, idx)
  const k = factors(ctx, route, idx).reduce((acc, f) => acc * (1 + f.pct / 100), 1)
  const ev = ctx.adj.event?.route === route ? ctx.adj.event : null
  // Вечер 31 декабря: в предрасчёте × 0,5, ручка задаёт свой процент от обычного вечера.
  const nye = isoOf(idx) === '2025-12-31' ? (1 + Number(ctx.s.nye_pct) / 100) / BAKED_NYE : 1
  return base.map((v, h) => Math.round(v * k * (ev && h >= ev.from && h < ev.to ? 1 + ev.pct / 100 : 1) * (h >= 18 ? nye : 1)))
}

export function factDay(ctx: Ctx, route: string, idx: number): number[] | null {
  if (ctx.sim && ctx.sim.idx === idx) return ctx.sim.fact[route] ?? null
  return idx < FACT_DAYS ? ctx.ds.series.fact[route][idx] : null
}

export interface Nowcast {
  /** Множитель на остаток дня. */
  k: number
  /** Часов факта, по которым он посчитан. */
  seen: number
  /** С какого часа применяется — час смены. */
  from: number
}

// Отношение считается только по часам, где прогноз набрал NOWCAST_HOUR_MIN посадок, и только если
// их сумма не меньше NOWCAST_SUM_MIN: в 5—6 утра у малых маршрутов прогноз — единицы посадок, и одна
// лишняя валидация давала множитель ×3 на весь день (маршрут 25, выходные октября: 178 % вместо 59 %).
// Границы 0,8—1,25: шире на октябре только хуже.
const NOWCAST_MIN = 0.8
const NOWCAST_MAX = 1.25
const NOWCAST_HOUR_MIN = 50
const NOWCAST_SUM_MIN = 300
// Час, где факт меньше пятой части прогноза, — провал данных, а не спрос: в пересчёт не идёт, как в API.
const NOWCAST_GAP_SHARE = 0.2

/**
 * Пересчёт остатка дня по факту: отношение факта к прогнозу за прошедшие часы, сжатое к единице
 * (доверие 50 % — корень), переносится на часы с часа смены. Октябрь 2025, остаток дня по девяти
 * маршрутам: 7:00 — 0,903 против 0,904 без пересчёта, 9:00 — 0,904 против 0,900, 11:00 — 0,906
 * против 0,898, 16:00 — 0,908 против 0,900. Без сжатия в 7—9 часов хуже, чем без пересчёта.
 */
export function nowcastDay(ctx: Ctx, route: string, idx: number, plain: number[]): Nowcast | null {
  const fact = factDay(ctx, route, idx)
  if (!ctx.s.nowcast || !fact) return null
  let y = 0
  let p = 0
  let seen = 0
  for (let h = FIRST_HOUR; h < ctx.now; h++) {
    if (plain[h] < NOWCAST_HOUR_MIN || fact[h] < NOWCAST_GAP_SHARE * plain[h]) continue
    seen++
    y += fact[h]
    p += plain[h]
  }
  if (seen < Number(ctx.s.nowcast_min_hours) || p < NOWCAST_SUM_MIN) return null
  const ratio = Math.min(NOWCAST_MAX, Math.max(NOWCAST_MIN, y / p))
  return { k: Math.pow(ratio, Number(ctx.s.nowcast_trust) / 100), seen, from: ctx.now }
}

const applyNowcast = (plain: number[], nc: Nowcast | null) =>
  nc ? plain.map((v, h) => (h >= nc.from ? Math.round(v * nc.k) : v)) : plain

export function forecastDay(ctx: Ctx, route: string, idx: number): number[] {
  const plain = forecastPlain(ctx, route, idx)
  return applyNowcast(plain, nowcastDay(ctx, route, idx, plain))
}

export function bandDay(ctx: Ctx, route: string, idx: number, fc: number[]) {
  const b = ctx.ds.series.band[route]
  const dow = dowOf(idx)
  const narrow = ctx.s.band === '50' ? 0.5 : 1
  return fc.map((v, h) => [
    Math.round(v * (1 - (1 - b.lo[dow][h]) * narrow)),
    Math.round(v * (1 + (b.hi[dow][h] - 1) * narrow)),
  ])
}

export type Level = 'over' | 'warn' | 'ok'

/** Откуда рейсы дня: расписание на дату, типовое расписание октября или интервалы из настроек. */
export type PlanSrc = 'date' | 'type' | 'interval'

export function planDay(ctx: Ctx, route: string, idx: number): { trips: number[] | null; src: PlanSrc } {
  const sch = ctx.ds.schedule
  if (ctx.s.trips_source !== 'schedule' || !sch?.typical[route]) return { trips: null, src: 'interval' }
  const iso = isoOf(idx)
  const onDate = sch.trips[route]?.[iso]
  if (onDate && onDate.some((v) => v > 0)) return { trips: onDate, src: 'date' }
  const off = ctx.ds.context.calendar[iso] === 1
  const typ = !off ? 'w' : dowOf(idx) === 5 ? 'sat' : 'sun'
  return { trips: sch.typical[route][typ], src: 'type' }
}

export interface Fleet { trams: number; planTrips: number; usual: number; pct: number; low: boolean }

/** Выпуск прошедшего дня: вагоны с валидациями против обычного числа при таком расписании. */
export function fleetDay(ctx: Ctx, route: string, idx: number): Fleet | null {
  const row = ctx.ds.schedule?.fleet[route]?.[isoOf(idx)]
  if (idx >= FACT_DAYS || !row || !row[2]) return null
  const [trams, planTrips, usual] = row
  const pct = (trams / usual) * 100
  return { trams, planTrips, usual, pct, low: pct < Number(ctx.s.fleet_low_pct) }
}

export interface RouteDay {
  route: string
  fc: number[]
  fact: number[] | null
  /** Плановые рейсы в час в каждую сторону; null — по интервалам из настроек. */
  plan: number[] | null
  planSrc: PlanSrc
  load: number[]
  total: number
  peakHour: number
  peakLoad: number
  level: Level
  risk: number[]
  /** Прогноз без пересчёта по факту и сам пересчёт, если он действует. */
  plain: number[]
  nowcast: Nowcast | null
}

export function routeDay(ctx: Ctx, route: string, idx: number): RouteDay {
  const plain = forecastPlain(ctx, route, idx)
  const nowcast = nowcastDay(ctx, route, idx, plain)
  const fc = applyNowcast(plain, nowcast)
  const fact = factDay(ctx, route, idx)
  const { trips: plan, src: planSrc } = planDay(ctx, route, idx)
  const load = fc.map((v, h) => loadPct(ctx.s, route, h, v, plan))
  const peakHour = load.reduce((best, v, h) => (v > load[best] ? h : best), 0)
  const peakLoad = load[peakHour]
  const threshold = Number(ctx.s.threshold_pct)
  const level: Level = peakLoad >= threshold ? 'over' : peakLoad >= Number(ctx.s.warn_pct) ? 'warn' : 'ok'
  const risk = load.flatMap((v, h) => (v >= threshold ? [h] : []))
  return { route, fc, fact, plan, planSrc, load, total: fc.reduce((a, b) => a + b, 0), peakHour, peakLoad, level, risk, plain, nowcast }
}

/** Часы подряд над порогом — окна риска. */
export function windows(hours: number[]): [number, number][] {
  const out: [number, number][] = []
  for (const h of hours) {
    const last = out[out.length - 1]
    if (last && last[1] === h) last[1] = h + 1
    else out.push([h, h + 1])
  }
  return out
}

export function sameDowMean(ctx: Ctx, route: string, idx: number): number {
  const dow = dowOf(idx)
  const days: number[] = []
  for (let i = idx - 28; i < idx + 28; i += 7) {
    if (i < 0 || i >= DAYS || i === idx || dowOf(i) !== dow || isHoliday(ctx, i)) continue
    // День, когда маршрут не работал, обычным не считается: иначе первая неделя маршрута 5 «выше обычного на 400 %».
    if (baseDay(ctx, route, i).some((v) => v > 0)) days.push(i)
  }
  if (!days.length) return 0
  return days.reduce((acc, i) => acc + baseDay(ctx, route, i).reduce((a, b) => a + b, 0), 0) / days.length
}

// ── Окна риска, причины, рекомендация ──

/** Интервал прогноза шире 30 % от прогноза — штриховка в сетке; так помечена примерно четверть ячеек 06—23 ч. */
export const WIDE_BAND = 0.3

export type Priority = 1 | 2 | 3

export interface Cause { key: string; label: string; pct?: number }

export interface RiskWindow {
  key: string
  route: string
  from: number
  to: number
  peakHour: number
  peak: number
  boardings: number
  band: [number, number]
  plan: number[] | null
  prio: Priority
  causes: Cause[]
  /** Причина для свёртки: одна строка на все окна с ней. */
  cause: Cause
}

const DOW_GEN = ['обычного понедельника', 'обычного вторника', 'обычной среды', 'обычного четверга', 'обычной пятницы', 'обычной субботы', 'обычного воскресенья']

export const priorityOf = (s: Settings, load: number): Priority | 0 =>
  load >= Number(s.prio_high_pct) ? 1 : load >= Number(s.threshold_pct) ? 2 : load >= Number(s.warn_pct) ? 3 : 0

export function causesOf(ctx: Ctx, route: string, idx: number, from: number, to: number, peakHour: number, total: number): Cause[] {
  const out: Cause[] = []
  const ev = ctx.adj.event
  if (ev?.route === route && ev.from < to && ev.to > from) out.push({ key: 'event', label: `Событие ${hh(ev.from)}—${hh(ev.to)}`, pct: ev.pct })
  for (const f of factors(ctx, route, idx)) out.push({ key: f.key ?? f.label.split(/[ ,]/)[0].toLowerCase(), label: f.label, pct: f.pct })
  const nc = nowcastDay(ctx, route, idx, forecastPlain(ctx, route, idx))
  if (nc && to > nc.from && Math.abs(nc.k - 1) >= 0.01) out.push({ key: 'nowcast', label: `По факту до ${hh(nc.from)}`, pct: (nc.k - 1) * 100 })
  if (isHoliday(ctx, idx)) out.push({ key: 'holiday', label: 'Выходной в будний день' })
  const usual = sameDowMean(ctx, route, idx)
  const diff = usual ? (total / usual - 1) * 100 : 0
  if (diff >= 5) out.push({ key: 'usual', label: `Выше ${DOW_GEN[dowOf(idx)]}`, pct: diff })
  const pm = peakHour >= Number(ctx.s.peak_pm_from)
  if (isPeak(ctx.s, peakHour)) out.push({ key: pm ? 'pm' : 'am', label: pm ? 'Вечерний пик' : 'Утренний пик' })
  else out.push({ key: 'day', label: 'Дневной спрос' })
  return out
}

/** Окна риска дня: часы подряд от порога внимания, приоритет по пику окна. */
export function riskWindows(ctx: Ctx, idx: number, days: RouteDay[]): RiskWindow[] {
  const out: RiskWindow[] = []
  const warn = Number(ctx.s.warn_pct)
  for (const d of days) {
    const band = bandDay(ctx, d.route, idx, d.fc)
    const hours = d.load.flatMap((v, h) => (v >= warn ? [h] : []))
    for (const [from, to] of windows(hours)) {
      let peakHour = from
      for (let h = from; h < to; h++) if (d.load[h] > d.load[peakHour]) peakHour = h
      const peak = d.load[peakHour]
      const causes = causesOf(ctx, d.route, idx, from, to, peakHour, d.total)
      const cause = causes.find((c) => (c.pct ?? 1) > 0) ?? causes[causes.length - 1]
      out.push({
        key: `${d.route}@${from}`, route: d.route, from, to, peakHour, peak,
        boardings: d.fc[peakHour],
        band: [loadPct(ctx.s, d.route, peakHour, band[peakHour][0], d.plan), loadPct(ctx.s, d.route, peakHour, band[peakHour][1], d.plan)],
        plan: d.plan,
        prio: priorityOf(ctx.s, peak) as Priority, causes, cause,
      })
    }
  }
  return out.sort((a, b) => a.prio - b.prio || a.from - b.from || b.peak - a.peak)
}

/** Сколько рейсов в час добавить, чтобы каждый час окна встал не выше целевой загрузки. */
/** Рейсов добавить в час, чтобы загрузка опустилась до целевой. */
export function tripsForHour(ctx: Ctx, route: string, h: number, load: number, plan?: number[] | null): number {
  const target = Number(ctx.s.target_pct)
  const t = tripsHour(ctx.s, route, h, plan)
  return t && load > target ? Math.ceil(t * (load / target - 1)) : 0
}

export function tripsNeeded(ctx: Ctx, w: RiskWindow, load: number[]): number {
  const target = Number(ctx.s.target_pct)
  let need = 0
  for (let h = w.from; h < w.to; h++) {
    const t = tripsHour(ctx.s, w.route, h, w.plan)
    if (t && load[h] > target) need = Math.max(need, Math.ceil(t * (load[h] / target - 1)))
  }
  return need
}

export interface DelayCase {
  /** Плановый интервал, мин. */
  interval: number
  /** Загрузка опоздавшего рейса, следующего за ним и каждого из двух, если выпустить вагон в разрыв. */
  late: number
  next: number
  relief: number
  /** Следующий догнал опоздавший: вагоны идут парой. */
  pair: boolean
}

/**
 * Рейс опоздал на delay минут. Пассажиры, которые приходят когда придётся, копятся весь интервал перед вагоном:
 * опоздавший забирает их за interval + delay, следующий по расписанию — только за interval − delay.
 * Вагон в разрыв делит интервал перед опоздавшим пополам.
 */
export function delayCase(ctx: Ctx, route: string, h: number, load: number, delay: number, plan?: number[] | null): DelayCase | null {
  const t = tripsHour(ctx.s, route, h, plan)
  if (!t) return null
  const interval = 60 / t
  const r = Number(ctx.s.delay_random_pct) / 100
  const at = (gap: number) => load * (1 - r + r * (gap / interval))
  return {
    interval,
    late: at(interval + delay),
    next: at(Math.max(0, interval - delay)),
    relief: at((interval + delay) / 2),
    pair: delay >= interval,
  }
}

/** Загрузка окна после решения: те же посадки на большее число рейсов. */
export const decidedLoad = (ctx: Ctx, route: string, h: number, load: number, extra: number, plan?: number[] | null) =>
  loadWithTrips(ctx.s, route, h, load, extra, plan)

/** Ожидающие на остановке: поток посадок остановки в этот час × минуты с прохода прошлого вагона ÷ 60. Оценка. */
export const waitingAt = (boardingsHour: number, sinceMin: number) => (boardingsHour * sinceMin) / 60

/** Без ГЛОНАСС — половина планового интервала: среднее ожидание при ровном графике. */
export const sinceByPlan = (tripsPerHour: number) => (tripsPerHour ? 30 / tripsPerHour : 0)

/** Скорость вагона, если отметка стоит или скорости в ней нет, км/ч: средняя с остановками. */
const TRAM_KMH = 15
/** Дальше этого вагон к остановке уже не относится, км. */
const NEAR_KM = 3

/**
 * Минуты с прохода прошлого вагона по отметкам ГЛОНАСС: из вагонов маршрута, у которых остановка уже позади
 * по курсу, берётся ближайший; минуты — расстояние до него при его скорости. null — рядом таких вагонов нет.
 */
export function sinceByMarks(stop: { lat: number; lon: number }, marks: { lat: number; lon: number; speed: number; course: number }[]): number | null {
  const k = Math.cos((stop.lat * Math.PI) / 180)
  let best: number | null = null
  for (const m of marks) {
    const dx = (stop.lon - m.lon) * 111.32 * k
    const dy = (stop.lat - m.lat) * 110.57
    const km = Math.hypot(dx, dy)
    if (km > NEAR_KM) continue
    const toStop = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
    const diff = Math.abs(((toStop - m.course + 540) % 360) - 180)
    if (diff < 90) continue
    const min = (km / Math.max(m.speed || TRAM_KMH, 5)) * 60
    if (best === null || min < best) best = min
  }
  return best
}
