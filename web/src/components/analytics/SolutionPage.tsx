import { DOW_SHORT, FACT_DAYS, dowOf, num, thousands } from '../../data'
import type { Ctx } from '../../model'
import { Bars, Figure, LineChart, Tiles } from './charts'
import { CEILING, FINAL, LOAD } from './facts'
import { ArtSolution, IconDecay, IconGauge, IconLayers, IconMedian, IconTarget } from './art'

const ROUTE = '17'
const OCT0 = 30

/** Форма часа × уровень дня на живых числах октября: как из двух простых частей получается прогноз дня. */
function FormLevel({ ctx }: { ctx: Ctx }) {
  const fact = ctx.ds.series.fact[ROUTE]
  if (!fact) return null
  const oct = Array.from({ length: FACT_DAYS - OCT0 }, (_, i) => OCT0 + i)
  // форма — средняя доля часа по будням понедельник—четверг октября
  const wk = oct.filter((d) => dowOf(d) < 4 && fact[d].some((v) => v > 0))
  const shape = Array.from({ length: 24 }, (_, h) => wk.reduce((a, d) => a + fact[d][h] / Math.max(1, fact[d].reduce((x, y) => x + y, 0)), 0) / Math.max(1, wk.length))
  // уровень — медиана суммы дня по дню недели
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }
  const level = Array.from({ length: 7 }, (_, w) => med(oct.filter((d) => dowOf(d) === w).map((d) => fact[d].reduce((x, y) => x + y, 0))))
  const tue = oct.find((d) => dowOf(d) === 1 && d > OCT0 + 7) ?? oct[1]
  const fc = shape.map((s) => s * level[1])
  const W = 220
  const H = 120
  const hx = (h: number) => 8 + ((W - 16) * (h - 5)) / 18
  const maxS = Math.max(...shape) * 1.1
  const maxF = Math.max(...fc, ...fact[tue]) * 1.1
  const maxL = Math.max(...level) * 1.1
  const area = shape.slice(5).map((v, i) => `${i ? 'L' : 'M'}${hx(i + 5)},${H - 14 - ((H - 24) * v) / maxS}`).join('') + `L${hx(23)},${H - 14}L${hx(5)},${H - 14}Z`
  return (
    <div className="b-an-eq">
      <div className="p">
        <h4>Доля часа</h4>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Доля каждого часа в&nbsp;суточных посадках, будни октября">
          <path d={area} className="shape" />
          {[6, 12, 18, 23].map((h) => <text key={h} x={hx(h)} y={H - 2} textAnchor="middle">{String(h).padStart(2, '0')}</text>)}
        </svg>
        <p>доля часа в&nbsp;суточных посадках, будни октября; пик {num(Math.max(...shape) * 100, 1)}&nbsp;% дня</p>
      </div>
      <span className="op">×</span>
      <div className="p">
        <h4>Уровень дня</h4>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Посадки за&nbsp;сутки по&nbsp;дню недели">
          {level.map((v, w) => {
            const bw = (W - 16) / 7 - 6
            const x = 8 + ((W - 16) * w) / 7 + 3
            const h = ((H - 24) * v) / maxL
            return <g key={w}><rect x={x} y={H - 14 - h} width={bw} height={h} rx={3} className={w === 1 ? 'lv on' : 'lv'}><title>{`${DOW_SHORT[w]}: ${thousands(v)} посадок`}</title></rect><text x={x + bw / 2} y={H - 2} textAnchor="middle">{DOW_SHORT[w]}</text></g>
          })}
        </svg>
        <p>медиана суточных посадок по&nbsp;дню недели; вторник&nbsp;— {thousands(level[1])}</p>
      </div>
      <span className="op">=</span>
      <div className="p">
        <h4>Прогноз вторника</h4>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Прогноз вторника по&nbsp;часам и&nbsp;факт">
          <path d={fc.slice(5).map((v, i) => `${i ? 'L' : 'M'}${hx(i + 5)},${H - 14 - ((H - 24) * v) / maxF}`).join('')} className="fc" />
          {fact[tue].slice(5).map((v, i) => <circle key={i} cx={hx(i + 5)} cy={H - 14 - ((H - 24) * v) / maxF} r={2.2} className="dot" />)}
          {[6, 12, 18, 23].map((h) => <text key={h} x={hx(h)} y={H - 2} textAnchor="middle">{String(h).padStart(2, '0')}</text>)}
        </svg>
        <p>линия&nbsp;— форма × уровень, точки&nbsp;— факт одного вторника октября</p>
      </div>
    </div>
  )
}

