import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, SegmentedRadioGroup, Slider } from '@gravity-ui/uikit'
import { Map as MapLibreMap, NavigationControl, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { FACT_DAYS, hh, idxOf, isoOf, loadLiveDay, num, ruDay, type LiveDay, type Tram } from '../data'
import { planDay, type Ctx } from '../model'
import { carsOf, loadPct } from '../settings'
import { useStore } from '../store'
import { cssVar, stepOf } from '../lib/scale'
import { RNum } from './Bits'
import { MapInfo } from './MapView'
import { plural } from '../actions'
import { baseStyle, registerBasemap, toneBase } from '../lib/basemap'

/** Средняя скорость вагона с остановками, м/мин: 15 км/ч — допущение, GPS в наборе нет. */
const SPEED_M_MIN = 250
/** Скорость показа: минут дня за секунду. */
const SPEEDS = [1, 5, 15]
const DEMO_DAY = '2025-10-14'

/** Вагон заметно нагружен сильнее соседей по маршруту в этот час — доля от медианы вагонов маршрута. Допущения. */
const HIGH_RATIO = 1.25
const OVER_RATIO = 1.6

type Path = { pts: number[][]; cum: number[]; len: number }

/** Состояние вагона в этот час: норма, выше нормы, перегружен, валидатор молчит на линии; по ГЛОНАСС — на связи или нет. */
export type TramStatus = 'ok' | 'high' | 'over' | 'silent' | 'lost'
export const STATUS_LABEL: Record<TramStatus, string> = { ok: 'норма', high: 'выше нормы', over: 'перегружен', silent: 'нет валидаций на линии', lost: 'нет связи' }
// Цвета — токены экрана: норма — синий шкалы загрузки, выше нормы — «внимание», перегружен — красный порога.
const STATUS_VAR: Record<TramStatus, string> = { ok: '--b-l3', high: '--b-warn', over: '--b-over', silent: '--b-text-3', lost: '--b-text-3' }

/** Отметка ГЛОНАСС из /api/vehicles: последнее положение вагона и давность связи. */
export interface Mark { board: string; route: string; lat: number; lon: number; speed: number; course: number; time: string; age: number; stale: boolean }
interface Marks { now: string; staleAfter: number; vehicles: number; online: number; items: Mark[] }
/** Как часто экран спрашивает сервис о положении вагонов, мс. */
const MARKS_POLL_MS = 5000

/** Координаты от сервиса. Экран, открытый без сервиса (npm run dev, статика), их не получит — тогда null. */
export function useMarks(): Marks | null {
  const [marks, setMarks] = useState<Marks | null>(null)
  useEffect(() => {
    let alive = true
    const pull = () => fetch('/api/vehicles', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setMarks(j && Array.isArray(j.items) && j.vehicles > 0 ? j : null) })
      .catch(() => { if (alive) setMarks(null) })
    pull()
    const id = setInterval(pull, MARKS_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])
  return marks
}

function statusOf(tram: Tram, h: number, median: number): TramStatus {
  const b = tram.hours[h] ?? 0
  if (b === 0) return 'silent'
  if (median > 0 && b >= OVER_RATIO * median) return 'over'
  if (median > 0 && b >= HIGH_RATIO * median) return 'high'
  return 'ok'
}

const medianOf = (xs: number[]) => {
  const v = xs.filter((x) => x > 0).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : 0
}

/** Направление движения, градусы от севера: по месту вагона сейчас и через полминуты. */
function bearing(a: number[], b: number[]) {
  const dx = (b[0] - a[0]) * Math.cos((55.75 * Math.PI) / 180)
  const dy = b[1] - a[1]
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
}

const PR = 2
function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w * PR
  c.height = h * PR
  const g = c.getContext('2d')!
  g.scale(PR, PR)
  return { c, g }
}

