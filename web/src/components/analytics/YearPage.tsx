import { FACT_DAYS, MONTHS_NOM, isoOf, num, thousands, type Horizons } from '../../data'
import { routeDay, type Ctx } from '../../model'
import { MODELS } from '../SimView'
import { Figure, LineChart, Tiles } from './charts'
import { YEAR_EPISODES } from './facts'
import { ArtYear, IconCalendarYear, IconCheck, IconDecay, IconFlag } from './art'

const HZ: [string, string][] = [['1d', '1 дн'], ['28d', '28 дн'], ['3m', '3 мес'], ['6m', '6 мес'], ['9m', '9 мес'], ['12m', '12 мес']]

export default function YearPage({ ctx, data }: { ctx: Ctx; data: Horizons }) {
  const t = data.known.table
  // 2025 по месяцам: факт января—октября и прогноз ноября—декабря той же модели, что на экране
  const ids = ctx.ds.routes.map((r) => r.id)
  const y2025 = Array(12).fill(0)
  const start = Date.parse(ctx.ds.history.start)
  for (const id of ids) {
    ctx.ds.history.daily[id]?.forEach((v, i) => { y2025[new Date(start + i * 86_400_000).getUTCMonth()] += v })
    for (let i = FACT_DAYS; i < FACT_DAYS + 61; i++) y2025[Number(isoOf(i).slice(5, 7)) - 1] += routeDay(ctx, id, i).total
  }
  // маршрут 5 в 2025 году работал с 16 декабря; в 2026 году он работает весь год на уровне декабря
  const r5Month = (routeDay(ctx, '5', FACT_DAYS + 50).total || 0) * 30
  const base = y2025.map((v, m) => Math.round(v + (m < 11 ? r5Month : 0)))
  const total25 = y2025.reduce((a, b) => a + b, 0)
  const total26 = base.reduce((a, b) => a + b, 0)
  const months = MONTHS_NOM.map((m) => m.slice(0, 3).toLowerCase())
  // ось не от нуля: месяцы отличаются на десятки процентов, и от нуля сезонность сплющилась бы в линию
  const yLo = Math.floor((Math.min(...y2025) * 0.85) / 100_000) * 100_000
  const peak = base.indexOf(Math.max(...base))
  const low = base.indexOf(Math.min(...base))

  return (
    <article className="b-an">
      <header className="b-an-hero">
        <div className="b-an-art"><ArtYear /></div>
        <p className="kick">Отчёты · год</p>
        <h1>Год: объём посадок по&nbsp;месяцам и&nbsp;влияние событий</h1>
        <p className="lede">
          Годовой прогноз показывает объём посадок по&nbsp;месяцам для&nbsp;плана выпуска и&nbsp;отклик на&nbsp;заданные события: запуск маршрута, ремонт,
          пересадку пассажиров на&nbsp;соседнюю линию. Предсказать посадки по&nbsp;часам конкретного дня через год нельзя:
          в&nbsp;истории десять месяцев, и&nbsp;данных для&nbsp;проверки годового прогноза нет.
        </p>
        <Tiles items={[
          { value: thousands(total26), label: 'посадок в 2026 году, база', note: `2025 год — ${thousands(total25)}` },
          { value: MONTHS_NOM[peak], label: 'самый нагруженный месяц', note: `${thousands(base[peak])} посадок` },
          { value: MONTHS_NOM[low], label: 'месяц с наименьшим числом посадок', note: `${thousands(base[low])} посадок` },
          { value: '0', label: 'окон проверки на год', note: 'нужна история за прошлые годы' },
        ]} />
      </header>

      <section id="y-decay">
        <h2><span className="ic"><IconDecay /></span>На&nbsp;год вперёд точность проверить нечем</h2>
        <p>
          На&nbsp;истории видно, как быстро прогноз теряет точность: от&nbsp;{num(t['1d'].all.stat, 3)} на&nbsp;завтра до&nbsp;{num(t['6m']?.all.stat ?? 0, 3)} через полгода
          у&nbsp;статистической модели. После двадцати восьми дней окон становится мало, а&nbsp;на&nbsp;двенадцать месяцев их нет вовсе: для&nbsp;любой даты истории
          отсутствуют данные через год после неё.
        </p>
        <Figure n={1} title="WAPE-score для&nbsp;горизонтов от&nbsp;дня до&nbsp;года" legend={MODELS.map((m) => ({ label: m.title, color: m.color }))}
          note="Точка 12&nbsp;месяцев пуста: данных для&nbsp;проверки нет. Значения регрессии ниже 0,6 показаны у&nbsp;нижнего края.">
          <LineChart x={HZ.map(([, l]) => l)} lo={0.6} hi={0.95} ticks={[0.6, 0.7, 0.8, 0.9]} height={260}
            series={MODELS.map((m) => ({ key: m.key, label: m.title, color: m.color, values: HZ.map(([k]) => t[k]?.all[m.key] ?? null) }))} />
        </Figure>
      </section>

      <section id="y-base">
        <h2><span className="ic"><IconCalendarYear /></span>База 2026&nbsp;года повторяет прошлогоднюю сезонность</h2>
        <p>
          База повторяет сезонность 2025&nbsp;года по&nbsp;месяцам: факт января&#8288;—октября и&nbsp;прогноз модели на&nbsp;ноябрь и&nbsp;декабрь. В&nbsp;2026&nbsp;году к&nbsp;ней
          добавлен маршрут&nbsp;5, который в&nbsp;2025&nbsp;году начал работать только 16&nbsp;декабря: {thousands(r5Month)} посадок в&nbsp;месяц на&nbsp;уровне его декабря.
          На&nbsp;июль 2026&nbsp;года в&nbsp;базе перенесено влияние летнего ремонта 2025&nbsp;года. Если ремонта не&nbsp;будет, число посадок окажется выше.
        </p>
        <Figure n={2} title="Посадки по&nbsp;месяцам, все маршруты задания; ось начинается не с&nbsp;нуля"
          legend={[{ label: '2025: факт и прогноз ноября⁠—декабря', color: 'var(--b-text-3)' }, { label: '2026: база с маршрутом 5', color: 'var(--b-accent)' }]}>
          <LineChart x={months} lo={yLo} hi={Math.max(...base) * 1.04} fmt={(v) => thousands(v)} height={260}
            ticks={[yLo, (yLo + Math.max(...base)) / 2, Math.max(...base)]}
            series={[
              { key: '2025', label: '2025', color: 'var(--b-text-3)', values: y2025.map((v) => Math.round(v)) },
              { key: '2026', label: '2026, база', color: 'var(--b-accent)', values: base },
            ]} />
        </Figure>
      </section>

      <section id="y-events">
        <h2><span className="ic"><IconFlag /></span>Отклики на&nbsp;события взяты из&nbsp;прошлогодних эпизодов</h2>
        <p>
          Отклик на&nbsp;событие года рассчитывается по&nbsp;похожему эпизоду 2025&nbsp;года. Эти эпизоды есть в&nbsp;истории и&nbsp;уже
          встроены в&nbsp;прогноз окна: возврат выходного движения после ремонта, событие на&nbsp;линии 7-го, пересадка на&nbsp;соседний маршрут.
        </p>
        <div className="b-an-kv">
          {YEAR_EPISODES.map((e) => <div key={e.label}><b>{e.value}</b><span>{e.label}</span><small>{e.note}</small></div>)}
        </div>
      </section>

      <section id="y-use">
        <h2><span className="ic"><IconCheck /></span>План выпуска строится по&nbsp;базе с&nbsp;поправками на&nbsp;события</h2>
        <ol className="b-an-list">
          <li>План выпуска по&nbsp;месяцам строится по&nbsp;базовой кривой: она показывает, в&nbsp;какие месяцы нужен усиленный выпуск.</li>
          <li>Для&nbsp;запуска маршрута, ремонта или открытия станции рядом в&nbsp;прогноз добавляется поправка по&nbsp;похожему эпизоду.</li>
          <li>После первого полного года истории та&nbsp;же проверка по&nbsp;датам даст точность и&nbsp;на&nbsp;двенадцать месяцев: пустая точка на&nbsp;рис.&nbsp;1 заполнится.</li>
        </ol>
      </section>
    </article>
  )
}