/** Цепочка решения: от данных до диспетчера и внешних систем. */
function Chain() {
  const col = (title: string, tone: string, items: { b: string; s: string }[]) => (
    <div className={`c ${tone}`}>
      <h4>{title}</h4>
      {items.map((i) => <div key={i.b} className="box"><b>{i.b}</b><span>{i.s}</span></div>)}
    </div>
  )
  return (
    <div className="b-an-chain">
      {col('Данные', 'src', [
        { b: 'Метки и валидации', s: 'организаторы, январь⁠—октябрь 2025' },
        { b: 'Календарь и погода', s: 'производственный календарь, Open-Meteo' },
        { b: 'События маршрутов', s: 'посты Дептранса, расписание, OpenStreetMap' },
      ])}
      <span className="ar" aria-hidden="true" />
      {col('Расчёт · Python', 'py', [
        { b: 'Приём и признаки', s: 'сетка «маршрут × день × час», календарь, события' },
        { b: 'Форма × уровень', s: 'медианы последних недель, зимняя форма, тренд' },
        { b: 'Поправки и сверка', s: 'события окна, 14 640 точек, проверка на истории' },
      ])}
      <span className="ar" aria-hidden="true" />
      {col('Образ · один контейнер', 'svc', [
        { b: 'REST API', s: 'Java 21, Spring Boot WebFlux; прогноз в памяти' },
        { b: 'Экран диспетчера', s: 'React, Gravity UI, MapLibre; карта Москвы внутри' },
        { b: 'Пересчёт по факту', s: 'приём валидаций и ГЛОНАСС, пересчёт дня по факту' },
      ])}
      <span className="ar" aria-hidden="true" />
      {col('Кто пользуется', 'use', [
        { b: 'Диспетчер ЕДЦ', s: 'окна риска, рекомендация в рейсах' },
        { b: 'Внешние системы', s: '/api/forecast, /api/risk, /api/nowcast' },
      ])}
    </div>
  )
}

