import { create } from 'zustand'
import { Select } from '@gravity-ui/uikit'
import type { Ctx } from '../../model'
import { usePhone } from '../../lib/media'
import { useHorizons } from '../../simState'
import { useStore } from '../../store'
import SolutionPage from './SolutionPage'
import UiPage from './UiPage'
import ModelsPage from './ModelsPage'
import YearPage from './YearPage'
import OpsPage from './OpsPage'

// «Отчёты»: пять страниц. Слева — колонка навигации, как боковая панель у сетки:
// страницы и главы открытой страницы; справа — сама страница.

export type Page = 'solution' | 'ui' | 'models' | 'ops' | 'year'

export const PAGES: { key: Page; title: string; sub: string; chapters: [string, string][] }[] = [
  { key: 'solution', title: 'Как устроено решение', sub: 'цепочка, модель, точность, сервис', chapters: [['s-chain', 'Цепочка'], ['s-model', 'Форма × уровень'], ['s-growth', 'Как росла точность'], ['s-limit', 'Предел точности'], ['s-service', 'Сервис под нагрузкой']] },
  { key: 'ui', title: 'Как проектировали экран', sub: 'принципы, цвет, решения', chapters: [['u-why', 'Принципы'], ['u-speed', 'Скорость решения'], ['u-color', 'Цвет и шкала'], ['u-dec', 'Одиннадцать решений'], ['u-ref', 'На что опирались']] },
  { key: 'models', title: 'Четыре модели', sub: 'регрессия, статистика, ML, гибрид', chapters: [['m-abs', 'Коротко'], ['m-proto', 'Входы и протокол'], ['m-hz', 'Точность по горизонтам'], ['m-hyb', 'Гибрид вне подбора'], ['m-modes', 'Погода и события'], ['m-syn', 'Синтетика'], ['m-oct', 'Октябрь'], ['m-end', 'Выводы']] },
  { key: 'ops', title: 'Нагрузка и безопасность', sub: 'ступени, отказы, поток, атаки', chapters: [['o-steps', 'Пропускная способность'], ['o-live', 'Живой поток'], ['o-breaks', 'Поломки данных'], ['o-sec', 'Безопасность'], ['o-next', 'Для пилота']] },
  { key: 'year', title: 'Год', sub: 'что можно сказать на год вперёд', chapters: [['y-decay', 'Точность стареет'], ['y-base', 'Базовая кривая 2026'], ['y-events', 'События года'], ['y-use', 'Как пользоваться']] },
]

const P = new URLSearchParams(location.search)
export const useAnalytics = create<{ page: Page; set: (page: Page) => void }>((set) => ({
  page: PAGES.some((p) => p.key === P.get('page')) ? (P.get('page') as Page) : 'solution',
  set: (page) => set({ page }),
}))

/** Открыть страницу «Год»: годовой горизонт живёт в аналитике. */
export const openYear = () => { useAnalytics.getState().set('year'); useStore.getState().set({ horizon: 'day', view: 'stand' }) }

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

export function AnalyticsSide() {
  const { page, set } = useAnalytics()
  return (
    <aside className="b-side b-an-side" aria-label="Страницы отчётов">
      <div className="b-an-side-h">
        <h2>Отчёты</h2>
        <p>Отчёт о решении: как оно устроено, как проектировали экран, какую точность дают модели, как сервис держит нагрузку.</p>
      </div>
      <nav>
        {PAGES.map((p, i) => (
          <div key={p.key} className={`b-an-page${page === p.key ? ' on' : ''}`}>
            <button type="button" onClick={() => { set(p.key); document.querySelector('.b-an-main')?.scrollTo({ top: 0 }) }} aria-current={page === p.key ? 'page' : undefined}>
              <span className="n">{i + 1}</span>
              <span><b>{p.title}</b><small>{p.sub}</small></span>
            </button>
            {page === p.key ? (
              <ul>
                {p.chapters.map(([id, label]) => <li key={id}><button type="button" onClick={() => jump(id)}>{label}</button></li>)}
              </ul>
            ) : null}
          </div>
        ))}
      </nav>
    </aside>
  )
}

export function AnalyticsMain({ ctx }: { ctx: Ctx }) {
  const { page, set } = useAnalytics()
  const phone = usePhone()
  const data = useHorizons()
  return (
    <main className="b-main b-an-main">
      {phone ? (
        <div className="b-an-phone-nav">
          <Select size="l" width="max" value={[page]} onUpdate={([v]) => set(v as Page)}
            options={PAGES.map((p, i) => ({ value: p.key, content: `${i + 1}. ${p.title}` }))} />
        </div>
      ) : null}
      <div className="b-an-page-body">
        {page === 'solution' ? <SolutionPage ctx={ctx} />
          : page === 'ui' ? <UiPage />
            : page === 'ops' ? <OpsPage />
            : data === undefined ? <p className="b-muted">Загружаю прогон моделей…</p>
              : data === null ? <p className="b-muted">Нет файла прогона: соберите его командой <code>python -m tramflow.horizons</code>.</p>
                : page === 'models' ? <ModelsPage ctx={ctx} data={data} /> : <YearPage ctx={ctx} data={data} />}
      </div>
    </main>
  )
}
