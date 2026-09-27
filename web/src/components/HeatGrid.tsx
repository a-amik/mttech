import { useStore, type Mode } from '../store'
import { SegmentedRadioGroup } from '@gravity-ui/uikit'
import { num } from '../data'
import type { Ctx } from '../model'
import { STEP_LABELS, stepOf } from '../lib/scale'
import { pick } from '../actions'
import { HOURS, type Screen } from '../screen'
import { Key, RNum } from './Bits'

/** Шапка главной области: окна риска или вся сеть. Вид — в колонке разделов. */
export function CenterBar({ title, legend }: { title: string; legend?: React.ReactNode }) {
  const { mode, set } = useStore()
  return (
    <div className="b-bar">
      <h2>{title}</h2>
      <SegmentedRadioGroup size="m" value={mode} onUpdate={(v) => set({ mode: v as Mode })}
        options={[
          { value: 'exc', content: 'Окна риска' },
          { value: 'all', content: <span className="b-btn">Вся сеть<Key k="e" /></span> },
        ]} />
      {legend}
    </div>
  )
}

export function GridLegend({ ctx }: { ctx: Ctx }) {
  return (
    <div className="b-legend">
      {STEP_LABELS.map((l, i) => <span key={l}><i style={{ background: `var(--b-l${i})` }} />{l}{i === 4 ? ' %' : ''}</span>)}
      <span><i className="over" />порог {String(ctx.s.threshold_pct)} %</span>
      <span><i className="wide" />широкий разброс</span>
      <span><i className="done" />решение принято</span>
      <span className="est">загрузка — оценка{ctx.s.f_fare ? ', с безбилетниками' : ''}</span>
    </div>
  )
}

export default function HeatGrid({ ctx, sc }: { ctx: Ctx; sc: Screen }) {
  const { route, hour } = useStore()
  const { now, mode } = useStore()
  const thr = Number(ctx.s.threshold_pct)
  const warn = Number(ctx.s.warn_pct)

  return (
    <div className={`b-hm-wrap${mode === 'exc' ? ' exc' : ''}`}>
      <table className="b-hm" aria-label="Загрузка, маршрут × час">
        <thead>
          <tr>
            <th />
            {HOURS.map((h) => <th key={h} className={h === now ? 'now' : h === hour ? 'hsel' : ''} scope="col">{String(h).padStart(2, '0')}</th>)}
          </tr>
        </thead>
        <tbody>
          {ctx.ds.routes.map((r) => {
            const d = sc.days[r.id]
            const off = d.total === 0
            return (
              <tr key={r.id} className={r.id === route ? 'rsel' : ''}>
                <th scope="row" title={off ? 'Маршрут в этот день не работает' : r.name}>
                  <button type="button" onClick={() => pick(r.id, hour)}><RNum id={r.id} off={off} /></button>
                </th>
                {HOURS.map((h) => {
                  if (off) return <td key={h} className="off" />
                  const raw = d.load[h]
                  const v = sc.after[r.id][h]
                  const cls = [`l${stepOf(v)}`]
                  if (v >= thr && h >= now) cls.push('over')
                  if (sc.wide[r.id][h]) cls.push('wide')
                  if (h < now) cls.push('past')
                  if (raw < warn) cls.push('calm')
                  if (sc.extra[r.id][h]) cls.push('done')
                  if (r.id === route && h === hour) cls.push('sel')
                  return (
                    <td key={h} className={cls.join(' ')} onClick={() => pick(r.id, h)}
                      title={`Маршрут ${r.id}, ${String(h).padStart(2, '0')}:00 — ${num(v)} %${sc.extra[r.id][h] ? `, до решения ${num(raw)} %` : ''}`}>
                      {v >= 0.5 ? num(v) : ''}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
