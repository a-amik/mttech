import { PAGES, useAnalytics, type Page } from '../components/analytics/AnalyticsView'
import { HZ, MODES, useSim } from '../simState'
import { useStore, type View } from '../store'
import type { HzModeKey } from '../data'
import { pathOf, queryFor, screenOf } from './route'

/**
 * Адрес следует за разделом, раздел — за адресом. Любая смена раздела (кнопка, клавиша, палитра,
 * телефонная панель) записывает путь в историю без перезагрузки; «назад» и «вперёд» браузера
 * возвращают раздел. У отчётов в пути ещё и страница (/reports/models), у имитации в запросе —
 * горизонт и режим (/sim?hz=7d&mode_in=events), чтобы ссылка открывала ровно то, что на экране.
 * Старая ссылка вида ?view=sim при старте заменяется путём /sim.
 */

const pageOfPath = (path: string): Page | null => {
  if (path.split('/')[1] === 'year') return 'year'
  const p = path.split('/')[2]
  return PAGES.some((x) => x.key === p) ? (p as Page) : null
}

/** Полный путь раздела: у отчётов — со страницей. */
const fullPath = (view: View, horizon: Parameters<typeof pathOf>[0]['horizon']) =>
  view === 'stand' && horizon === 'day' ? `${pathOf({ view, horizon })}/${useAnalytics.getState().page}` : pathOf({ view, horizon })

/** Запрос имитации: горизонт и режим — из состояния, прочее — как было. */
function simQuery(q: URLSearchParams) {
  const { hz, mode } = useSim.getState()
  if (hz === '1d') q.delete('hz'); else q.set('hz', hz)
  if (mode === 'known') q.delete('mode_in'); else q.set('mode_in', mode)
}

const withQuery = (path: string, q: URLSearchParams) => {
  const s = q.toString()
  return path + (s ? `?${s}` : '') + location.hash
}

export function startRouter() {
  const st = useStore.getState()
  // страница отчётов по пути, если она там есть; ?page= старых ссылок тоже понимается
  const page = pageOfPath(location.pathname)
  if (page) useAnalytics.getState().set(page)
  const q = new URLSearchParams(queryFor(st.view, st.view))
  q.delete('page')
  if (st.view === 'sim') simQuery(q)
  history.replaceState(history.state, '', withQuery(fullPath(st.view, st.horizon), q))

  useStore.subscribe((s, prev) => {
    if (s.view === prev.view && s.horizon === prev.horizon) return
    const here = screenOf(location.pathname)
    if (here?.view === s.view && here?.horizon === s.horizon) return
    const q = new URLSearchParams(queryFor(prev.view, s.view))
    if (s.view === 'sim' && s.horizon === 'day') simQuery(q)
    history.pushState(null, '', withQuery(fullPath(s.view, s.horizon), q))
  })

  // Страница отчётов — отдельная запись истории: «назад» возвращает прошлую страницу.
  useAnalytics.subscribe((a, prev) => {
    const s = useStore.getState()
    if (a.page === prev.page || s.view !== 'stand' || pageOfPath(location.pathname) === a.page) return
    history.pushState(null, '', withQuery(fullPath('stand', 'day'), new URLSearchParams(location.search)))
  })

  // Горизонт и режим имитации — в запросе без новой записи истории: переключатель, а не переход.
  useSim.subscribe((m, prev) => {
    if ((m.hz === prev.hz && m.mode === prev.mode) || useStore.getState().view !== 'sim') return
    const q = new URLSearchParams(location.search)
    simQuery(q)
    history.replaceState(history.state, '', withQuery(location.pathname, q))
  })

  window.addEventListener('popstate', () => {
    const screen = screenOf(location.pathname)
    if (!screen) return
    const cur = useStore.getState()
    if (screen.view === 'stand') {
      const p = pageOfPath(location.pathname)
      if (p && p !== useAnalytics.getState().page) useAnalytics.getState().set(p)
    }
    if (screen.view === 'sim') {
      const q = new URLSearchParams(location.search)
      const hz = HZ.some((h) => h.key === q.get('hz')) ? q.get('hz')! : '1d'
      const mode = MODES.some((m) => m.key === q.get('mode_in')) ? (q.get('mode_in') as HzModeKey) : 'known'
      const sim = useSim.getState()
      if (sim.hz !== hz || sim.mode !== mode) sim.set({ hz, mode, pos: 0, playing: false })
    }
    if (cur.view !== screen.view || cur.horizon !== screen.horizon) cur.set(screen)
  })
}