/** Метка вагона: круг цвета состояния с белой обводкой и выступом по курсу; карта поворачивает её. */
function puckImage(color: string, ring: string) {
  const S = 30
  const { c, g } = canvas(S, S)
  const cx = S / 2
  const cy = S / 2
  g.shadowColor = 'rgba(0,0,0,0.35)'
  g.shadowBlur = 3
  g.shadowOffsetY = 1
  // выступ-стрелка над кругом — туда, куда едет вагон
  g.beginPath()
  g.moveTo(cx, 2)
  g.lineTo(cx + 6, cy - 4)
  g.lineTo(cx - 6, cy - 4)
  g.closePath()
  g.fillStyle = ring
  g.fill()
  g.shadowColor = 'transparent'
  g.beginPath()
  g.arc(cx, cy + 1, 9, 0, Math.PI * 2)
  g.fillStyle = ring
  g.fill()
  g.beginPath()
  g.moveTo(cx, 5)
  g.lineTo(cx + 4, cy - 4)
  g.lineTo(cx - 4, cy - 4)
  g.closePath()
  g.fillStyle = color
  g.fill()
  g.beginPath()
  g.arc(cx, cy + 1, 7, 0, Math.PI * 2)
  g.fillStyle = color
  g.fill()
  return g.getImageData(0, 0, c.width, c.height)
}

interface Look { bg: string; text: string; sub: string; accent: string; alert: string }

/** Подпись вагона в стиле флажков карты: подложка темы, полоса состояния слева, номер маршрута и бортовой. */
function labelImage(route: string, board: string, stripe: string, look: Look, problem: boolean, on: boolean) {
  const bold = '700 13px "Golos Text", system-ui, sans-serif'
  const reg = '400 13px "Golos Text", system-ui, sans-serif'
  const probe = canvas(1, 1).g
  probe.font = bold
  const rw = Math.ceil(probe.measureText(route).width)
  probe.font = reg
  const bw = Math.ceil(probe.measureText(board).width)
  const M = 4
  const boxW = 5 + 7 + rw + 6 + bw + 8 + (problem ? 22 : 0)
  const boxH = 24
  const { c, g } = canvas(boxW + M * 2, boxH + M * 2)
  g.translate(M, M)
  g.shadowColor = 'rgba(0,0,0,0.3)'
  g.shadowBlur = 4
  g.shadowOffsetY = 1
  g.beginPath()
  g.roundRect(0, 0, boxW, boxH, 6)
  g.fillStyle = look.bg
  g.fill()
  g.shadowColor = 'transparent'
  if (on) { g.lineWidth = 2; g.strokeStyle = look.accent; g.stroke() }
  g.save()
  g.clip()
  g.fillStyle = stripe
  g.fillRect(0, 0, 5, boxH)
  g.restore()
  g.textBaseline = 'middle'
  g.font = bold
  g.fillStyle = look.text
  g.fillText(route, 12, boxH / 2 + 0.5)
  g.font = reg
  g.fillStyle = look.sub
  g.fillText(board, 12 + rw + 6, boxH / 2 + 0.5)
  if (problem) {
    const cx = boxW - 13
    g.beginPath()
    g.arc(cx, boxH / 2, 8, 0, Math.PI * 2)
    g.fillStyle = look.alert
    g.fill()
    g.fillStyle = '#ffffff'
    g.font = '700 12px "Golos Text", system-ui, sans-serif'
    g.textAlign = 'center'
    g.fillText('!', cx, boxH / 2 + 0.5)
  }
  return g.getImageData(0, 0, c.width, c.height)
}

const metres = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * 111_320 * Math.cos((55.75 * Math.PI) / 180), (a[1] - b[1]) * 111_320)

function makePath(pts: number[][]): Path {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1], pts[i]))
  return { pts, cum, len: cum[cum.length - 1] }
}

/** Место вагона: едет от первой валидации туда-обратно по пути маршрута. Восстановлено, не измерено. */
function placeOf(p: Path, tram: Tram, t: number): number[] {
  const lap = 2 * p.len
  let s = ((t - tram.first) * SPEED_M_MIN + (Number(tram.board) % 7) * 180) % lap
  if (s > p.len) s = lap - s
  let i = 1
  while (i < p.cum.length - 1 && p.cum[i] < s) i++
  const seg = p.cum[i] - p.cum[i - 1] || 1
  const k = (s - p.cum[i - 1]) / seg
  const a = p.pts[i - 1]
  const b = p.pts[i]
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
}

