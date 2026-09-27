import { openYear, PAGES, useAnalytics } from '../components/analytics/AnalyticsView'
import { useSim } from '../simState'
import { useStore, type Horizon, type View } from '../store'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { tripsNeeded, type Ctx } from '../model'
import { accept, pick, pickWindow, setHorizon, setView, toggleMode, toggleView, undoLast } from '../actions'
import type { Screen } from '../screen'

/** Одна цифра без Enter за это время — горизонт; цифры подряд и Enter — маршрут. */
const DIGIT_MS = 900

/** Порядок разделов для [ и ]: как в колонке разделов. */
const SECTIONS: { view: View; horizon: Horizon }[] = [
  { view: 'grid', horizon: 'day' }, { view: 'table', horizon: 'day' }, { view: 'map', horizon: 'day' },
  { view: 'grid', horizon: 'month' }, { view: 'live', horizon: 'day' }, { view: 'sim', horizon: 'day' }, { view: 'stand', horizon: 'day' },
]

/** Отчёты и имитация прокручиваются внутри своего блока, а он не в фокусе: стрелки браузер ему
 *  не отдаёт, поэтому ↑ ↓, PageUp, PageDown, Home и End прокручивают блок отсюда. */
function scrollMain(sel: string, code: string): boolean {
  const el = document.querySelector(sel)
  if (!el) return false
  const page = el.clientHeight * 0.85
  const by: Record<string, number> = { ArrowDown: 64, ArrowUp: -64, PageDown: page, PageUp: -page }
  if (code === 'Home') el.scrollTo({ top: 0 })
  else if (code === 'End') el.scrollTo({ top: el.scrollHeight })
  else if (code in by) el.scrollBy({ top: by[code] })
  else return false
  return true
}

function stepSection(dir: 1 | -1) {
  const st = useStore.getState()
  const i = SECTIONS.findIndex((s) => s.horizon === st.horizon && (st.horizon !== 'day' || s.view === st.view))
  const next = SECTIONS[(Math.max(0, i) + dir + SECTIONS.length) % SECTIONS.length]
  st.set(next)
}

export function useKeys(screen: RefObject<Screen | null>): string {
  const [typed, setTyped] = useState('')
  const latest = useRef(typed)
  latest.current = typed

  useEffect(() => {
    let timer = 0
    const reset = () => { window.clearTimeout(timer); setTyped('') }

    const onKey = (e: KeyboardEvent) => {
      const typed = latest.current
      const sc = screen.current
      const st = useStore.getState()
      const ctx: Ctx | null = st.ds ? { ds: st.ds, s: st.settings, adj: st.adj, model: st.model, sim: st.sim, now: st.now } : null
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.code === 'KeyK') { e.preventDefault(); st.set({ palette: true }); return }
      if (st.palette || st.keys || st.settingsOpen) return
      const el = e.target instanceof Element ? e.target : null
      if (el?.closest('input:not([type="radio"]):not([type="checkbox"]), textarea, select, [contenteditable="true"], [role="slider"]')) return
      if (mod && e.code === 'KeyZ' && st.undo) { e.preventDefault(); undoLast(); return }
      if (mod || e.altKey || !ctx || !sc) return

      if (/^[0-9]$/.test(e.key)) {
        const next = typed + e.key
        setTyped(next)
        window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          if (next === '1') setView('grid')
          else if (next === '2') setHorizon('month')
          else if (next === '3') openYear()
          setTyped('')
        }, DIGIT_MS)
        return
      }
      if (e.key === 'Enter' && typed) {
        e.preventDefault()
        if (sc.days[typed]) { pick(typed, st.hour); st.set({ horizon: 'day' }) } else st.notify(`Маршрута ${typed} нет среди десяти маршрутов задания`)
        reset()
        return
      }
      if (e.key === 'Escape') { reset(); return }
      if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) { e.preventDefault(); st.set({ keys: true }); return }

      // Разделы — везде. Клавиши ловятся по физической клавише (e.code), поэтому одинаково
      // работают на Mac и Windows, в латинской и русской раскладке.
      switch (e.code) {
        case 'BracketLeft': e.preventDefault(); stepSection(-1); return
        case 'BracketRight': e.preventDefault(); stepSection(1); return
        case 'KeyT': e.preventDefault(); toggleView(); return
        case 'KeyM': e.preventDefault(); setView('map'); return
        case 'KeyL': e.preventDefault(); setView('live'); return
        case 'KeyI': e.preventDefault(); setView('sim'); return
        case 'KeyR':
        case 'KeyS': e.preventDefault(); setView('stand'); return
      }
      // Отчёты: стрелки влево-вправо — страницы, вверх-вниз — прокрутка.
      if (st.view === 'stand' && st.horizon === 'day') {
        if (scrollMain('.b-an-main', e.code)) { e.preventDefault(); return }
        if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return
        const a = useAnalytics.getState()
        const i = PAGES.findIndex((p) => p.key === a.page) + (e.code === 'ArrowRight' ? 1 : -1)
        if (PAGES[i]) { a.set(PAGES[i].key); document.querySelector('.b-an-main')?.scrollTo({ top: 0 }) }
        e.preventDefault()
        return
      }
      // Имитация: пробел — пуск и пауза, стрелки влево-вправо — шаг прогона.
      if (st.view === 'sim' && st.horizon === 'day') {
        const sim = useSim.getState()
        if (e.code === 'Space') sim.set({ playing: !sim.playing })
        else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') sim.set({ playing: false, pos: Math.max(0, sim.pos + (e.code === 'ArrowRight' ? 1 : -1)) })
        else if (!scrollMain('.b-sim-v', e.code)) return
        e.preventDefault()
        return
      }

      const ahead = sc.wins.filter((w) => w.to > st.now)
      const cur = ahead.findIndex((w) => w.route === st.route && st.hour >= w.from && st.hour < w.to)
      const routes = ctx.ds.routes.map((r) => r.id)
      switch (e.code) {
        case 'ArrowRight': pick(st.route, st.hour + 1); break
        case 'ArrowLeft': pick(st.route, st.hour - 1); break
        case 'ArrowDown':
        case 'ArrowUp': {
          const j = routes.indexOf(st.route) + (e.code === 'ArrowDown' ? 1 : -1)
          if (routes[j]) pick(routes[j], st.hour)
          break
        }
        case 'KeyJ': if (ahead.length) pickWindow(ahead[(cur + 1) % ahead.length]); break
        case 'KeyK': if (ahead.length) pickWindow(ahead[(cur - 1 + ahead.length) % ahead.length]); break
        case 'KeyA': {
          const w = sc.winAt(st.route, st.hour)
          if (!w || sc.decided(w)) break
          const n = st.extra?.key === w.key ? st.extra.n : tripsNeeded(ctx, w, sc.days[w.route].load)
          accept(w, n)
          break
        }
        case 'KeyE': toggleMode(); break
        default: return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(timer) }
  }, [screen])

  return typed
}
