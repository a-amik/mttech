import { useMemo } from 'react'
import { num, wapeScore, type Horizons, type HzModeKey, type HzRow, type HzScore, type ModelKey } from '../../data'
import { planDay, tripsForHour, type Ctx } from '../../model'
import { loadPct } from '../../settings'
import { MODELS } from '../SimView'
import { Bars, Diverging, Figure, HeatTable, LineChart, Tiles } from './charts'
import { ArtModels, IconCalendar, IconCheck, IconClock, IconDatabase, IconDecay, IconFlag, IconLayers, IconMerge, IconWeather } from './art'

const OCT0 = 30
const OCT_DAYS = 31

const HORIZONS: [string, string, string][] = [
  ['1h', 'Через час', '1 ч'], ['1d', 'Завтра', '1 дн'], ['2d', 'Через 2 дня', '2 дн'], ['3d', 'Через 3 дня', '3 дн'], ['7d', 'Через 7 дней', '7 дн'],
  ['14d', 'Через 14 дней', '14 дн'], ['28d', 'Через 28 дней', '28 дн'], ['3m', 'Через 3 месяца', '3 мес'], ['6m', 'Через 6 месяцев', '6 мес'], ['9m', 'Через 9 месяцев', '9 мес'],
]
const MODE_SHORT: Record<HzModeKey, string> = { known: 'известное', weather: '+ погода', events: '+ события', synthetic: 'синтетика' }
const SYN: { key: string; label: string }[] = [
  { key: 'syn_fail', label: 'Сбой на линии: −60 % на 2⁠—3 часа' },
  { key: 'syn_concert', label: 'Концерт у линии: +40 % вечером' },
  { key: 'syn_storm', label: 'Гроза в выходной: −25 % по городу' },
]
const BUCKETS: [string, string][] = [['1—3', '1⁠—3-й раз'], ['4—10', '4⁠—10-й'], ['11+', '11-й и дальше']]
const APPROACH_TITLE: Record<string, string> = { baseline: 'Среднее маршрута', prof_jan_aug: 'Профиль января⁠—августа', prof_sep: 'Профиль сентября', ours: 'TramFlow' }

