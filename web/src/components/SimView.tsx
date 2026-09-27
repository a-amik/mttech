import { useEffect, useMemo, useRef } from 'react'
import { Slider } from '@gravity-ui/uikit'
import { num, ruDate, type HzReplay, type ModelKey } from '../data'
import type { Ctx } from '../model'
import { HZ, useHorizons, useSim } from '../simState'

// Прогон на реальной истории: от каждой даты прогноза четыре модели предсказывают один и тот же
// день-цель на одинаковых входах. Счёт копится по ходу, как если бы модели работали с конца января.

export const MODELS: { key: ModelKey; title: string; note: string; color: string }[] = [
  { key: 'reg', title: 'Регрессия', note: 'линейная, на логарифме посадок', color: 'var(--b-m-reg)' },
  { key: 'stat', title: 'Статистика', note: 'форма часа × уровень дня, v41', color: 'var(--b-m-stat)' },
  { key: 'ml', title: 'ML', note: 'градиентный бустинг LightGBM', color: 'var(--b-m-ml)' },
  { key: 'hyb', title: 'Гибрид', note: 'статистика, поправленная бустингом', color: 'var(--b-m-hyb)' },
]


/** Синтетические события режима «Синтетика» — как их вписывает tramflow.horizons (SYN_EVENTS). */
const SYN: { key: string; label: string }[] = [
  { key: 'syn_fail', label: 'Сбой на линии, −60 % на 2—3 часа' },
  { key: 'syn_concert', label: 'Концерт у линии, +40 % в 21—23' },
  { key: 'syn_storm', label: 'Гроза в выходной, −25 % по городу' },
]
const BUCKETS = [{ key: '1—3', label: '1—3-й раз' }, { key: '4—10', label: '4—10-й' }, { key: '11+', label: '11-й и дальше' }]


/** События истории, которые видно в ошибках: подписи на графике гонки. */
const EVENTS: { from: string; to?: string; label: string }[] = [
  { from: '2025-05-01', to: '2025-05-11', label: 'майские' },
  { from: '2025-06-12', to: '2025-06-15', label: '12 июня' },
  { from: '2025-07-10', to: '2025-07-21', label: '7-й: событие на линии' },
  { from: '2025-09-01', label: '1 сентября' },
  { from: '2025-09-06', to: '2025-10-26', label: 'ремонт: выходные 50-го' },
]

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

/** Счёт дня и накопленный счёт по дням прогона для каждой модели. */
function prepare(r: HzReplay) {
  const fact = r.sum.map(sum)
  const out = {} as Record<ModelKey, { day: number[]; cum: number[]; err: number[] }>
  for (const m of MODELS) {
    const err = r.err[m.key].map(sum)
    let e = 0
    let f = 0
    const cum: number[] = []
    err.forEach((v, i) => { e += v; f += fact[i]; cum.push(f ? 1 - e / f : 1) })
    out[m.key] = { day: err.map((v, i) => (fact[i] ? Math.max(0, 1 - v / fact[i]) : 1)), cum, err }
  }
  // победитель дня — модель с наименьшей ошибкой
  const winner = fact.map((_, i) => MODELS.reduce((b, m) => (out[m.key].err[i] < out[b.key].err[i] ? m : b), MODELS[0]).key)
  return { fact, by: out, winner }
}

const dayColor = (s: number) =>
  s >= 0.93 ? 'var(--b-l0)' : s >= 0.9 ? 'var(--b-l1)' : s >= 0.86 ? 'var(--b-l2)' : s >= 0.8 ? 'var(--b-l3)' : s >= 0.7 ? 'var(--b-l4)' : 'var(--b-over)'

