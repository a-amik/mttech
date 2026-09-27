import { SegmentedRadioGroup } from '@gravity-ui/uikit'
import { useState } from 'react'
import { DAYS, DOW_SHORT, FACT_DAYS, MONTHS_NOM, dowOf, idxOf, isoOf, num, ruDay, thousands } from '../data'
import { isHoliday, routeDay, type Ctx } from '../model'
import { useStore } from '../store'
import { stepOf } from '../lib/scale'

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'день' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'дня' : 'дней')

function monthDays(day: number): number[] {
  const iso = isoOf(day)
  const first = idxOf(`${iso.slice(0, 7)}-01`)
  const out: number[] = []
  for (let i = Math.max(0, first); i < DAYS && isoOf(i).slice(0, 7) === iso.slice(0, 7); i++) out.push(i)
  return out
}

export default function MonthView({ ctx }: { ctx: Ctx }) {
  const { day, route, set } = useStore()
  const [scope, setScope] = useState<'route' | 'net'>('route')
  const days = monthDays(day)
  const month = Number(isoOf(day).slice(5, 7))
  const thr = Number(ctx.s.threshold_pct)

  const cells = days.map((i) => {
    const all = ctx.ds.routes.map((r) => routeDay(ctx, r.id, i))
    const one = all.find((d) => d.route === route)!
    const peak = scope === 'route' ? one.peakLoad : Math.max(...all.map((d) => d.peakLoad))
    const total = scope === 'route' ? one.total : all.reduce((a, d) => a + d.total, 0)
    const risk = scope === 'route' ? one.risk.length : all.reduce((a, d) => a + d.risk.length, 0)
    return { i, peak, total, risk }
  })
  const lead = dowOf(days[0])
  const heavy = cells.filter((c) => c.risk > 0)
  const dayNum = (c: { i: number }) => Number(isoOf(c.i).slice(8))

  return (
    <div className="b-month">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>{MONTHS_NOM[month - 1]} 2025: какие дни потребуют усиленного выпуска</h2>
          <p className="b-muted">
            День окрашен ожидаемой загрузкой в пик, обводка — есть часы над порогом {thr} %.
            {days[0] < FACT_DAYS ? ' Месяц с фактом: прогноз — проверка на прошлом.' : ' Прогноз на период без данных.'}
          </p>
        </div>
        <SegmentedRadioGroup size="m" value={scope} onUpdate={(v) => setScope(v as 'route' | 'net')}
          options={[{ value: 'route', content: `Маршрут ${route}` }, { value: 'net', content: 'Вся сеть' }]} />
      </div>
      <div className="b-cal">
        {DOW_SHORT.map((d) => <div key={d} className="b-cal-h">{d}</div>)}
        {Array.from({ length: lead }, (_, k) => <div key={`e${k}`} className="b-cal-empty" />)}
        {cells.map((c) => {
          const step = c.total ? stepOf(c.peak) : 0
          const hol = isHoliday(ctx, c.i)
          return (
            <button key={c.i} type="button" aria-current={c.i === day}
              className={`b-cal-d${step >= 3 ? ' dark' : ''}${c.risk ? ' over' : ''}`}
              style={{ background: `var(--b-l${step})` }}
              title={`${ruDay(c.i)}: ${thousands(c.total)} посадок, пик ${num(c.peak)} %`}
              onClick={() => set({ day: c.i, horizon: 'day', sim: null })}>
              <b>{dayNum(c)}</b>
              <span>{c.total ? `${num(c.peak)} %` : '—'}</span>
              <small>{thousands(c.total)}</small>
              <span className="flags">
                {hol ? <em style={{ fontStyle: 'normal' }}>выходной</em> : null}
                {c.risk ? <em style={{ fontStyle: 'normal' }}>{c.risk} ч риска</em> : null}
              </span>
            </button>
          )
        })}
      </div>
      <p className="b-small" style={{ marginTop: 12 }}>
        {!heavy.length
          ? 'Дней над порогом нет. '
          : heavy.length * 2 > cells.length
            ? `Над порогом ${heavy.length} ${plural(heavy.length)} из ${cells.length}; спокойные: ${cells.filter((c) => !c.risk && c.total).map(dayNum).join(', ') || 'нет'}. `
            : `Усиленный выпуск: ${heavy.length} ${plural(heavy.length)} — ${heavy.map(dayNum).join(', ')}. `}
        Нажмите на день — откроется его экран.
      </p>
    </div>
  )
}

const DOW_DAT = ['понедельнику', 'вторнику', 'среде', 'четвергу', 'пятнице', 'субботе', 'воскресенью']

export function MonthPanel({ ctx }: { ctx: Ctx }) {
  const { day, route } = useStore()
  const days = monthDays(day)
  const byDow = DOW_SHORT.map((_, dw) => {
    const list = days.filter((i) => dowOf(i) === dw && !isHoliday(ctx, i))
    return list.length ? list.reduce((a, i) => a + routeDay(ctx, route, i).total, 0) / list.length : 0
  })
  const max = Math.max(1, ...byDow)
  const monthTotal = days.reduce((a, i) => a + routeDay(ctx, route, i).total, 0)
  const holidays = days.filter((i) => isHoliday(ctx, i))

  return (
    <aside className="b-side">
      <div className="b-panel">
        <h2><span className="b-rnum">{route}</span>Профиль недели</h2>
        <p className="b-muted">Средние сутки по дням недели, без праздников. Месяц — сумма дней: {thousands(monthTotal)} посадок.</p>
        <div className="b-sec">
          {byDow.map((v, dw) => (
            <div key={dw} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 64px', alignItems: 'center', gap: 8, padding: '3px 0' }}>
              <span className="b-muted">{DOW_SHORT[dw]}</span>
              <span style={{ height: 10, borderRadius: 3, background: 'var(--b-accent)', width: `${(v / max) * 100}%` }} />
              <span style={{ textAlign: 'right' }}>{thousands(v)}</span>
            </div>
          ))}
        </div>
        <div className="b-sec">
          <h3>Особые дни</h3>
          {holidays.length ? (
            <ul className="b-special">
              {holidays.map((i) => {
                const [dow, date] = ruDay(i).split(', ')
                const [num0, month] = date.split(' ')
                const total = routeDay(ctx, route, i).total
                const usual = byDow[dowOf(i)]
                const diff = usual ? (total / usual - 1) * 100 : 0
                return (
                  <li key={i}>
                    <span className="dt"><b>{num0}</b>{month.slice(0, 3)}</span>
                    <span className="tx"><b>{dow[0].toUpperCase() + dow.slice(1)}</b>выходной в будний день</span>
                    <span className="nm" title={usual ? `${thousands(total)} посадок: ${diff > 0 ? '+' : '−'}${num(Math.abs(diff))} % к обычному ${DOW_DAT[dowOf(i)]} (${thousands(usual)})` : undefined}>
                      <b>{thousands(total)}</b>{usual ? `${diff > 0 ? '+' : '−'}${num(Math.abs(diff))} % к обычному` : 'посадок'}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : <p className="b-muted">Будних выходных в месяце нет.</p>}
          {isoOf(days[0]).slice(5, 7) === '12' ? (
            <p className="b-small" style={{ marginTop: 6 }}>16 декабря выходит маршрут 5, 20 декабря — новые версии маршрутов 7, 11, 12 в справочнике.</p>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