const n3 = (v: number) => num(v, 3)
const pp = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v) * 100, 2)} пп`
const bestKey = (s: HzScore) => MODELS.reduce((b, m) => (s[m.key] > s[b.key] ? m : b), MODELS[0]).key
const titleOf = (k: ModelKey) => MODELS.find((m) => m.key === k)!.title

interface Approach { key: string; day: (route: string, d: number) => number[] }
interface Score { wape: number; extra: number; short: number; days: number; peakHit: number; peakNear: number; warnCaught: number; warnMissed: number; warnFalse: number }

/** Октябрь целиком: точность, пиковый час маршрута в день, часы выше порога внимания, рейсы. */
function score(ctx: Ctx, a: Approach, ids: string[]): Score {
  const warn = Number(ctx.s.warn_pct)
  const y: number[] = []
  const p: number[] = []
  const s: Score = { wape: 0, extra: 0, short: 0, days: 0, peakHit: 0, peakNear: 0, warnCaught: 0, warnMissed: 0, warnFalse: 0 }
  for (let d = 0; d < OCT_DAYS; d++) {
    for (const id of ids) {
      const fact = ctx.ds.models.oct.fact[id]?.[d]
      if (!fact) continue
      const fc = a.day(id, d)
      const plan = planDay(ctx, id, OCT0 + d).trips
      let pf = 5
      let pq = 5
      for (let h = 5; h < 24; h++) {
        if (fact[h] > fact[pf]) pf = h
        if (fc[h] > fc[pq]) pq = h
      }
      if (fact[pf] > 0) {
        s.days++
        if (pf === pq) s.peakHit++
        if (Math.abs(pf - pq) <= 1) s.peakNear++
      }
      for (let h = 5; h < 24; h++) {
        y.push(fact[h])
        p.push(fc[h])
        const lf = loadPct(ctx.s, id, h, fact[h], plan)
        const lp = loadPct(ctx.s, id, h, fc[h], plan)
        if (lf >= warn && lp >= warn) s.warnCaught++
        else if (lf >= warn) s.warnMissed++
        else if (lp >= warn) s.warnFalse++
        const need = tripsForHour(ctx, id, h, lf, plan)
        const want = tripsForHour(ctx, id, h, lp, plan)
        s.extra += Math.max(0, want - need)
        s.short += Math.max(0, need - want)
      }
    }
  }
  s.wape = wapeScore(y, p)
  return s
}

/** Средняя по месяцам разница гибрида и статистики: месяцы подбора гибрида и отложенные. */
function holdout(row: HzRow | undefined) {
  const m = row?.months
  if (!m) return null
  const avg = (keys: string[]) => (keys.length ? keys.reduce((a, k) => a + (m[k].hyb - m[k].stat), 0) / keys.length : 0)
  const ks = Object.keys(m)
  return { tune: avg(ks.filter((k) => k < '07')), hold: avg(ks.filter((k) => k >= '07')) }
}

export default function ModelsPage({ ctx, data }: { ctx: Ctx; data: Horizons }) {
  const t = data.known.table
  const hz = HORIZONS.filter(([k]) => t[k])
  const modes = (['known', 'weather', 'events'] as HzModeKey[]).filter((k) => data[k])
  const ids = ctx.ds.routes.map((r) => r.id)
  const oct = useMemo(() => {
    const o = ctx.ds.models.oct
    const list: Approach[] = [
      { key: 'baseline', day: (id, x) => o.baseline[id][x] },
      { key: 'prof_jan_aug', day: (id, x) => o.prof_jan_aug[id][x] },
      { key: 'prof_sep', day: (id, x) => o.prof_sep[id][x] },
      { key: 'ours', day: (id, x) => o.ours?.[id]?.[x] ?? ctx.ds.series.backtest[id][OCT0 + x] },
    ]
    return list.filter((a) => a.key === 'ours' || o[a.key]).map((a) => ({ key: a.key, s: score(ctx, a, ids) }))
  }, [ctx, ids])

  const d1 = t['1d'].all
  const leader1 = bestKey(d1)
  const checked = hz.map(([k]) => t[k])
  const hybWins = checked.filter((r) => r.all.hyb > r.all.stat).length
  const hybGain = Math.max(0, ...checked.map((r) => r.all.hyb - r.all.stat))
  const hybLoss = Math.max(0, ...checked.map((r) => r.all.stat - r.all.hyb))
  const mlWins = checked.filter((r) => r.all.ml > r.all.stat).length
  const ev = data.events?.table['1d']?.split
  const curve = data.synthetic?.curve?.['1d']
  const regLong = t['3m']?.windows ? Object.values(t['3m'].windows)[0]?.reg : undefined
  const ours = oct.find((o) => o.key === 'ours')?.s
  const days = ours?.days ?? 0
  const hoRows = hz.filter(([k]) => t[k].months).map(([k, label]) => ({ label, h: holdout(t[k])! }))

  return (
    <article className="b-an">
      <header className="b-an-hero" id="m-abs">
        <div className="b-an-art"><ArtModels /></div>
        <p className="kick">Отчёты · модели</p>
        <h1>Четыре модели на&nbsp;одинаковых входах</h1>
        <p className="lede">
          Линейная регрессия, статистическая модель решения, градиентный бустинг и&nbsp;гибрид прогнозируют посадки «маршрут × час»
          от&nbsp;каждой даты января&#8288;—октября по&nbsp;данным прошлого. В&nbsp;гибриде к&nbsp;статистике добавлена ограниченная поправка бустинга. В&nbsp;прогнозе на&nbsp;завтра лучший счёт у&nbsp;модели
          «{titleOf(leader1)}», {n3(d1[leader1])}. Бустинг сам по&nbsp;себе {mlWins ? `лучше статистики на ${mlWins} из ${checked.length} горизонтов` : 'не превосходит статистику ни на одном горизонте'}:
          на&nbsp;десяти месяцах истории ему не&nbsp;хватает данных. Гибрид точнее статистики на&nbsp;{hybWins} из&nbsp;{checked.length} горизонтов.
        </p>
        <Tiles items={[
          { value: n3(d1[leader1]), label: `лучший счёт на завтра`, note: titleOf(leader1) },
          { value: `${hybWins} из ${checked.length}`, label: 'горизонтов, где гибрид лучше статистики', note: `до ${num(hybGain * 100, 2)} пп; проигрыш не больше ${num(hybLoss * 100, 2)} пп` },
          { value: `${mlWins} из ${checked.length}`, label: 'горизонтов, где бустинг лучше статистики', note: '10 месяцев истории дают мало данных' },
          { value: '0', label: 'окон на 12 месяцев', note: 'в истории нет данных для проверки через год' },
        ]} />
      </header>

      <section id="m-proto">
        <h2><span className="ic"><IconLayers /></span>Модели сравниваются на&nbsp;общих входных данных</h2>
        <div className="b-an-cards c2">
          <div>
            <h4><IconDatabase />Одинаковые входы</h4>
            <p>Уровень и&nbsp;форма последних четырёх недель, день недели, праздники и&nbsp;будни между ними, каникулы, долгота дня. В&nbsp;отдельных режимах добавляются
              фактическая погода дня и&nbsp;события на&nbsp;маршрутах: посты Дептранса, ремонт 7-го и&nbsp;50-го, перекрытия, матчи. Статистическая модель событий не&nbsp;видит.</p>
          </div>
          <div>
            <h4><IconClock />Скользящая дата прогноза</h4>
            <p>Прогноз строится каждый день с&nbsp;29&nbsp;января на&nbsp;один день через 1&#8288;—28&nbsp;дней или на&nbsp;месяц через 3&#8288;—9. Веса обновляются раз в&nbsp;неделю.
              «Через час»&nbsp;— прогноз, поправленный по&nbsp;факту прошедших часов дня. Счёт&nbsp;— WAPE-score трека: 1&nbsp;−&nbsp;Σ|<i>y</i>&nbsp;−&nbsp;<i>ŷ</i>|&nbsp;/&nbsp;Σ<i>y</i>.</p>
          </div>
        </div>
      </section>

      <section id="m-hz">
        <h2><span className="ic"><IconDecay /></span>С&nbsp;ростом горизонта точность снижается</h2>
        <p>
          С&nbsp;ростом горизонта точность снижается у&nbsp;всех моделей. Регрессия на&nbsp;длинных горизонтах теряет точность
          {regLong !== undefined ? <>: обученная на&nbsp;январе, на&nbsp;апреле она получает {n3(regLong)}, потому что продолжает долготу дня линейно за&nbsp;пределы обучения</> : null}.
          Десяти месяцев недостаточно для&nbsp;обучения годовой сезонности: целевой месяц в&nbsp;обучение не&nbsp;попадал.
        </p>
        <Figure n={1} title="WAPE-score по&nbsp;горизонту прогноза, режим «только известное»" legend={MODELS.map((m) => ({ label: m.title, color: m.color }))}
          note="Значения ниже 0,6 показаны у&nbsp;нижнего края: их даёт регрессия на&nbsp;горизонтах от&nbsp;трёх месяцев. Прогноз на&nbsp;двенадцать месяцев не проверяется.">
          <LineChart x={hz.map(([, , s]) => s)} lo={0.6} hi={0.95} ticks={[0.6, 0.7, 0.8, 0.9]} height={280}
            series={MODELS.map((m) => ({ key: m.key, label: m.title, color: m.color, values: hz.map(([k]) => t[k].all[m.key]) }))} />
        </Figure>
        <Figure n={2} title="Точность в&nbsp;числах: насыщенность синего растёт с&nbsp;близостью к&nbsp;максимуму строки; максимум обведён рамкой">
          <HeatTable head="Горизонт" lo={0} hi={0.12} fmt={n3}
            rows={hz.map(([k, label]) => ({ key: k, label, note: `${t[k].n} прогонов` }))}
            cols={MODELS.map((m) => ({ key: m.key, label: m.title, color: m.color }))}
            cell={(r, c) => t[r].all[c as ModelKey]} />
        </Figure>
      </section>

      <section id="m-hyb">
        <h2><span className="ic"><IconMerge /></span>Гибрид: проверка на&nbsp;месяцах вне подбора поправки</h2>
        <p>
          По&nbsp;целям февраля&#8288;—июня для&nbsp;гибрида выбрана половина поправки бустинга с&nbsp;ограничением ±15&nbsp;%. Июль&#8288;—октябрь
          использованы для&nbsp;проверки: сохраняется&nbsp;ли прибавка на&nbsp;месяцах, которые не&nbsp;участвовали в&nbsp;подборе.
        </p>
        <Figure n={3} title="Средняя по&nbsp;месяцам разница точности гибрида и&nbsp;статистики: справа от&nbsp;нуля гибрид точнее">
          <Diverging span={0.006} fmt={pp}
            rows={hoRows.map((r) => ({ label: r.label, groups: [{ label: 'февраль⁠—июнь', value: r.h.tune }, { label: 'июль⁠—октябрь', value: r.h.hold }] }))} />
        </Figure>
      </section>

      <section id="m-modes">
        <h2><span className="ic"><IconWeather /></span>Погода и&nbsp;события мало меняют общий счёт</h2>
        <p>
          Каждая линия показывает, как меняется счёт одной модели при&nbsp;добавлении фактической погоды дня и&nbsp;событий на&nbsp;маршрутах. Линии почти
          горизонтальны: связь с&nbsp;погодой внутри дня есть, но&nbsp;от&nbsp;сезона к&nbsp;сезону меняет знак и&nbsp;силу, а&nbsp;события касаются малой доли посадок.
        </p>
        <div className="b-an-sm">
          {(['1d', '28d'] as const).map((k, i) => {
            const vals = modes.flatMap((m) => MODELS.map((x) => data[m]!.table[k].all[x.key]))
            const lo = Math.floor(Math.min(...vals.filter((v) => v > 0.8)) * 100) / 100
            const hi = Math.ceil(Math.max(...vals) * 100) / 100
            return (
              <Figure key={k} n={4 + i} title={k === '1d' ? 'Завтра' : 'Через 28 дней'} legend={i === 0 ? MODELS.map((m) => ({ label: m.title, color: m.color })) : undefined}
                note={vals.some((v) => v < lo) ? `Значения регрессии ниже ${num(lo, 2)} показаны у края.` : undefined}>
                <LineChart width={380} x={modes.map((m) => MODE_SHORT[m])} lo={lo} hi={hi} height={240}
                  series={MODELS.map((m) => ({ key: m.key, label: m.title, color: m.color, values: modes.map((md) => data[md]!.table[k].all[m.key]) }))} />
              </Figure>
            )
          })}
        </div>
        {ev ? (
          <Figure n={6} title={`Прогноз на завтра: дни с событием на маршруте (${num(ev.event_share * 100, 0)} % посадок) и остальные дни`}>
            <Bars lo={0.8} max={0.92} fmt={n3}
              rows={MODELS.flatMap((m) => [
                { label: `${m.title} · с событием`, value: ev.event[m.key], color: m.color },
                { label: `${m.title} · без события`, value: ev.plain[m.key], color: 'var(--b-l1)' },
              ])} />
          </Figure>
        ) : null}
      </section>

      {curve ? (
        <section id="m-syn">
          <h2><span className="ic"><IconFlag /></span>На&nbsp;синтетических событиях ошибка падает с&nbsp;повторами</h2>
          <p>
            В&nbsp;фактические данные той&nbsp;же истории добавлены события заданной силы в&nbsp;случайные дни. Регрессия, бустинг и&nbsp;гибрид получают сведения
            о&nbsp;событии заранее; статистика их не&nbsp;получает. Проверяется способность учиться на&nbsp;заданных событиях: с&nbsp;каждым повтором
            ошибка в&nbsp;часы события падает у&nbsp;моделей, которые используют эти сведения.
          </p>
          <div className="b-an-sm c3">
            {SYN.map((e, i) => {
              const rows = curve[e.key]
              if (!rows) return null
              const vals = BUCKETS.flatMap(([b]) => MODELS.map((m) => rows[b]?.[m.key] ?? 0))
              return (
                <Figure key={e.key} n={7 + i} title={e.label} legend={i === 0 ? MODELS.map((m) => ({ label: m.title, color: m.color })) : undefined}>
                  <LineChart width={320} x={BUCKETS.map(([, l]) => l)} lo={0} hi={Math.ceil(Math.max(...vals) * 10) / 10} height={220} fmt={(v) => `${num(v * 100, 0)} %`}
                    series={MODELS.map((m) => ({ key: m.key, label: m.title, color: m.color, values: BUCKETS.map(([b]) => rows[b]?.[m.key] ?? null) }))} />
                </Figure>
              )
            })}
          </div>
        </section>
      ) : null}

      <section id="m-oct">
        <h2><span className="ic"><IconCalendar /></span>Октябрь: точность, пики и&nbsp;часы выше порога</h2>
        <p>
          Октябрь завершает историю фактических данных; обучение идёт до&nbsp;конца сентября. Кроме общей точности проверяем, угадан&nbsp;ли самый
          нагруженный час маршрута и&nbsp;выявлены&nbsp;ли заранее часы выше порога внимания {String(ctx.s.warn_pct)}&nbsp;%. Параметры модели подбирались на&nbsp;октябре,
          поэтому её числа здесь оптимистичны.
        </p>
        <div className="b-an-sm">
          <Figure n={10} title={`Пиковый час угадан, из ${days} маршруто-дней`}>
            <Bars max={days || 1} fmt={(v) => String(v)}
              rows={oct.map((o) => ({ label: APPROACH_TITLE[o.key], value: o.s.peakHit, note: `до часа — ${o.s.peakNear}`, strong: o.key === 'ours', color: o.key === 'ours' ? 'var(--b-accent)' : 'var(--b-l2)' }))} />
          </Figure>
          <Figure n={11} title={`Часы выше ${String(ctx.s.warn_pct)} % вместимости, увиденные заранее`}>
            <Bars max={Math.max(1, ...oct.map((o) => o.s.warnCaught + o.s.warnMissed))} fmt={(v) => String(v)}
              rows={oct.map((o) => ({ label: APPROACH_TITLE[o.key], value: o.s.warnCaught, note: `ложных тревог ${o.s.warnFalse}`, strong: o.key === 'ours', color: o.key === 'ours' ? 'var(--b-accent)' : 'var(--b-l2)' }))} />
          </Figure>
        </div>
        <Figure n={12} title="WAPE-score за&nbsp;октябрь">
          <Bars lo={0.4} max={0.95} fmt={n3}
            rows={oct.map((o) => ({ label: APPROACH_TITLE[o.key], value: o.s.wape, note: `лишних рейсов ${o.s.extra}, недостающих ${o.s.short}`, strong: o.key === 'ours', color: o.key === 'ours' ? 'var(--b-accent)' : 'var(--b-l2)' }))} />
        </Figure>
      </section>

      <section id="m-end">
        <h2><span className="ic"><IconCheck /></span>Статистика остаётся основой прогноза</h2>
        <ol className="b-an-list">
          <li>Основой прогноза остаётся статистическая модель: чистый бустинг лучше неё на&nbsp;{mlWins} из&nbsp;{checked.length} горизонтов.</li>
          <li>Гибрид с&nbsp;ограниченной поправкой бустинга точнее статистики на&nbsp;{hybWins}{' '}
            из&nbsp;{checked.length} горизонтов, с&nbsp;прибавкой до&nbsp;{num(hybGain * 100, 2)}&nbsp;пп.</li>
          <li>Регрессию на&nbsp;горизонтах от&nbsp;квартала использовать нельзя: она уходит за&nbsp;пределы обучения.</li>
          <li>Сервису нужны ежедневное переучивание и&nbsp;пересчёт по&nbsp;факту прошедших часов.</li>
        </ol>
        <p className="b-muted">
          Длинные горизонты проверены на&nbsp;одном&#8288;—семи окнах. Проверка на&nbsp;синтетических событиях показывает способность учиться; реальный
          эффект по&nbsp;ней оценить нельзя. Команда для&nbsp;пересчёта всех чисел: <code>python -m tramflow.horizons</code>.
        </p>
      </section>
    </article>
  )
}