export default function SimView({ ctx }: { ctx: Ctx }) {
  void ctx
  const data = useHorizons()
  const { hz, mode, dur, pos, playing, set } = useSim()
  const setPos = (f: (p: number) => number) => set({ pos: f(useSim.getState().pos) })
  const setPlaying = (v: boolean) => set({ playing: v })
  const timer = useRef<number | null>(null)
  // уход со страницы останавливает прогон
  useEffect(() => () => useSim.getState().set({ playing: false }), [])
  const replay = data?.[mode]?.replay[hz]
  const prep = useMemo(() => (replay ? prepare(replay) : null), [replay])
  const n = replay?.dates.length ?? 0

  // Прогон: весь период за dur секунд, шаг — одна дата прогноза.
  useEffect(() => {
    if (!playing || !n) return
    const step = Math.max(40, (dur * 1000) / n)
    timer.current = window.setInterval(() => {
      const p = useSim.getState().pos
      if (p >= n - 1) useSim.getState().set({ playing: false })
      else useSim.getState().set({ pos: p + 1 })
    }, step)
    return () => { if (timer.current) window.clearInterval(timer.current) }
  }, [playing, n, dur])
  useEffect(() => { if (n) setPos((p) => Math.min(p, n - 1)) }, [n])
  useEffect(() => { if (new URLSearchParams(location.search).has('play') && n) setPlaying(true) }, [n])

  if (data === undefined) return <main className="b-main b-sim-v"><p className="b-muted">Загружаю прогон…</p></main>
  if (!data || !replay || !prep) {
    return (
      <main className="b-main b-sim-v">
        <p className="b-muted">Нет файла прогона: соберите его командой <code>python -m tramflow.horizons</code>.</p>
      </main>
    )
  }

  const [origin, target] = replay.dates[pos]
  const hzDays = HZ.find((h) => h.key === hz)!.days

  // Почасовой график дня-цели: ось общая на весь прогон, чтобы кадры не прыгали.
  const W = 760
  const H = 250
  const yMax = Math.max(...replay.fact.map((d) => Math.max(...d)), ...MODELS.flatMap((m) => replay[m.key].map((d) => Math.max(...d))).filter((v) => v < 1e6)) * 1.05
  const x = (h: number) => 40 + ((W - 52) * (h - 5 + 0.5)) / 19
  const y = (v: number) => H - 24 - ((H - 34) * Math.min(v, yMax)) / yMax
  const line = (vals: number[]) => vals.slice(5).map((v, i) => `${i ? 'L' : 'M'}${x(i + 5).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const barW = (W - 52) / 19 - 4
  // шкала ошибок общая на прогон: большой промах видно как большой
  const errs: number[] = []
  replay.fact.forEach((d, i) => MODELS.forEach((m) => d.forEach((v, h) => { if (h >= 5) errs.push(Math.abs(replay[m.key][i][h] - v)) })))
  errs.sort((a, b) => a - b)
  const errMax = Math.max(1, errs[Math.floor(errs.length * 0.98)] ?? 1)

  // Гонка накопленного счёта.
  const RW = 760
  const RH = 336 // вровень с левым блоком: график дня 250, ошибки по часам 64 и строка легенды
  // Ось — по устоявшемуся счёту после первых четырёх недель: в холодный старт бустинг проваливается
  // до 0,6, и ось на весь прогон сплющила бы разницу моделей. Ранние точки ниже оси прижаты к краю,
  // подпись графика называет такие модели. Пол 0,5 — на случай провала после четырёх недель.
  const FLOOR = 0.5
  const cumAll = MODELS.flatMap((m) => prep.by[m.key].cum.slice(Math.min(28, Math.max(0, n - 1))))
  const lo = Math.max(FLOOR, Math.floor(Math.min(...cumAll) * 20) / 20)
  const hi = Math.min(1, Math.ceil(Math.max(...cumAll) * 200 + 1) / 200)
  const clipped = MODELS.filter((m) => prep.by[m.key].cum.some((v) => v < lo))
  const rx = (i: number) => 40 + ((RW - 52) * i) / Math.max(1, n - 1)
  const ry = (v: number) => RH - 22 - ((RH - 34) * (Math.max(lo, Math.min(hi, v)) - lo)) / Math.max(0.001, hi - lo)
  const cumPath = (a: number[]) => a.slice(0, pos + 1).map((v, i) => `${i ? 'L' : 'M'}${rx(i).toFixed(1)},${ry(v).toFixed(1)}`).join('')
  const targets = replay.dates.map((d) => d[1])
  const idxOfDate = (iso: string) => { const i = targets.findIndex((t) => t >= iso); return i < 0 ? -1 : i }
  // подпись месяца — там, где он начинается; слишком близкие к соседней (неполный первый месяц) не ставятся
  const months = targets.map((t, i) => (i === 0 || t.slice(5, 7) !== targets[i - 1].slice(5, 7) ? i : -1)).filter((i) => i >= 0)
    .filter((i, k, a) => k === a.length - 1 || rx(a[k + 1]) - rx(i) >= 30)

  const scores = MODELS.map((m) => ({ ...m, cum: prep.by[m.key].cum[pos], day: prep.by[m.key].day[pos], wins: prep.winner.slice(0, pos + 1).filter((w) => w === m.key).length }))
  const leader = scores.reduce((b, s) => (s.cum > b.cum ? s : b), scores[0])
  const tbl = data[mode]!.table[hz]
  const curve = data[mode]?.curve?.[hz] ?? data[mode]?.curve?.['1d']

  return (
    <main className="b-main b-sim-v">
      <div className="b-bar">
        <h2>Имитация: четыре модели на&nbsp;одинаковых входах</h2>
      </div>

      {mode === 'synthetic' && (
        <p className="b-sim-note">
          <b>Синтетика.</b> В&nbsp;факт той&nbsp;же истории вписаны события заданной силы в&nbsp;случайные дни: 30&nbsp;сбоев на&nbsp;линии,
          30&nbsp;концертов у&nbsp;линии, 20&nbsp;гроз в&nbsp;выходные. Регрессия, ML и&nbsp;гибрид знают о&nbsp;событии заранее, статистика&nbsp;— нет.
          Это проверка, со&nbsp;скольких повторов модель выучивает событие, а&nbsp;не&nbsp;замер реальности.
        </p>
      )}
      {mode === 'events' && (
        <p className="b-sim-note">
          <b>С&nbsp;событиями.</b> Кроме погоды, модели знают посты Дептранса о&nbsp;задержках и&nbsp;изменениях на&nbsp;маршруте, режим ремонта
          7-го и&nbsp;50-го, перекрытия центра, матчи и&nbsp;концерты. Статистика событий не&nbsp;видит.
          {tbl.split ? <> В&nbsp;дни с&nbsp;событием на&nbsp;маршруте ({num(tbl.split.event_share * 100, 0)}&nbsp;% посадок): {MODELS.map((m) => `${m.title.toLowerCase()} ${num(tbl.split!.event[m.key], 3)}`).join(', ')}.</> : null}
        </p>
      )}

      <div className="b-sim-cards">
        {scores.map((s) => (
          <div key={s.key} className={`b-sim-card${s.key === leader.key && pos > 6 ? ' lead' : ''}`} style={{ '--c': s.color } as React.CSSProperties}>
            <div className="h"><i />{s.title}{s.key === leader.key && pos > 6 ? <em>впереди</em> : null}</div>
            <b>{num(s.cum, 3)}</b>
            <div className="n">{s.note}</div>
            <div className="row"><span>этот день</span><span>{num(s.day, 3)}</span></div>
            <div className="row"><span>лучшая в&nbsp;день</span><span>{s.wins} из&nbsp;{pos + 1}</span></div>
            <div className="bar"><span style={{ width: `${Math.max(0, (s.cum - lo) / Math.max(0.001, hi - lo)) * 100}%` }} /></div>
          </div>
        ))}
      </div>

      <div className="b-sim-grid">
        <figure className="b-sim-fig">
          <figcaption className="t">
            {hzDays === 0
              ? <>Прогноз на&nbsp;<b>{ruDate(target)}</b> на&nbsp;час вперёд: каждый час&nbsp;— по&nbsp;факту прошедших часов дня · вся сеть</>
              : <>Прогноз от&nbsp;{ruDate(origin)} на&nbsp;<b>{ruDate(target)}</b>, {hzDays === 1 ? 'на завтра' : `за ${hzDays} ${hzDays < 5 ? 'дня' : 'дней'}`} · вся сеть по&nbsp;часам</>}
          </figcaption>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Посадки дня-цели по часам: факт и четыре модели">
            {[0, 0.5, 1].map((k) => (
              <g key={k}>
                <line x1={40} x2={W - 8} y1={y(yMax * k / 1.05)} y2={y(yMax * k / 1.05)} className="grid" />
                <text x={36} y={y(yMax * k / 1.05) + 4} textAnchor="end">{num(yMax * k / 1.05 / 1000, 0)} тыс.</text>
              </g>
            ))}
            {replay.fact[pos].slice(5).map((v, i) => (
              <rect key={i} className="fact" x={x(i + 5) - barW / 2} y={y(v)} width={barW} height={Math.max(0, H - 24 - y(v))} rx={2} />
            ))}
            {MODELS.map((m) => <path key={m.key} d={line(replay[m.key][pos])} fill="none" stroke={m.color} strokeWidth={m.key === 'ml' ? 2.5 : 2} strokeLinejoin="round" />)}
            {Array.from({ length: 19 }, (_, i) => i + 5).filter((h) => h % 3 === 0).map((h) => <text key={h} x={x(h)} y={H - 6} textAnchor="middle">{String(h).padStart(2, '0')}</text>)}
          </svg>
          <svg viewBox={`0 0 ${W} 64`} className="errs" role="img" aria-label="Ошибка каждой модели по часам дня-цели">
            <text x={2} y={10}>ошибка по часам</text>
            {Array.from({ length: 19 }, (_, i) => i + 5).map((h) => (
              <g key={h}>
                {MODELS.map((m, k) => {
                  const e = Math.abs(replay[m.key][pos][h] - replay.fact[pos][h])
                  const hgt = Math.min(56, (56 * e) / errMax)
                  return <rect key={m.key} x={x(h) - barW / 2 + (k * barW) / 3} y={60 - hgt} width={barW / 3 - 1} height={hgt} fill={m.color} rx={1} />
                })}
              </g>
            ))}
          </svg>
          <div className="legend">
            <span><i className="f" />факт</span>
            {MODELS.map((m) => <span key={m.key}><i style={{ background: m.color }} />{m.title}</span>)}
          </div>
        </figure>

        <figure className="b-sim-fig">
          <figcaption className="t">
            Накопленный счёт с&nbsp;начала прогона
            {clipped.length ? <> · {clipped.map((m) => m.title).join(', ')} местами ниже {num(lo, 2)}, прижато к&nbsp;краю</> : null}
          </figcaption>
          <svg viewBox={`0 0 ${RW} ${RH}`} role="img" aria-label="Накопленный WAPE-score четырёх моделей по датам прогона">
            {EVENTS.map((e) => {
              const a = idxOfDate(e.from)
              if (a < 0) return null
              const b = e.to ? Math.max(a, idxOfDate(e.to) < 0 ? n - 1 : idxOfDate(e.to)) : a
              return (
                <g key={e.from} className={a <= pos ? 'ev on' : 'ev'}>
                  <rect x={rx(a) - 1} y={10} width={Math.max(2, rx(b) - rx(a) + 2)} height={RH - 32} />
                  <text x={rx(a) + 3} y={EVENTS.indexOf(e) % 2 ? 32 : 20}>{e.label}</text>
                </g>
              )
            })}
            {[lo, (lo + hi) / 2, hi].map((v) => (
              <g key={v}>
                <line x1={40} x2={RW - 8} y1={ry(v)} y2={ry(v)} className="grid" />
                <text x={36} y={ry(v) + 4} textAnchor="end">{num(v, 2)}</text>
              </g>
            ))}
            {months.map((i) => <text key={i} x={rx(i)} y={RH - 6}>{ruDate(targets[i]).split(' ')[1].slice(0, 3)}</text>)}
            {MODELS.map((m) => <path key={m.key} d={cumPath(prep.by[m.key].cum)} fill="none" stroke={m.color} strokeWidth={2.5} strokeLinejoin="round" />)}
            {MODELS.map((m) => <circle key={m.key} cx={rx(pos)} cy={ry(prep.by[m.key].cum[pos])} r={4} fill={m.color} />)}
            <line x1={rx(pos)} x2={rx(pos)} y1={10} y2={RH - 22} className="cursor" />
          </svg>
        </figure>
      </div>

      <figure className="b-sim-fig b-sim-strip">
        <figcaption className="t">Точность каждого дня: чем темнее, тем больше ошибка; красное&nbsp;— провал ниже 0,70</figcaption>
        <div className="rows">
          {MODELS.map((m) => (
            <div key={m.key} className="r">
              <span className="l" style={{ color: m.color }}>{m.title}</span>
              <div className="cells" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
                {prep.by[m.key].day.map((s, i) => (
                  <i key={i} style={{ background: i <= pos ? dayColor(s) : undefined }} title={`${ruDate(targets[i])}: ${num(s, 3)}`} />
                ))}
              </div>
            </div>
          ))}
          <div className="r">
            <span className="l">Лучшая в&nbsp;день</span>
            <div className="cells" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
              {prep.winner.map((w, i) => <i key={i} style={{ background: i <= pos ? MODELS.find((m) => m.key === w)!.color : undefined }} />)}
            </div>
          </div>
        </div>
        <div className="scrub">
          <Slider size="m" min={0} max={n - 1} value={pos} marks={0} tooltipDisplay="off" onUpdate={(v) => set({ playing: false, pos: v as number })} aria-label="Дата прогона" />
          <span>{ruDate(targets[0])}</span><span>{ruDate(targets[n - 1])}</span>
        </div>
      </figure>

      {mode === 'synthetic' && curve && (
        <figure className="b-sim-fig b-sim-curve">
          <figcaption className="t">Кривая обучения: ошибка на&nbsp;часах синтетического события в&nbsp;процентах от&nbsp;факта по&nbsp;номеру повтора события, меньше&nbsp;— лучше</figcaption>
          <table>
            <thead>
              <tr><th />{BUCKETS.map((b) => <th key={b.key}>{b.label}</th>)}</tr>
            </thead>
            <tbody>
              {SYN.filter((s) => curve[s.key]).map((s) => (
                <tr key={s.key}>
                  <th>{s.label}</th>
                  {BUCKETS.map((b) => {
                    const c = curve[s.key][b.key]
                    if (!c) return <td key={b.key} />
                    const best = MODELS.reduce((x, m) => (c[m.key] < c[x.key] ? m : x), MODELS[0]).key
                    return (
                      <td key={b.key}>
                        {MODELS.map((m) => (
                          <span key={m.key} className={m.key === best ? 'best' : undefined} style={{ '--c': m.color } as React.CSSProperties}>
                            <i />{num(c[m.key] * 100, 0)}&nbsp;%
                          </span>
                        ))}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="legend">{MODELS.map((m) => <span key={m.key}><i style={{ background: m.color }} />{m.title}</span>)}</div>
        </figure>
      )}

      <p className="b-muted">
        Итог горизонта за&nbsp;весь прогон, {tbl.n} дат: {MODELS.map((m) => `${m.title.toLowerCase()} ${num(tbl.all[m.key], 3)}`).join(', ')}.
        Все горизонты от&nbsp;часа до&nbsp;девяти месяцев&nbsp;— вв&nbsp;разделе «Аналитика»nbsp;разделе «Отчёты».
      </p>
    </main>
  )
}
