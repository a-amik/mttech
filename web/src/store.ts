import { create } from 'zustand'
import { DAYS, idxOf, type Dataset } from './data'
import { ADJUST_DEFAULT, type Adjust, type Ctx, type SimDay } from './model'
import { DEFAULTS, type Settings } from './settings'
import { startScreen } from './lib/route'

export type Horizon = 'day' | 'month' | 'year'
export type Theme = 'light' | 'dark'
export type Mode = 'exc' | 'all'
/** Вид главной области: сетка, таблица окон, карта, живой день, стенд. Месяц и год — горизонты. */
export type View = 'grid' | 'table' | 'map' | 'live' | 'stand' | 'sim'
export type Detail = 'scheme' | 'map'
export type Template = 'holiday' | 'rain' | 'snow' | 'closure' | 'event'

export interface Decision { day: number; route: string; from: number; to: number; trips: number }
export interface Undo { id: number; text: string; revert: () => void }

/** Сколько живёт отмена: несколько секунд вместо вопроса «Вы уверены?». */
export const UNDO_MS = 8000

const SAVED = 'tramflow.settings'
const THEME_KEY = 'tramflow.scheme'
const TEMPLATES: Template[] = ['holiday', 'rain', 'snow', 'closure', 'event']
// Состояние для снимков и ссылок задаётся адресом: раздел — путём (/table, /sim, /reports), остальное —
// параметрами: ?mode=all, ?detail=map,
// ?palette=1, ?keys=1, ?tpl=closure, ?sel=17-15, ?now=9, ?day=2025-10-14, ?theme=dark, ?off=4,46.
const P = new URLSearchParams(location.search)

function savedSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SAVED) ?? '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

function startTheme(): Theme {
  const q = P.get('theme')
  if (q === 'light' || q === 'dark') return q
  try {
    const own = localStorage.getItem(THEME_KEY)
    if (own === 'light' || own === 'dark') return own
  } catch { /* приватное окно */ }
  // Диспетчерская — тёмная подложка по рекомендации экспертов; светлая — в настройках.
  return 'dark'
}

// Раздел — по пути адреса (/table, /sim, /reports…), старые ссылки ?view= тоже понимаются.
const screen0 = startScreen()
const sel = P.get('sel')?.match(/^(\d+)-(\d+)$/)
// ?day=2025-10-14 — день по ссылке; вне окна экрана — день по умолчанию.
const dayParam = P.get('day')?.match(/^\d{4}-\d{2}-\d{2}$/) ? idxOf(P.get('day')!) : NaN
const dayStart = dayParam >= 0 && dayParam < DAYS ? dayParam : idxOf('2025-11-11')

interface State {
  ds: Dataset | null
  theme: Theme
  horizon: Horizon
  day: number
  hour: number
  route: string
  settings: Settings
  adj: Adjust
  model: string
  sim: SimDay | null
  settingsOpen: boolean
  toast: string | null
  // Экран дня
  mode: Mode
  view: View
  detail: Detail
  /** Час смены: всё раньше — прошло, окна риска считаются с него. */
  now: number
  decisions: Record<string, Decision>
  snoozed: Record<string, true>
  /** Рейсы, выставленные вручную в карточке, пока окно не принято. */
  extra: { key: string; n: number } | null
  template: Template | null
  openGroups: Record<string, boolean>
  palette: boolean
  keys: boolean
  /** Нижняя строка чисел: по кнопке в колонке разделов, а не постоянно. */
  /** Маршруты, снятые с карты флажком в панели; пусто — на карте все. */
  mapHidden: string[]
  /** Свёрнутые секции боковой панели. */
  folded: Record<string, boolean>
  /** Площадка из шапки: пусто — все маршруты. */
  place: string
  /** Карточка выбранного окна или маршрута свёрнута повторным нажатием. */
  cardShut: boolean
  /** Где раскрыта карточка: под окном риска или под маршрутом; null — где найдётся. */
  cardIn: 'wins' | 'routes' | null
  /** Боковая панель открыта; закрытая отдаёт место главной области. */
  sideOpen: boolean
  undo: Undo | null
  setDs: (ds: Dataset) => void
  set: (patch: Partial<State>) => void
  setSettings: (s: Settings) => void
  setAdj: (patch: Partial<Adjust>) => void
  toggleTheme: () => void
  notify: (text: string) => void
  offerUndo: (text: string, revert: () => void) => void
}

export const decisionKey = (day: number, windowKey: string) => `${day}:${windowKey}`

/** Тема ставится на документ сразу: слои карты берут цвета токенов в момент создания. */
function applyTheme(t: Theme): Theme {
  document.documentElement.dataset.theme = t
  return t
}

export const useStore = create<State>((set, get) => ({
  ds: null,
  theme: applyTheme(startTheme()),
  horizon: screen0.horizon,
  day: dayStart,
  hour: sel ? Number(sel[2]) : 8,
  route: sel ? sel[1] : '17',
  settings: savedSettings(),
  adj: P.get('off') ? { ...ADJUST_DEFAULT, off: P.get('off')!.split(',') } : ADJUST_DEFAULT,
  model: '',
  sim: null,
  settingsOpen: false,
  toast: null,
  mode: P.get('mode') === 'all' ? 'all' : 'exc',
  view: screen0.view,
  detail: P.get('detail') === 'map' ? 'map' : 'scheme',
  now: Math.max(5, Math.min(23, Number(P.get('now') ?? 7))),
  decisions: {},
  snoozed: {},
  extra: null,
  template: TEMPLATES.includes(P.get('tpl') as Template) ? (P.get('tpl') as Template) : null,
  openGroups: {},
  palette: P.has('palette'),
  keys: P.has('keys'),
  mapHidden: P.get('maphidden')?.split(',') ?? [],
  folded: {},
  place: '',
  cardShut: false,
  cardIn: null,
  sideOpen: true,
  undo: null,
  setDs: (ds) => set({ ds, model: ds.models.main }),
  set: (patch) => set(patch),
  setSettings: (settings) => {
    try {
      const own = Object.fromEntries(Object.entries(settings).filter(([k, v]) => DEFAULTS[k] !== v))
      localStorage.setItem(SAVED, JSON.stringify(own))
    } catch { /* без памяти тоже работает */ }
    set({ settings })
  },
  setAdj: (patch) => set({ adj: { ...get().adj, ...patch } }),
  toggleTheme: () => {
    const theme = get().theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* ничего */ }
    // атрибут — до перерисовки: карта при смене темы читает цвета токенов, и они должны быть уже новыми
    document.documentElement.dataset.theme = theme
    set({ theme })
  },
  notify: (text) => {
    set({ toast: text })
    window.setTimeout(() => get().toast === text && set({ toast: null }), 4000)
  },
  offerUndo: (text, revert) => {
    const id = (get().undo?.id ?? 0) + 1
    set({ undo: { id, text, revert } })
    window.setTimeout(() => get().undo?.id === id && set({ undo: null }), UNDO_MS)
  },
}))

export function useCtx(): Ctx | null {
  const ds = useStore((s) => s.ds)
  const settings = useStore((s) => s.settings)
  const adj = useStore((s) => s.adj)
  const model = useStore((s) => s.model)
  const sim = useStore((s) => s.sim)
  const now = useStore((s) => s.now)
  return ds ? { ds, s: settings, adj, model, sim, now } : null
}
