export interface Stop { id: string; name: string; lat: number; lon: number }
export interface Route { id: string; name: string; since: string | null; stops: Stop[]; source: 'org' | 'mos' | null }
/** Трамвайный маршрут Москвы вне задания: трасса из OSM и доли общих остановок с маршрутами задания. */
export interface NetRoute { id: string; name: string; stops: number; overlap: Record<string, number>; lines: number[][][] }
export interface Network {
  source: string
  near_m: number
  routes: NetRoute[]
  /** Путь вагона по остановкам направления «туда» — для живого показа. */
  task: Record<string, number[][]>
  /** Трассы маршрутов задания из OSM, как есть. */
  tracks: Record<string, number[][][]>
}

/** Вагон за сутки по сырым валидациям: GPS в наборе нет, есть бортовой номер и время валидаций. */
export interface Tram { board: string; exit: string | null; place: string | null; hours: number[]; first: number; last: number }
export type LiveDay = Record<string, Tram[]>

const liveCache = new Map<string, Promise<LiveDay | null>>()
export function loadLiveDay(iso: string): Promise<LiveDay | null> {
  if (!liveCache.has(iso)) liveCache.set(iso, fetch(`/data/live/${iso}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null))
  return liveCache.get(iso)!
}
/** Внешние признаки дня из data/external/features_daily_2025.csv (build_features.py). */
export interface DayFactors { ice_rain: number; snow_event: number; center_closure: number; football_rzd: number; rain_mm: number; snow_cm: number }
/** Плановые рейсы из архива расписания transport.mos.ru и вагоны на линии по валидациям (schedule_data.py). */
export interface Schedule {
  source: string
  /** С этой даты расписание взято на дату; раньше — типовое расписание октября по типу дня. */
  from: string
  weekend_factor: number
  /** Маршрут → дата → рейсов в час в каждую сторону. */
  trips: Record<string, Record<string, number[]>>
  typical: Record<string, Record<'w' | 'sat' | 'sun', number[]>>
  /** Маршрут → дата → [вагонов с валидациями, плановых рейсов за день, обычно вагонов при таком плане]. */
  fleet: Record<string, Record<string, [number, number, number]>>
}
type Matrix = number[][]
type ByRoute<T> = Record<string, T>

export interface LogItem {
  name: string
  note: string
  backtest: { oct: number; jun: number }
  score: number | null
  comment?: string
}

export interface CompareItem {
  key: string
  title: string
  note: string
  oct: number
  oct_weekday: number
  oct_weekend: number
  bias_pct: number
}

export interface Dataset {
  routes: Route[]
  series: { start: string; fact: ByRoute<Matrix>; backtest: ByRoute<Matrix>; band: ByRoute<{ lo: Matrix; hi: Matrix }> }
  models: { main: string; log: LogItem[]; compare: CompareItem[]; nd: Record<string, ByRoute<Matrix>>; oct: Record<string, ByRoute<Matrix>> }
  history: { start: string; daily: ByRoute<number[]> }
  context: { calendar: Record<string, number>; weather: Record<string, [number, number, number]> }
  network: Network | null
  factors: Record<string, DayFactors> | null
  /** Площадки выпуска: маршрут → [код площадки, число валидаций], по убыванию. */
  depots: Record<string, [string, number][]> | null
  schedule: Schedule | null
  /** Доли посадок по остановкам (tramflow.stops): только маршруты с определённым направлением рейсов. */
  stops: StopsData | null
}

/** Маршрут → имена остановок двух направлений и доли [час][направление][остановка] по типу дня. */
export interface StopsData {
  routes: Record<string, { confidence: string; names: [string[], string[]]; shares: Record<'weekday' | 'weekend', number[][][]> }>
  days: Record<string, 'weekday' | 'weekend'>
}

export async function loadDataset(): Promise<Dataset> {
  const get = (name: string) => fetch(`/data/${name}.json`).then((r) => {
    if (!r.ok) throw new Error(`${name}.json: ${r.status}`)
    return r.json()
  })
  const [routes, series, models, history, context] = await Promise.all(
    ['routes', 'series', 'models', 'history', 'context'].map(get),
  )
  // Сеть вне задания — только для карты и стенда: без неё экран работает как прежде.
  const network = await get('network').catch(() => null)
  const factors = await get('factors').catch(() => null)
  const depots = await get('depots').catch(() => null)
  // Без расписания рейсы считаются по интервалам из настроек, как раньше.
  const schedule = await get('schedule').catch(() => null)
  // Без долей остановок схема линии показывает только остановки, как раньше.
  const stops = await get('stops').catch(() => null)
  return { routes, series, models, history, context, network, factors, depots, schedule, stops }
}

// Окно экрана: сентябрь—октябрь с фактом и ноябрь—декабрь прогнозом.
export const START = '2025-09-01'
export const DAYS = 122
export const FACT_DAYS = 61

const MS = 86_400_000
export const isoOf = (idx: number) => new Date(Date.parse(START) + idx * MS).toISOString().slice(0, 10)
export const idxOf = (iso: string) => Math.round((Date.parse(iso) - Date.parse(START)) / MS)
export const dowOf = (idx: number) => (new Date(Date.parse(START) + idx * MS).getUTCDay() + 6) % 7

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const DOW = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']
export const DOW_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

/** Дата вне окна прогноза: «12 апреля». */
export function ruDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

export function ruDay(idx: number, withDow = true): string {
  const [, m, d] = isoOf(idx).split('-').map(Number)
  return `${withDow ? DOW[dowOf(idx)] + ', ' : ''}${d} ${MONTHS[m - 1]}`
}

export const hh = (h: number) => `${String(h).padStart(2, '0')}:00`

export function num(value: number, digits = 0): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function thousands(value: number): string {
  return value >= 10_000 ? `${num(value / 1000, 0)} тыс.` : value >= 1000 ? `${num(value / 1000, 1)} тыс.` : num(value)
}

export const wapeScore = (y: number[], p: number[]) => {
  let err = 0
  let sum = 0
  y.forEach((v, i) => {
    err += Math.abs(v - p[i])
    sum += v
  })
  return sum ? Math.max(0, 1 - err / sum) : 0
}

/** Три модели на одинаковых входах: счёт по горизонтам и прогон для имитации (tramflow.horizons). */
export type ModelKey = 'reg' | 'stat' | 'ml' | 'hyb'
export type HzScore = Record<ModelKey, number>
export interface HzSplit { event: HzScore; plain: HzScore; event_share: number }
export interface HzRow { all: HzScore; n: number; split?: HzSplit; months?: Record<string, HzScore>; windows?: Record<string, HzScore> }
export interface HzReplay extends Record<ModelKey, number[][]> {
  dates: [string, string][]
  fact: number[][]
  err: Record<ModelKey, number[][]>
  sum: number[][]
}
/** Кривая обучения синтетического режима: вид события → повторы («1—3», «4—10», «11+») → ошибка моделей, доля от факта. */
export type HzCurve = Record<string, Record<string, HzScore>>
export interface HzMode { table: Record<string, HzRow>; replay: Record<string, HzReplay>; curve?: Record<string, HzCurve> }
export type HzModeKey = 'known' | 'weather' | 'events' | 'synthetic'
export interface Horizons { routes: string[]; known: HzMode; weather: HzMode; events?: HzMode; synthetic?: HzMode }

let horizonsCache: Promise<Horizons | null> | null = null
export const loadHorizons = () =>
  (horizonsCache ??= fetch('/data/horizons.json').then((r) => (r.ok ? r.json() : null)).catch(() => null))