export default function SolutionPage({ ctx }: { ctx: Ctx }) {
  // Рост точности по попыткам реестра: каждая точка — загрузка на лидерборд, линия — лучшее на тот момент.
  const log = ctx.ds.models.log.filter((l) => l.score)
  const names = [...log.map((l) => l.name.replace(/^\d{4}-\d{2}-\d{2}_/, '').split('_')[0]), FINAL.name]
  const scores = [...log.map((l) => l.score as number), FINAL.score]
  let best = 0
  const bestSoFar = scores.map((v) => (best = Math.max(best, v)))
  const first = scores[0]

  return (
    <article className="b-an">
      <header className="b-an-hero">
        <div className="b-an-art"><ArtSolution /></div>
        <p className="kick">Отчёты · решение</p>
        <h1>TramFlow: прогноз посадок и&nbsp;рекомендации по&nbsp;выпуску</h1>
        <p className="lede">
          Сервис предсказывает посадки на&nbsp;десяти трамвайных маршрутах по&nbsp;часам, отдаёт прогноз через API и&nbsp;показывает его на&nbsp;экране
          диспетчера: где будет тесно, почему и&nbsp;сколько рейсов добавить. Прогноз считается заранее, поэтому сервис отвечает за&nbsp;доли миллисекунды,
          а&nbsp;поступающие валидации дня позволяют поправлять его по&nbsp;факту.
        </p>
        <Tiles items={[
          { value: num(FINAL.score, 5), label: 'WAPE-score на лидерборде', note: `итоговая попытка ${FINAL.name}` },
          { value: '14 640', label: 'точек прогноза', note: '10 маршрутов × 61 день × 24 часа' },
          { value: LOAD[0].value, label: 'p95 ответа API', note: 'при 2 000 запросах в секунду' },
          { value: '414 МБ', label: 'один образ без интернета', note: 'API, экран и карта Москвы' },
        ]} />
      </header>

      <section id="s-chain">
        <h2><span className="ic"><IconLayers /></span>Цепочка: от&nbsp;валидаций до&nbsp;решения смены</h2>
        <p>
          Данные проходят через приём, расчёт признаков и&nbsp;прогноза, API и&nbsp;экран. Основной расчёт выполняется в&nbsp;Python, результат сохраняется
          в&nbsp;файл. Сервис на&nbsp;Java выбирает срез и&nbsp;умножает его на&nbsp;поправки, поэтому время ответа не&nbsp;зависит от&nbsp;модели.
        </p>
        <Figure n={1} title="Устройство решения">
          <Chain />
        </Figure>
      </section>

      <section id="s-model">
        <h2><span className="ic"><IconMedian /></span>Модель: форма часа × уровень дня</h2>
        <p>
          Прогноз часа получается умножением его доли на&nbsp;суточные посадки. Форма задаёт распределение пассажиров по&nbsp;часам; она устойчива и&nbsp;рассчитывается по&nbsp;набору
          похожих дней. Уровень задаёт суточные посадки и&nbsp;рассчитывается как медиана последних недель. Затем учитываются календарь,
          зимняя форма, закат и&nbsp;события маршрутов. Ниже показан маршрут {ROUTE} на&nbsp;числах октября.
        </p>
        <Figure n={2} title={`Маршрут ${ROUTE}: прогноз дня как произведение формы и уровня`}>
          <FormLevel ctx={ctx} />
        </Figure>
      </section>

      <section id="s-growth">
        <h2><span className="ic"><IconTarget /></span>Учёт событий дал наибольший прирост точности</h2>
        <p>
          Каждая попытка на&nbsp;лидерборде проверяла одну гипотезу. В&nbsp;модели оставляли изменения, которые дали прибавку на&nbsp;истории
          и&nbsp;на&nbsp;прогнозном окне. От&nbsp;первой попытки ({num(first, 5)}) до&nbsp;итоговой ({num(FINAL.score, 5)}) точность выросла на&nbsp;{num((FINAL.score - first) * 100, 2)}&nbsp;пп.
          Наибольшую прибавку дал учёт события: возврат выходного движения 7-го и&nbsp;50-го после ремонта по&nbsp;посту Дептранса.
        </p>
        <Figure n={3} title="WAPE-score попыток на&nbsp;лидерборде: точки&nbsp;— попытки, линия&nbsp;— лучшее на&nbsp;тот момент"
          legend={[{ label: 'попытка', color: 'var(--b-text-3)' }, { label: 'лучшее на тот момент', color: 'var(--b-accent)' }]}>
          <LineChart x={names} lo={0.87} hi={0.91} ticks={[0.87, 0.88, 0.89, 0.9, 0.91]} fmt={(v) => num(v, 4)} height={260}
            series={[
              { key: 'best', label: 'лучшее', color: 'var(--b-accent)', values: bestSoFar },
              { key: 'try', label: 'попытка', color: 'var(--b-text-3)', values: scores, dots: true },
            ]} />
        </Figure>
      </section>

      <section id="s-limit">
        <h2><span className="ic"><IconDecay /></span>Главный резерв точности&nbsp;— уровень конкретного дня</h2>
        <p>
          Разбор ошибки за&nbsp;октябрь показывает, насколько можно повысить точность. В&nbsp;прогноз по&nbsp;очереди подставляются данные, которые станут известны только
          потом. Наибольшая прибавка связана с&nbsp;уровнем конкретного дня: модель предсказывает суточные посадки хуже, чем их распределение по&nbsp;часам.
          Пересчёт по&nbsp;факту первых часов уточняет этот уровень.
        </p>
        <Figure n={4} title="WAPE-score за&nbsp;октябрь при&nbsp;заранее известных данных">
          <Bars lo={0.88} max={1} fmt={(v) => num(v, 3)}
            rows={CEILING.map((c, i) => ({ label: c.label, value: c.value, note: c.note, strong: i === 0, color: i === 0 ? 'var(--b-accent)' : 'var(--b-l2)' }))} />
        </Figure>
      </section>

      <section id="s-service">
        <h2><span className="ic"><IconGauge /></span>Сервис: скорость ответа и&nbsp;устойчивость при&nbsp;отказе копии</h2>
        <p>
          Образ собирается под&nbsp;linux/amd64 и&nbsp;запускается без&nbsp;сети: прогноз, данные экрана и&nbsp;срез карты Москвы включены в&nbsp;него. Проверки выполнены
          в&nbsp;отдельном контуре нагрузки на&nbsp;контейнере 2&nbsp;vCPU и&nbsp;2&nbsp;ГБ.
        </p>
        <Tiles items={LOAD} />
        <div className="b-an-chips">
          {['GET /api/forecast', 'GET /api/risk', 'GET /api/nowcast', 'GET /api/stops', 'GET /api/vehicles', 'POST /api/ingest', 'POST /api/telemetry'].map((c) => <code key={c}>{c}</code>)}
        </div>
      </section>
    </article>
  )
}
