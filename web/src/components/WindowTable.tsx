import { useStore } from '../store'
import { IconEye } from '../lib/icons'
import { useEffect, useRef } from 'react'
import { Button } from '@gravity-ui/uikit'
import { hh, num } from '../data'
import { sameDowMean, tripsNeeded, type Ctx, type RiskWindow } from '../model'
import { tripsHour } from '../settings'
import { stepOf } from '../lib/scale'
import { accept, pick, pickWindow, span, trips } from '../actions'
import { HOURS, type Screen } from '../screen'
import { Key, Pri, RNum } from './Bits'

function Spark({ load, from, to, peak }: { load: number[]; from: number; to: number; peak: number }) {
  const W = 84
  const H = 20
  const max = Math.max(120, ...load)
  const pts = HOURS.map((h, i) => [(i * W) / (HOURS.length - 1), H - 2 - (load[h] / max) * (H - 4)])
  const at = (h: number) => pts[h - HOURS[0]]
  return (
    <svg className="b-spark" width={W} height={H} aria-hidden="true">
      <rect x={at(from)[0] - 1} y={0} width={Math.max(2, at(Math.min(to, 23))[0] - at(from)[0] + 2)} height={H} />
      <path d={`M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}`} />
      <circle cx={at(peak)[0]} cy={at(peak)[1]} r={2.4} />
    </svg>
  )
}

/** Второй вид центра: окна строками, заливка только у ячейки загрузки, действие по наведению. */
export default function WindowTable({ ctx, sc }: { ctx: Ctx; sc: Screen }) {
  const { route, hour, day } = useStore()
  const now = useStore((s) => s.now)
  const mode = useStore((s) => s.mode)
  const thr = Number(ctx.s.threshold_pct)
  // «Вся сеть»: все окна дня, прошедшие приглушены, и строка на каждый маршрут без окон — с его пиком.
  const all = mode === 'all'
  const rows = all ? [...sc.wins].sort((a, b) => a.from - b.from || a.prio - b.prio) : sc.wins.filter((w) => w.to > now)
  const quiet = all ? ctx.ds.routes.filter((r) => sc.days[r.id].total && !sc.wins.some((w) => w.route === r.id)) : []

  // Изменившаяся ячейка загрузки коротко вспыхивает; первый показ — без вспышки.
  const prev = useRef<Record<string, number> | null>(null)
  const seen = prev.current
  const values = Object.fromEntries(rows.map((w) => [w.key, Math.round(Math.max(...sc.after[w.route].slice(w.from, w.to)))]))
  useEffect(() => { prev.current = values })

  const usualOf = (id: string) => {
    const u = sameDowMean(ctx, id, day)
    return u ? (sc.days[id].total / u - 1) * 100 : null
  }
  const usual = (w: RiskWindow) => usualOf(w.route)
  const usualCell = (u: number | null) => <td className={`n${u !== null && u >= 0 ? ' pos' : ''}`}>{u === null ? '—' : `${u >= 0 ? '+' : '−'}${num(Math.abs(u))} %`}</td>

  return (
    <div className="b-tbl-wrap">
      <table className="b-tbl">
        <thead>
          <tr>
            <th title="Приоритет">Пр.</th><th>Марш.</th><th>Окно</th><th className="n" title="Посадок в час пика окна">Посадок</th><th className="n" title="Загрузка в час пика окна, оценка">Загр., %</th>
            <th className="n" title="Интервал прогноза, % вместимости">Интервал</th><th className="n" title="Сутки маршрута к обычному такому же дню недели">К обычн.</th><th>Сутки</th><th>Причина</th><th className="n" title="Рейсов в час пика окна">Рейс/ч</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => {
            const dec = sc.decided(w)
            const v = values[w.key]
            const need = tripsNeeded(ctx, w, sc.days[w.route].load)
            const t = Math.round(tripsHour(ctx.s, w.route, w.peakHour, w.plan))
            const u = usual(w)
            const sel = w.route === route && hour >= w.from && hour < w.to
            const flash = seen && seen[w.key] !== undefined && seen[w.key] !== v
            return (
              <tr key={w.key} className={`${sel ? 'sel' : ''}${w.to <= now ? ' past' : ''}`} onClick={() => pickWindow(w)}>
                <td><Pri p={w.prio} /></td>
                <td><RNum id={w.route} /></td>
                <td title={span(w)}>{String(w.from).padStart(2, '0')}—{String(w.to).padStart(2, '0')}</td>
                <td className="n">{num(w.boardings)}</td>
                <td key={flash ? `f${v}` : 'v'} className={`n fill l${stepOf(v)}${v >= thr ? ' over' : ''}${flash ? ' flash' : ''}`}>{num(v)}</td>
                <td className="n">{num(w.band[0])}—{num(w.band[1])}</td>
                {usualCell(u)}
                <td><Spark load={sc.after[w.route]} from={w.from} to={w.to} peak={w.peakHour} /></td>
                <td className="why">{w.cause.label}</td>
                <td className="n">{dec ? <>{t} → <b>{t + dec.trips}</b></> : t}</td>
                <td className="act">
                  {dec ? <span className="ack">принято</span> : need ? (
                    <Button size="s" view="outlined-action" title={`Принять: +${trips(need)} в час`} onClick={(e) => { e.stopPropagation(); accept(w, need) }}>
                      <span className="b-btn">+{need}<Key k="a" /></span>
                    </Button>
                  ) : <span className="muted" title="Наблюдать: добавлять рейсы не нужно" aria-label="Наблюдать"><IconEye /></span>}
                </td>
              </tr>
            )
          })}
          {quiet.map((r) => {
            const d = sc.days[r.id]
            const v = Math.round(sc.after[r.id][d.peakHour])
            const sel = r.id === route && hour === d.peakHour
            return (
              <tr key={`q${r.id}`} className={`quiet${sel ? ' sel' : ''}`} onClick={() => pick(r.id, d.peakHour)}>
                <td><Pri p={0} /></td>
                <td><RNum id={r.id} /></td>
                <td title="Самый загруженный час дня">пик {hh(d.peakHour).slice(0, 2)}</td>
                <td className="n">{num(d.fc[d.peakHour])}</td>
                <td className={`n fill l${stepOf(v)}`}>{num(v)}</td>
                <td className="n">—</td>
                {usualCell(usualOf(r.id))}
                <td><Spark load={sc.after[r.id]} from={d.peakHour} to={d.peakHour + 1} peak={d.peakHour} /></td>
                <td className="why">ниже порога внимания</td>
                <td className="n">{Math.round(tripsHour(ctx.s, r.id, d.peakHour, d.plan))}</td>
                <td className="act"><span className="muted">—</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length || quiet.length ? null : <p className="b-empty">Окон риска впереди нет.</p>}
    </div>
  )
}
