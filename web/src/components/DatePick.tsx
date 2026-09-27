import { useEffect, useMemo, useRef, useState } from 'react'
import { Popup } from '@gravity-ui/uikit'
import { createPortal } from 'react-dom'
import { DAYS, DOW_SHORT, FACT_DAYS, MONTHS_NOM, dowOf, isoOf } from '../data'
import { isHoliday, routeDay, type Ctx } from '../model'
import { useStore } from '../store'
import { stepOf } from '../lib/scale'
import { IconCalendar } from '../lib/icons'
import { usePhone } from '../lib/media'

/** Самая высокая загрузка дня по сети и было ли превышение порога — для цвета клетки. */
function useDayPeaks(ctx: Ctx | null, open: boolean) {
  return useMemo(() => {
    if (!ctx || !open) return null
    const thr = Number(ctx.s.threshold_pct)
    return Array.from({ length: DAYS }, (_, i) => {
      const peak = Math.max(0, ...ctx.ds.routes.map((r) => routeDay(ctx, r.id, i).peakLoad))
      return { peak, over: peak >= thr }
    })
  }, [ctx, open])
}

/** Календарь окна экрана: сентябрь—октябрь с фактом, ноябрь—декабрь прогнозом. */
export default function DatePick({ ctx, label, note }: { ctx: Ctx | null; label: string; note?: string }) {
  const { day, set } = useStore()
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const peaks = useDayPeaks(ctx, open)
  const phone = usePhone()
  const sheetBody = useRef<HTMLDivElement>(null)
  // На телефоне месяцы идут столбиком: лист открывается на месяце выбранного дня.
  useEffect(() => {
    if (open && phone) sheetBody.current?.querySelector('.d.on')?.closest('.b-dp-m')?.scrollIntoView({ block: 'start' })
  }, [open, phone])

  // Месяцы окна: индекс первого дня каждого месяца.
  const months: number[] = []
  for (let i = 0; i < DAYS; i++) if (isoOf(i).endsWith('-01')) months.push(i)

  const choose = (i: number) => {
    set({ day: i, sim: null, extra: null })
    setOpen(false)
  }

  return (
    <>
      <button ref={btn} type="button" className="b-date" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} title="Выбрать день">
        <IconCalendar />
        <strong>{label}</strong>
        {note ? <em>{note}</em> : null}
      </button>
      {phone ? (open ? createPortal(
        <div className="b-sheet-wrap">
          <div className="b-sheet-bg" onClick={() => setOpen(false)} />
          <div className="b-sheet" role="dialog" aria-modal="true" aria-label="Выбор дня">
            <header><i className="grip" aria-hidden="true" /><button type="button" className="x" onClick={() => setOpen(false)}>Закрыть</button></header>
            <div className="b-sheet-body" ref={sheetBody}>
        <div className="b-dp" role="dialog" aria-label="Выбор дня">
          <div className="b-dp-months">
            {months.map((m0) => {
              const mon = Number(isoOf(m0).slice(5, 7))
              const len = months.find((x) => x > m0) ?? DAYS
              const lead = dowOf(m0)
              return (
                <div key={m0} className="b-dp-m">
                  <h4>{MONTHS_NOM[mon - 1]} 2025</h4>
                  <div className="b-dp-grid">
                    {DOW_SHORT.map((d) => <span key={d} className="h">{d}</span>)}
                    {Array.from({ length: lead }, (_, k) => <span key={`e${k}`} />)}
                    {Array.from({ length: len - m0 }, (_, k) => {
                      const i = m0 + k
                      const p = peaks?.[i]
                      const hol = ctx ? isHoliday(ctx, i) : false
                      const wk = dowOf(i) >= 5
                      return (
                        <button key={i} type="button" onClick={() => choose(i)}
                          className={`d${i === day ? ' on' : ''}${p?.over ? ' over' : ''}${hol || wk ? ' off' : ''}${i >= FACT_DAYS ? ' fc' : ''}`}
                          style={p ? { ['--lv' as string]: `var(--b-l${stepOf(p.peak)})` } : undefined}
                          title={p ? `${Math.round(p.peak)} % — самая высокая загрузка дня${hol ? ', будний выходной' : ''}` : undefined}>
                          {k + 1}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="b-dp-legend">
            <span><i className="lv" />цвет — пик загрузки дня по сети</span>
            <span><i className="ov" />выше порога</span>
            <span><i className="of" />выходной</span>
          </p>
        </div>
            </div>
          </div>
        </div>, document.body,
      ) : null) : (
      <Popup open={open} anchorElement={btn.current} placement="bottom" onOpenChange={setOpen}>
        <div className="b-dp" role="dialog" aria-label="Выбор дня">
          <div className="b-dp-months">
            {months.map((m0) => {
              const mon = Number(isoOf(m0).slice(5, 7))
              const len = months.find((x) => x > m0) ?? DAYS
              const lead = dowOf(m0)
              return (
                <div key={m0} className="b-dp-m">
                  <h4>{MONTHS_NOM[mon - 1]} 2025</h4>
                  <div className="b-dp-grid">
                    {DOW_SHORT.map((d) => <span key={d} className="h">{d}</span>)}
                    {Array.from({ length: lead }, (_, k) => <span key={`e${k}`} />)}
                    {Array.from({ length: len - m0 }, (_, k) => {
                      const i = m0 + k
                      const p = peaks?.[i]
                      const hol = ctx ? isHoliday(ctx, i) : false
                      const wk = dowOf(i) >= 5
                      return (
                        <button key={i} type="button" onClick={() => choose(i)}
                          className={`d${i === day ? ' on' : ''}${p?.over ? ' over' : ''}${hol || wk ? ' off' : ''}${i >= FACT_DAYS ? ' fc' : ''}`}
                          style={p ? { ['--lv' as string]: `var(--b-l${stepOf(p.peak)})` } : undefined}
                          title={p ? `${Math.round(p.peak)} % — самая высокая загрузка дня${hol ? ', будний выходной' : ''}` : undefined}>
                          {k + 1}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="b-dp-legend">
            <span><i className="lv" />цвет — пик загрузки дня по сети</span>
            <span><i className="ov" />выше порога</span>
            <span><i className="of" />выходной</span>
          </p>
        </div>
      </Popup>
      )}
    </>
  )
}
