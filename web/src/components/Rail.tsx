import { useStore, type View } from '../store'
import { setHorizon, setView } from '../actions'
import { IconCalendar, IconGrid, IconMap, IconPlay, IconFlask, IconReport, IconTable } from '../lib/icons'

type Section = View | 'month' | 'year'
type Item = { key: Section; label: string; icon: React.ReactNode; hot?: string }

const MAIN: Item[] = [
  { key: 'grid', label: 'Сетка', icon: <IconGrid />, hot: '1' },
  { key: 'table', label: 'Таблица', icon: <IconTable />, hot: 'T' },
  { key: 'map', label: 'Карта', icon: <IconMap />, hot: 'M' },
  { key: 'month', label: 'Месяц', icon: <IconCalendar />, hot: '2' },
]

// Внизу — то, что не про решение смены: день по вагонам, прогон моделей, отчёт о них.
const LOWER: Item[] = [
  { key: 'live', label: 'Живой день', icon: <IconPlay />, hot: 'L' },
  { key: 'sim', label: 'Имитация', icon: <IconFlask /> },
  { key: 'stand', label: 'Отчёты', icon: <IconReport /> },
]

/** Разделы экрана диспетчера — узкой колонкой слева, как у Optibus. Настройки, год и файлы — в меню «…» шапки. */
export default function Rail() {
  const { horizon, view } = useStore()
  const active = horizon === 'day' ? view : horizon
  const go = (k: Section) => (k === 'month' || k === 'year' ? setHorizon(k) : setView(k))
  const btn = (i: Item) => (
    <button key={i.key} type="button" className={`b-rail-i${active === i.key ? ' on' : ''}`} aria-current={active === i.key ? 'page' : undefined}
      title={i.hot ? `${i.label} · ${i.hot}` : i.label} onClick={() => go(i.key)}>
      {i.icon}<span>{i.label}</span>
    </button>
  )

  return (
    <nav className="b-rail" aria-label="Разделы">
      {MAIN.map(btn)}
      <span className="sp" />
      {LOWER.map(btn)}
    </nav>
  )
}
