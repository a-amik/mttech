import { useStore } from '../store'
import { useMemo, useState } from 'react'
import { Modal, TextInput } from '@gravity-ui/uikit'
import { num } from '../data'
import type { Ctx } from '../model'
import { IconSearch } from '../lib/icons'
import { pick, pickWindow, setHorizon, setView, span, toggleMode, toggleView } from '../actions'
import { exportForecast } from '../files'
import { openYear } from './analytics/AnalyticsView'
import type { Screen } from '../screen'
import { Key } from './Bits'

interface Cmd { kind: string; title: string; note?: string; run: () => void }

/** Строка команд ⌘K: маршрут, окно, шаблон, выгрузка — редкое за одной строкой. */
export function Palette({ ctx, sc, onUpload, onExport }: { ctx: Ctx; sc: Screen; onUpload: () => void; onExport: () => void }) {
  const { palette, set, now } = useStore()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const close = () => { set({ palette: false }); setQ(''); setAt(0) }

  const all = useMemo<Cmd[]>(() => {
    const st = useStore.getState()
    const out: Cmd[] = []
    for (const w of sc.wins.filter((x) => x.to > now)) out.push({ kind: 'окно', title: `${w.route} · ${span(w)} · ${num(w.peak)} %`, note: `приоритет ${w.prio}`, run: () => pickWindow(w) })
    for (const r of ctx.ds.routes) out.push({ kind: 'маршрут', title: `${r.id} ${r.stops.length ? r.name : ''}`.trim(), note: sc.days[r.id].total ? `пик ${num(sc.days[r.id].peakLoad)} %` : 'не работает', run: () => pick(r.id, st.hour) })
    out.push(
      { kind: 'вид', title: 'День', note: '1', run: () => setHorizon('day') },
      { kind: 'вид', title: 'Месяц', note: '2', run: () => setHorizon('month') },
      { kind: 'вид', title: 'Год', note: '3', run: openYear },
      { kind: 'вид', title: 'Окна риска / вся сеть', note: 'E', run: toggleMode },
      { kind: 'вид', title: 'Сетка / таблица окон', note: 'T', run: toggleView },
      { kind: 'стенд', title: 'Настройки расчёта', run: () => st.set({ settingsOpen: true }) },
      { kind: 'раздел', title: 'Отчёты: решение, экран, модели, нагрузка, год', run: () => setView('stand') },
      { kind: 'раздел', title: 'Имитация: прогон четырёх моделей', run: () => setView('sim') },
      { kind: 'раздел', title: 'Живой день', note: 'L', run: () => setView('live') },
      { kind: 'справка', title: 'Клавиши', note: '?', run: () => st.set({ keys: true }) },
      { kind: 'файл', title: 'Выгрузить прогноз дня, CSV', run: onExport },
      { kind: 'файл', title: 'Выгрузить прогноз дня, XLSX', run: () => exportForecast(ctx, useStore.getState().day, 'xlsx') },
      { kind: 'файл', title: 'Загрузить CSV валидаций', run: onUpload },
      { kind: 'стенд', title: st.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема', run: st.toggleTheme },
    )
    // Площадка выпуска — фильтр для разбора по депо; в работе смены диспетчер идёт по маршрутам.
    const depots = Object.entries(ctx.ds.depots ?? {})
    const places = [...new Set(depots.map(([, v]) => v[0]?.[0]).filter(Boolean))].sort() as string[]
    if (places.length > 1) {
      for (const p of places) {
        const routes = depots.filter(([, v]) => v[0]?.[0] === p).map(([r]) => r).sort((a, b) => Number(a) - Number(b))
        out.push({ kind: 'площадка', title: `Площадка ${p}`, note: `маршруты ${routes.join(', ')}`, run: () => st.set({ place: p }) })
      }
      out.push({ kind: 'площадка', title: 'Все площадки', run: () => st.set({ place: '' }) })
    }
    return out
  }, [ctx, sc, now, onUpload, onExport])

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const found = all.filter((c) => words.every((wd) => `${c.kind} ${c.title} ${c.note ?? ''}`.toLowerCase().includes(wd))).slice(0, 9)
  const cur = Math.min(at, Math.max(0, found.length - 1))
  const run = (c?: Cmd) => { if (!c) return; close(); c.run() }

  return (
    <Modal open={palette} onOpenChange={(o) => !o && close()} contentClassName="b-box b-pal" aria-label="Команда или поиск">
      <TextInput size="xl" view="clear" autoFocus value={q} placeholder="Маршрут, окно, шаблон, команда" startContent={<span className="b-pal-i"><IconSearch /></span>}
        onUpdate={(v) => { setQ(v); setAt(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt((cur + 1) % Math.max(1, found.length)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setAt((cur - 1 + found.length) % Math.max(1, found.length)) }
          if (e.key === 'Enter') { e.preventDefault(); run(found[cur]) }
        }} />
      <ul role="listbox">
        {found.map((c, i) => (
          <li key={`${c.kind}-${c.title}`} role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''}
            onMouseEnter={() => setAt(i)} onClick={() => run(c)}>
            <span className="k">{c.kind}</span><span className="t">{c.title}</span><small>{c.note}</small>
          </li>
        ))}
        {found.length ? null : <li className="none">Ничего не нашлось</li>}
      </ul>
    </Modal>
  )
}

const KEYS: [string[], string][] = [
  [['1', '7', 'enter'], 'открыть маршрут: номер и Enter'],
  [['arrowleft', 'arrowright'], 'час назад, вперёд'],
  [['j', 'k'], 'следующее, предыдущее окно риска'],
  [['arrowup', 'arrowdown'], 'соседний маршрут'],
  [['a'], 'принять рекомендацию'],
  [['mod+z'], 'отменить последнее'],
  [['e'], 'окна риска / вся сеть'],
  [['[', ']'], 'предыдущий, следующий раздел'],
  [['1', '2', '3'], 'сетка, месяц, год (одна цифра)'],
  [['t'], 'сетка / таблица'],
  [['m'], 'карта'],
  [['l'], 'живой день'],
  [['i'], 'имитация: пробел — пуск, стрелки — шаг'],
  [['r'], 'отчёты: ← → — страницы, ↑ ↓ — прокрутка'],
  [['mod+k'], 'команда или поиск'],
  [['shift+/'], 'эта подсказка'],
  [['escape'], 'закрыть'],
]

export function KeysHelp() {
  const { keys, set } = useStore()
  return (
    <Modal open={keys} onOpenChange={(o) => !o && set({ keys: false })} contentClassName="b-box b-keys-box" aria-label="Клавиши">
      <h3>Клавиши</h3>
      <div className="b-keys-grid">
        {KEYS.map(([ks, text]) => (
          <div key={text}><span>{ks.map((k) => <Key key={k} k={k} />)}</span><span>{text}</span></div>
        ))}
      </div>
    </Modal>
  )
}

export function UndoToast() {
  const undo = useStore((s) => s.undo)
  if (!undo) return null
  return (
    <div className="b-undo" role="status" key={undo.id}>
      <span>{undo.text}</span>
      <span className="tm"><i /></span>
      <button type="button" onClick={() => { undo.revert(); useStore.getState().set({ undo: null }) }}>Отменить</button>
      <Key k="mod+z" />
    </div>
  )
}
