import { useStore, type Horizon, type View, decisionKey } from './store'
import { DAYS, hh } from './data'
import type { RiskWindow } from './model'

// Действия диспетчера: одни и те же для кнопки, клавиши и строки команд.

export const plural = (n: number, one: string, few: string, many: string) => {
  const m = n % 10
  const t = n % 100
  return m === 1 && t !== 11 ? one : m >= 2 && m <= 4 && (t < 12 || t > 14) ? few : many
}
export const trips = (n: number) => `${n} ${plural(n, 'рейс', 'рейса', 'рейсов')}`
export const wins = (n: number) => `${n} ${plural(n, 'окно', 'окна', 'окон')}`
export const onRoutes = (n: number) => `${n} ${plural(n, 'маршруте', 'маршрутах', 'маршрутах')}`
export const span = (w: { from: number; to: number }) => `${hh(w.from)}—${hh(w.to)}`

function without<T>(o: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...o }
  delete copy[key]
  return copy
}

export function pick(route: string, hour: number, cardIn: 'wins' | 'routes' | null = null) {
  useStore.getState().set({ route, hour: Math.max(0, Math.min(23, hour)), cardShut: false, cardIn })
  useStore.getState().set({ extra: null })
}

export const pickWindow = (w: RiskWindow) => pick(w.route, w.peakHour)

export function accept(w: RiskWindow, n: number) {
  if (n <= 0) return
  const day = useStore.getState().day
  const key = decisionKey(day, w.key)
  const st = useStore.getState()
  const prev = st.decisions[key]
  st.set({ decisions: { ...st.decisions, [key]: { day, route: w.route, from: w.from, to: w.to, trips: n } }, snoozed: without(st.snoozed, key), extra: null })
  st.offerUndo(`Принято: +${trips(n)} в час, маршрут ${w.route}, ${span(w)}`, () => {
    const rest = without(useStore.getState().decisions, key)
    useStore.getState().set({ decisions: prev ? { ...rest, [key]: prev } : rest })
  })
}

export function revoke(w: RiskWindow) {
  const key = decisionKey(useStore.getState().day, w.key)
  const st = useStore.getState()
  const prev = st.decisions[key]
  if (!prev) return
  st.set({ decisions: without(st.decisions, key) })
  st.offerUndo(`Решение снято: маршрут ${w.route}, ${span(w)}`, () =>
    useStore.getState().set({ decisions: { ...useStore.getState().decisions, [key]: prev } }))
}

export function snooze(w: RiskWindow) {
  const key = decisionKey(useStore.getState().day, w.key)
  const st = useStore.getState()
  st.set({ snoozed: { ...st.snoozed, [key]: true } })
  st.offerUndo(`Отложено: маршрут ${w.route}, ${span(w)}`, () =>
    useStore.getState().set({ snoozed: without(useStore.getState().snoozed, key) }))
}

export function undoLast() {
  const u = useStore.getState().undo
  if (!u) return
  u.revert()
  useStore.getState().set({ undo: null })
}

export const setHorizon = (horizon: Horizon) => useStore.getState().set({ horizon })

export function moveDay(step: number) {
  const st = useStore.getState()
  st.set({ day: Math.max(0, Math.min(DAYS - 1, st.day + step)), sim: null })
  useStore.getState().set({ extra: null })
}

export const toggleMode = () => useStore.getState().set({ mode: useStore.getState().mode === 'exc' ? 'all' : 'exc' })
export const setView = (view: View) => useStore.getState().set({ horizon: 'day', view })
export const toggleView = () => setView(useStore.getState().view === 'table' ? 'grid' : 'table')
