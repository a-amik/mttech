import type { Horizon, View } from '../store'

// Раздел экрана ↔ путь адреса. Те же пути сервис отдаёт как index.html (api/…/ScreenRoutes.java),
// поэтому прямая ссылка и перезагрузка открывают тот же раздел, что и кнопка.
const VIEW_PATH: Record<View, string> = {
  grid: '/',
  table: '/table',
  map: '/map',
  live: '/live',
  sim: '/sim',
  stand: '/reports',
}
const HORIZON_PATH: Partial<Record<Horizon, string>> = { month: '/month' }

/** Параметры адреса, которые относятся к одному разделу: уходя из него, их не тащат дальше. */
const OWN_PARAMS: Partial<Record<View, string[]>> = { sim: ['hz', 'mode_in', 'pos', 'play'], stand: ['page'] }

export interface Screen { view: View; horizon: Horizon }

export const pathOf = ({ view, horizon }: Screen): string => HORIZON_PATH[horizon] ?? VIEW_PATH[view]

/** Раздел по пути; для неизвестного пути — null. Вложенный путь (/reports/models) — раздел по первой части. */
export function screenOf(path: string): Screen | null {
  const top = '/' + (path.split('/')[1] ?? '')
  // Год живёт страницей отчётов; старый адрес /year ведёт туда же.
  if (top === '/year') return { view: 'stand', horizon: 'day' }
  const horizon = (Object.keys(HORIZON_PATH) as Horizon[]).find((h) => HORIZON_PATH[h] === top)
  if (horizon) return { view: 'grid', horizon }
  const view = (Object.keys(VIEW_PATH) as View[]).find((v) => VIEW_PATH[v] === top)
  return view ? { view, horizon: 'day' } : null
}

/** Раздел, с которого экран стартует: по пути, а для старых ссылок — по ?view=. */
export function startScreen(): Screen {
  const byPath = screenOf(location.pathname)
  if (byPath && location.pathname !== '/') return byPath
  const legacy = new URLSearchParams(location.search).get('view')
  return (Object.keys(VIEW_PATH) as View[]).includes(legacy as View) ? { view: legacy as View, horizon: 'day' } : { view: 'grid', horizon: 'day' }
}

/** Строка запроса для перехода в раздел: без ?view= и без параметров покинутого раздела. */
export function queryFor(from: View, to: View): string {
  const q = new URLSearchParams(location.search)
  q.delete('view')
  if (from !== to) OWN_PARAMS[from]?.forEach((k) => q.delete(k))
  const s = q.toString()
  return s ? `?${s}` : ''
}