export default function LiveView({ ctx }: { ctx: Ctx }) {
  const { theme } = useStore()
  // Показ идёт по дню с сырыми валидациями: выбран день прогноза — берётся показательный октябрьский.
  const picked = useStore((st) => st.day)
  const day = picked < FACT_DAYS ? picked : idxOf(DEMO_DAY)
  const [data, setData] = useState<LiveDay | null>(null)
  const [t, setT] = useState(8 * 60)
  const [play, setPlay] = useState(true)
  const [speed, setSpeed] = useState(5)
  const [sel, setSel] = useState<{ route: string; board: string } | null>(null)
  const [focus, setFocus] = useState('')
  const node = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const ready = useRef(false)
  const tRef = useRef(t)
  tRef.current = t
  const marks = useMarks()
  const [source, setSource] = useState<'glonass' | 'sim'>('glonass')
  const live = source === 'glonass' && marks !== null
  useEffect(() => {
    setData(null)
    loadLiveDay(isoOf(day)).then(setData)
  }, [day])

  const paths = useMemo(() => Object.fromEntries(
    Object.entries(ctx.ds.network?.task ?? {}).map(([id, pts]) => [id, makePath(pts)])), [ctx.ds.network])

  const h = Math.min(23, Math.floor(t / 60))
  const loadAt = (route: string, hour: number) => loadPct(ctx.s, route, hour, ctx.ds.series.fact[route]?.[day]?.[hour] ?? 0, planDay(ctx, route, day).trips)

  // Вагоны на линии в минуту t.
  const active = (route: string) => (data?.[route] ?? []).filter((x) => x.first <= t && t <= x.last && x.last - x.first > 30)

  const statusMap = () => {
    const out: Record<string, TramStatus> = {}
    for (const r of ctx.ds.routes) {
      const list = active(r.id)
      const med = medianOf(list.map((x) => x.hours[h] ?? 0))
      for (const x of list) out[x.board] = statusOf(x, h, med)
    }
    return out
  }

  const placed = () => {
    if (live) {
      return marks.items.filter((x) => !focus || x.route === focus).map((x) => ({
        route: x.route, board: x.board, status: (x.stale ? 'lost' : 'ok') as TramStatus, at: [x.lon, x.lat], dir: x.course,
      }))
    }
    const st = statusMap()
    const out: { route: string; board: string; status: TramStatus; at: number[]; dir: number }[] = []
    for (const r of ctx.ds.routes) {
      const p = paths[r.id]
      if (!p || !data || (focus && focus !== r.id)) continue
      for (const tram of active(r.id)) {
        const at = placeOf(p, tram, tRef.current)
        out.push({ route: r.id, board: tram.board, status: st[tram.board] ?? 'ok', at, dir: bearing(at, placeOf(p, tram, tRef.current + 0.5)) })
      }
    }
    return out
  }

  // Карта: пути маршрутов и вагоны.
  useEffect(() => {
    if (!node.current) return
    registerBasemap()
    const m = new MapLibreMap({ container: node.current, style: baseStyle(), center: [37.64, 55.77], zoom: 10.6, attributionControl: { compact: true } })
    map.current = m
    m.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    m.on('style.load', () => {
      const tracks = Object.entries(ctx.ds.network?.tracks ?? {}).map(([id, lines]) => ({
        type: 'Feature', properties: { route: id }, geometry: { type: 'MultiLineString', coordinates: lines } }))
      m.addSource('tracks', { type: 'geojson', data: { type: 'FeatureCollection', features: tracks } as never })
      m.addLayer({ id: 'tracks', type: 'line', source: 'tracks', paint: { 'line-color': cssVar('--b-accent'), 'line-width': 2.5, 'line-opacity': 0.45 } })
      // Остановки — полыми кружками на трассе, как у Optibus.
      const stops = ctx.ds.routes.flatMap((r) => r.stops.map((x) => ({ type: 'Feature', properties: { route: r.id }, geometry: { type: 'Point', coordinates: [x.lon, x.lat] } })))
      m.addSource('stops', { type: 'geojson', data: { type: 'FeatureCollection', features: stops } as never })
      m.addLayer({
        id: 'stops', type: 'circle', source: 'stops', minzoom: 11,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 15, 5],
          'circle-color': cssVar('--b-surface'),
          'circle-stroke-color': cssVar('--b-accent'),
          'circle-stroke-width': 1.5,
        },
      })
      m.addSource('trams', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'trams', type: 'symbol', source: 'trams',
        layout: {
          'icon-image': ['get', 'puck'], 'icon-rotate': ['get', 'dir'], 'icon-rotation-alignment': 'map',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 13, 1, 16, 1.2], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
      })
      // Номер у каждого вагона — с приближения; у вагонов с проблемой, выбранного и выбранного маршрута — всегда.
      const label = (id: string, filter: unknown[], minzoom?: number) => m.addLayer({
        id, type: 'symbol', source: 'trams', filter: filter as never, ...(minzoom ? { minzoom } : {}),
        layout: {
          'icon-image': ['get', 'lbl'], 'icon-anchor': 'left', 'icon-offset': [10, 0], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.85, 13, 1],
        },
      })
      label('labels-all', ['==', ['get', 'pin'], 0], 12.5)
      label('labels-pin', ['==', ['get', 'pin'], 1])
      ready.current = true
      toneBase(m)
    })
    for (const layer of ['trams', 'labels-all', 'labels-pin']) {
      m.on('click', layer, (e: MapLayerMouseEvent) => {
        const p = e.features?.[0]?.properties
        if (p) setSel({ route: String(p.route), board: String(p.board) })
      })
      m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'))
      m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''))
    }
    return () => { m.remove(); map.current = null; ready.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (m) toneBase(m)
  }, [theme])

  // Ход времени: минута дня за кадр по скорости показа.
  useEffect(() => {
    if (!play || live) return
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const next = tRef.current + dt * speed
      setT(next >= 24 * 60 ? 5 * 60 : next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [play, speed, live])

  useEffect(() => {
    const m = map.current
    if (!ready.current || !m) return
    const look: Look = { bg: cssVar('--b-float'), text: cssVar('--b-text'), sub: cssVar('--b-text-2'), accent: cssVar('--b-accent'), alert: cssVar('--b-over') }
    const features = placed().map((x) => {
      const on = sel?.board === x.board
      const problem = x.status === 'over' || x.status === 'silent'
      const color = cssVar(STATUS_VAR[x.status])
      const puck = `puck-${theme}-${x.status}`
      if (!m.hasImage(puck)) m.addImage(puck, puckImage(color, cssVar('--b-surface')), { pixelRatio: PR })
      const lbl = `lbl-${theme}-${x.board}-${x.status}-${on ? 1 : 0}`
      if (!m.hasImage(lbl)) m.addImage(lbl, labelImage(x.route, x.board, color, look, problem, on), { pixelRatio: PR })
      return {
        type: 'Feature',
        properties: { route: x.route, board: x.board, status: x.status, dir: x.dir, puck, lbl, pin: problem || on || (focus && x.route === focus) ? 1 : 0 },
        geometry: { type: 'Point', coordinates: x.at },
      }
    })
    ;(m.getSource('trams') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features } as never)
  })

  const onLine = ctx.ds.routes.map((r) => ({ r, trams: active(r.id) }))
  const total = live ? marks.online : onLine.reduce((a, x) => a + x.trams.length, 0)
  const markOf = (board: string) => marks?.items.find((x) => x.board === board)
  const byRoute = (id: string) => marks?.items.filter((x) => x.route === id) ?? []
  const taskIds = new Set(ctx.ds.routes.map((r) => r.id))
  const elsewhere = live ? marks.items.filter((x) => !taskIds.has(x.route)).length : 0
  const tram = sel ? data?.[sel.route]?.find((x) => x.board === sel.board) : undefined
  const clock = live
    ? new Date(marks.now).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
    : `${hh(h).slice(0, 2)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
  const mark = live && sel ? markOf(sel.board) : undefined

  return (
    <>
      <aside className="b-side" aria-label="Живой день">
        <div className="b-live-head">
          <div className="b-clock">{clock}</div>
          <div>
            <b>{live ? 'Сейчас, ГЛОНАСС' : ruDay(day)}</b>
            <span>на {live ? 'связи' : 'линии'} {total} {plural(total, 'вагон', 'вагона', 'вагонов')}</span>
          </div>
        </div>
        {marks ? (
          <div className="b-live-ctl">
            <SegmentedRadioGroup size="m" value={source} onUpdate={(v) => { setSource(v as 'glonass' | 'sim'); setSel(null) }}
              options={[{ value: 'glonass', content: 'ГЛОНАСС' }, { value: 'sim', content: 'По валидациям' }]} />
          </div>
        ) : null}
        {live ? (
          <p className="b-live-legend">
            <span><i className="arr ok" />на связи</span>
            <span><i className="arr lost" />нет связи дольше {marks.staleAfter} с <b className="al">!</b></span>
          </p>
        ) : (
          <p className="b-live-legend">
            <span><i className="arr ok" />норма</span>
            <span><i className="arr high" />выше нормы</span>
            <span><i className="arr over" />перегружен <b className="al">!</b></span>
            <span><i className="arr silent" />нет валидаций <b className="al">!</b></span>
          </p>
        )}
        {live ? null : <>
        <div className="b-live-ctl">
          <Button view={play ? 'outlined' : 'action'} size="m" onClick={() => setPlay(!play)}>{play ? 'Пауза' : 'Пуск'}</Button>
          <SegmentedRadioGroup size="m" value={String(speed)} onUpdate={(v) => setSpeed(Number(v))}
            options={SPEEDS.map((v) => ({ value: String(v), content: `${v} мин/с` }))} />
        </div>
        <div className="b-live-slider">
          <Slider size="s" min={300} max={1439} step={1} value={Math.floor(t)} onUpdate={(v) => setT(v as number)} tooltipDisplay="off" aria-label="Время дня"
            marks={[300, 720, 1080, 1439]} markFormat={(v) => (v >= 1439 ? '24:00' : hh(Math.floor(v / 60)))} />
        </div>
        </>}
        <section className="b-fold">
          <header><button type="button" onClick={() => setFocus('')}><b>Маршруты</b><span className="n">{focus ? `только ${focus}` : 'все'}</span></button></header>
          {live ? ctx.ds.routes.map((r) => {
            const list = byRoute(r.id)
            const on = list.filter((x) => !x.stale).length
            return (
              <div key={r.id}>
                <button type="button" className={`b-live-r${focus === r.id ? ' sel' : ''}`} aria-expanded={focus === r.id} onClick={() => setFocus(focus === r.id ? '' : r.id)}>
                  <RNum id={r.id} off={!on} />
                  <span className="c">{on} {plural(on, 'вагон', 'вагона', 'вагонов')}</span>
                  <span className="p">{list.length - on ? `${list.length - on} без связи` : ''}</span>
                </button>
                {focus === r.id ? (
                  <div className="b-trams">
                    {list.map((x) => (
                      <button key={x.board} type="button" className={sel?.board === x.board ? 'on' : undefined}
                        onClick={() => { setSel({ route: r.id, board: x.board }); map.current?.easeTo({ center: [x.lon, x.lat], zoom: 14, duration: 600 }) }}>
                        <b>{x.board}</b><span>{num(Math.round(x.speed))} км/ч</span><span>{x.stale ? 'нет связи' : `${x.age} с назад`}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          }) : onLine.map(({ r, trams }) => {
            const load = loadAt(r.id, h)
            const pax = trams.reduce((a, x) => a + (x.hours[h] ?? 0), 0)
            return (
              <div key={r.id}>
                <button type="button" className={`b-live-r${focus === r.id ? ' sel' : ''}`} aria-expanded={focus === r.id} onClick={() => setFocus(focus === r.id ? '' : r.id)}>
                  <RNum id={r.id} off={!trams.length} />
                  <span className="c">{trams.length} {plural(trams.length, 'вагон', 'вагона', 'вагонов')}</span>
                  <span className="p">{num(pax)} пос./ч</span>
                  <span className="v" style={{ ['--lv' as string]: `var(--b-l${stepOf(load)})` }}>{num(load)} %</span>
                </button>
                {focus === r.id ? (
                  <div className="b-trams">
                    {trams.map((x) => (
                      <button key={x.board} type="button" className={sel?.board === x.board ? 'on' : undefined}
                        onClick={() => { setSel({ route: r.id, board: x.board }); const p = paths[r.id]; if (p) map.current?.easeTo({ center: placeOf(p, x, tRef.current) as [number, number], zoom: 14, duration: 600 }) }}>
                        <b>{x.board}</b><span>выход {x.exit ?? '—'}</span><span>{num(x.hours[h] ?? 0)} пос./ч</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </section>
        {live && elsewhere ? <p className="b-muted b-live-note">Ещё {elsewhere} {plural(elsewhere, 'вагон', 'вагона', 'вагонов')} на других маршрутах сети — на карте.</p> : null}
        {mark ? (
          <section className="b-tele">
            <h4>Телеметрия вагона</h4>
            <dl>
              <dt>Бортовой номер</dt><dd>{mark.board}</dd>
              <dt>Связь</dt><dd className={`st ${mark.stale ? 'lost' : 'ok'}`}>{mark.stale ? `нет связи ${mark.age} с` : `отметка ${mark.age} с назад`}</dd>
              <dt>Маршрут</dt><dd>{mark.route || '—'}</dd>
              <dt>Скорость</dt><dd>{num(Math.round(mark.speed))} км/ч</dd>
              <dt>Курс</dt><dd>{Math.round(mark.course)}°</dd>
              <dt>Координаты</dt><dd>{mark.lat.toFixed(5)}, {mark.lon.toFixed(5)}</dd>
            </dl>
          </section>
        ) : !live && tram && sel ? (
          <section className="b-tele">
            <h4>Телеметрия вагона</h4>
            <dl>
              <dt>Бортовой номер</dt><dd>{tram.board}</dd>
              <dt>Состояние</dt><dd className={`st ${statusMap()[tram.board] ?? 'ok'}`}>{STATUS_LABEL[statusMap()[tram.board] ?? 'ok']}</dd>
              <dt>Маршрут, выход</dt><dd>{sel.route}, выход {tram.exit ?? '—'}</dd>
              <dt>Площадка</dt><dd>{tram.place ?? '—'}</dd>
              <dt>Машинист</dt><dd className="na">в&nbsp;данных нет — по&nbsp;выходу {tram.exit ?? '—'} берётся из&nbsp;наряда депо</dd>
              <dt>Состав</dt><dd>{carsOf(ctx.s, sel.route)} {plural(carsOf(ctx.s, sel.route), 'вагон', 'вагона', 'вагонов')} · настройка маршрута</dd>
              <dt>На линии</dt><dd>{hh(Math.floor(tram.first / 60)).slice(0, 2)}:{String(tram.first % 60).padStart(2, '0')}—{hh(Math.floor(tram.last / 60) % 24).slice(0, 2)}:{String(tram.last % 60).padStart(2, '0')}</dd>
              <dt>Посадок за день</dt><dd>{num(tram.hours.reduce((a, x) => a + x, 0))}</dd>
              <dt>В этот час</dt><dd>{num(tram.hours[h] ?? 0)}</dd>
            </dl>
            <div className="b-tele-bars" aria-label="Посадки по часам">
              {tram.hours.slice(5).map((v, i) => (
                <i key={i} className={i + 5 === h ? 'on' : undefined} style={{ height: `${(v / Math.max(1, ...tram.hours)) * 100}%` }} title={`${hh(i + 5)} — ${v}`} />
              ))}
            </div>
          </section>
        ) : (
          <p className="b-muted b-live-note">Нажмите на вагон на карте или в списке маршрута — откроется его телеметрия.</p>
        )}
      </aside>
      <main className="b-main b-live">
        <div className="b-map-full"><div ref={node} style={{ width: '100%', height: '100%' }} /></div>
        {live ? (
          <MapInfo>
            <b>Положение вагонов — ГЛОНАСС.</b> Отметки приходят в сервис от навигационной платформы,
            экран обновляет их раз в {MARKS_POLL_MS / 1000} с. Вагон, от которого нет отметок дольше {marks.staleAfter} с, серый:
            связь потеряна, место на карте — последнее известное. Нули вместо координат, скачки и опоздавшие
            отметки сервис отбрасывает до карты.
          </MapInfo>
        ) : <MapInfo>
          <b>Движение вагонов — имитация.</b> GPS и направления в данных нет: вагон ставится на трассу от первой
          валидации и едет туда-обратно с постоянной скоростью, поэтому место и курс на карте условные.
          Настоящие — какие вагоны вышли на линию (бортовой номер, выход, площадка), время на линии и посадки
          каждого вагона по часам.
          <br /><br />Метка — трамвай, выступ — условное направление; на плашке — маршрут и бортовой номер. Нагрузку
          вагона сравниваем с другими вагонами маршрута в этот час.
        </MapInfo>}
      </main>
    </>
  )
}
