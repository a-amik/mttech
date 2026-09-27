import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, Marker, NavigationControl, Popup, type GeoJSONSource, type LngLatBoundsLike, type MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { routeDay, type Ctx } from '../model'
import { useStore } from '../store'
import { pick } from '../actions'
import { cssVar, stepOf } from '../lib/scale'
import { baseStyle, registerBasemap, toneBase } from '../lib/basemap'

const PAD = { top: 40, bottom: 40, left: 50, right: 50 }

type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }
type FC = { type: 'FeatureCollection'; features: Feature[] }

/** Остальные трамваи Москвы фоном: прогноза по ним нет, отключённые на стенде — пунктиром. */
function buildNet(ctx: Ctx): FC {
  const net = ctx.s.show_network ? ctx.ds.network?.routes ?? [] : []
  const off = new Set(ctx.adj.off ?? [])
  return {
    type: 'FeatureCollection',
    features: net.map((r) => ({
      type: 'Feature',
      properties: {
        route: r.id, name: r.name, off: off.has(r.id) ? 1 : 0,
        shared: Object.entries(r.overlap).map(([id, v]) => `${id} (${Math.round(v * 100)} %)`).join(', '),
      },
      geometry: { type: 'MultiLineString', coordinates: r.lines },
    })),
  }
}

/** Маршруты на карте: отмеченные в панели и с выбранной площадки; выбранный виден всегда. */
export function visibleRoutes(ctx: Ctx, mapHidden: string[], place: string, selected: string) {
  return ctx.ds.routes.filter((r) => r.id === selected
    || (!mapHidden.includes(r.id) && (!place || ctx.ds.depots?.[r.id]?.[0]?.[0] === place)))
}

export interface Flag { route: string; lon: number; lat: number; load: number; over: boolean; step: number }

function build(ctx: Ctx, day: number, hour: number, selected: string, show: Set<string>): { lines: FC; stops: FC; flags: Flag[] } {
  const steps = [0, 1, 2, 3, 4].map((i) => cssVar(`--b-l${i}`))
  const accent = cssVar('--b-accent')
  const idle = cssVar('--b-line-2')
  const threshold = Number(ctx.s.threshold_pct)
  const lines: Feature[] = []
  const stops: Feature[] = []
  const flags: Flag[] = []
  for (const r of ctx.ds.routes) {
    if (!r.stops.length || !show.has(r.id)) continue
    const d = routeDay(ctx, r.id, day)
    const on = r.id === selected
    const track = ctx.ds.network?.tracks?.[r.id]
    // Линия — по трассе OSM, цвет — загрузка часа по шкале; выбранный маршрут толще и синий.
    lines.push({
      type: 'Feature',
      properties: { route: r.id, color: on ? accent : d.total ? steps[stepOf(d.load[hour])] : idle, width: on ? 6 : 3.5, sort: on ? 1 : 0 },
      geometry: track ? { type: 'MultiLineString', coordinates: track } : { type: 'LineString', coordinates: r.stops.map((s) => [s.lon, s.lat]) },
    })
    // Остановки без загрузки: в валидациях остановки нет, загрузка есть только у часа маршрута.
    r.stops.forEach((s) => {
      stops.push({
        type: 'Feature',
        properties: { route: r.id, name: s.name, color: on ? accent : idle, on: on ? 1 : 0 },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      })
    })
    // Флажок маршрута с загрузкой часа — в середине линии, как флажки машин у Optibus.
    if (d.total) {
      const mid = r.stops[Math.floor(r.stops.length / 2)]
      const load = d.load[hour]
      flags.push({ route: r.id, lon: mid.lon, lat: mid.lat, load, over: load >= threshold, step: stepOf(load) })
    }
  }
  return { lines: { type: 'FeatureCollection', features: lines }, stops: { type: 'FeatureCollection', features: stops }, flags }
}

function boundsOf(ctx: Ctx, route: string): LngLatBoundsLike | null {
  const pts = (ctx.ds.routes.find((r) => r.id === route)?.stops.length ? ctx.ds.routes.filter((r) => r.id === route) : ctx.ds.routes)
    .flatMap((r) => r.stops)
  if (!pts.length) return null
  const lons = pts.map((p) => p.lon)
  const lats = pts.map((p) => p.lat)
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
}

/** Пояснение к карте — за кнопкой «i», а не поверх карты. */
export function MapInfo({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="b-map-i">
      <button type="button" aria-expanded={open} aria-label="Что на карте" title="Что на карте" onClick={() => setOpen(!open)}>i</button>
      {open ? <div className="b-map-note">{children}</div> : null}
    </div>
  )
}

export default function MapView({ ctx }: { ctx: Ctx }) {
  const node = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const ready = useRef(false)
  const { day, hour, route, theme, mapHidden, place, set } = useStore()
  const markers = useRef<Marker[]>([])
  const [failed, setFailed] = useState(false)
  const [slow, setSlow] = useState(false)
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  const paint = () => {
    const m = map.current
    if (!m || !ready.current) return
    const st = useStore.getState()
    const show = new Set(visibleRoutes(ctxRef.current, st.mapHidden, st.place, st.route).map((r) => r.id))
    const data = build(ctxRef.current, st.day, st.hour, st.route, show)
    ;(m.getSource('lines') as GeoJSONSource | undefined)?.setData(data.lines as never)
    for (const mk of markers.current) mk.remove()
    markers.current = data.flags.map((f) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = `b-flag l${f.step}${f.over ? ' over' : ''}${f.route === st.route ? ' on' : ''}`
      el.innerHTML = `<b>${f.route}</b>${Math.round(f.load)}&nbsp;%`
      el.title = `Маршрут ${f.route}: загрузка ${Math.round(f.load)} % в ${String(st.hour).padStart(2, '0')}:00, оценка`
      el.addEventListener('click', (e) => { e.stopPropagation(); pick(f.route, useStore.getState().hour) })
      return new Marker({ element: el, anchor: 'bottom-left', offset: [-2, -4] }).setLngLat([f.lon, f.lat]).addTo(m)
    })
    ;(m.getSource('stops') as GeoJSONSource | undefined)?.setData(data.stops as never)
    ;(m.getSource('net') as GeoJSONSource | undefined)?.setData(buildNet(ctxRef.current) as never)
  }

  useEffect(() => {
    if (!node.current) return
    registerBasemap()
    let m: MapLibreMap
    try {
      m = new MapLibreMap({
        container: node.current,
        style: baseStyle(),
        center: [37.66, 55.76],
        zoom: 10.3,
        maxBounds: [[35.5, 54.2], [39.5, 56.9]],
        attributionControl: { compact: true },
      })
    } catch {
      setFailed(true)
      return
    }
    map.current = m
    m.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 10 })

    const addLayers = () => {
      ready.current = false
      if (!m.getSource('net')) m.addSource('net', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      if (!m.getLayer('net')) m.addLayer({
        id: 'net', type: 'line', source: 'net', filter: ['==', ['get', 'off'], 0],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': cssVar('--b-text-3'), 'line-width': 1.8, 'line-opacity': 0.8 },
      })
      if (!m.getLayer('net-off')) m.addLayer({
        id: 'net-off', type: 'line', source: 'net', filter: ['==', ['get', 'off'], 1],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': cssVar('--b-over'), 'line-width': 2, 'line-dasharray': [2, 2] },
      })
      if (!m.getSource('lines')) m.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      if (!m.getSource('stops')) m.addSource('stops', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      if (!m.getLayer('lines')) m.addLayer({
        id: 'lines', type: 'line', source: 'lines',
        layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['get', 'sort'] },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] },
      })
      if (!m.getLayer('stops')) m.addLayer({
        id: 'stops', type: 'circle', source: 'stops',
        layout: { 'circle-sort-key': ['get', 'on'] },
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['==', ['get', 'on'], 1], 5, 3.5], 14, ['case', ['==', ['get', 'on'], 1], 9, 6]],
          'circle-stroke-width': 1,
          'circle-stroke-color': cssVar('--b-surface'),
        },
      })
      ready.current = true
      paint()
      tone()
    }
    // У жюри интернета может не быть: тайл не пришёл — говорим об этом, линии остаются.
    m.on('error', (e) => {
      if (/pmtiles|moscow|tile/i.test(String(e.error?.message ?? ''))) setSlow(true)
    })
    m.on('style.load', addLayers)
    m.on('load', () => {
      const b = boundsOf(ctxRef.current, useStore.getState().route)
      if (b) m.fitBounds(b, { padding: PAD, duration: 0 })
    })
    for (const layer of ['stops', 'lines']) {
      m.on('click', layer, (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.route
        if (id) set({ route: String(id), extra: null })
      })
      m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'))
      m.on('mouseleave', layer, () => {
        m.getCanvas().style.cursor = ''
        popup.remove()
      })
    }
    for (const layer of ['net', 'net-off']) {
      m.on('mousemove', layer, (e: MapLayerMouseEvent) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        m.getCanvas().style.cursor = 'help'
        popup
          .setLngLat(e.lngLat)
          .setHTML(`<b>Маршрут ${p.route}${p.off ? ' · отключён' : ''}</b><br>${p.name}<br>вне задания, прогноза нет${p.shared ? `<br>общие остановки: ${p.shared}` : ''}`)
          .addTo(m)
      })
      m.on('mouseleave', layer, () => {
        m.getCanvas().style.cursor = ''
        popup.remove()
      })
    }
    m.on('mousemove', 'stops', (e: MapLayerMouseEvent) => {
      const p = e.features?.[0]?.properties
      if (!p) return
      popup
        .setLngLat(e.lngLat)
        .setHTML(`<b>${p.name}</b><br>маршрут ${p.route}`)
        .addTo(m)
    })
    return () => {
      m.remove()
      map.current = null
      ready.current = false
    }
  }, [set])

  // Смена темы: подложка, постоянные цвета слоёв и данные маршрутов перекрашиваются без перезагрузки.
  const tone = () => {
    const m = map.current
    if (!m) return
    toneBase(m)
    const setPaint = m.setPaintProperty.bind(m) as (l: string, k: string, v: unknown) => void
    if (m.getLayer('net')) setPaint('net', 'line-color', cssVar('--b-text-3'))
    if (m.getLayer('net-off')) setPaint('net-off', 'line-color', cssVar('--b-over'))
    if (m.getLayer('stops')) setPaint('stops', 'circle-stroke-color', cssVar('--b-surface'))
    paint()
  }
  useEffect(tone, [theme])

  useEffect(paint, [ctx, day, hour, route, mapHidden, place])

  useEffect(() => {
    const b = boundsOf(ctxRef.current, route)
    if (b && map.current) map.current.fitBounds(b, { padding: PAD, duration: 600, maxZoom: 13.5 })
  }, [route])

  const mos = ctx.ds.routes.filter((r) => r.source === 'mos').map((r) => r.id)
  return (
    <>
      <div className="b-map"><div ref={node} style={{ width: '100%', height: '100%' }} /></div>
      {failed ? (
        <div className="b-map-note" style={{ top: 'auto', bottom: 12 }}>
          <b>Карта не запустилась:</b> браузеру не хватает WebGL2. Список, графики и поправки работают без неё.
        </div>
      ) : null}
      <MapInfo>
        <b>Загрузка — у часа маршрута, не у остановки:</b> в валидациях остановки нет. Флажок стоит в середине линии.
        {mos.length ? <> Трассы {mos.join(', ')} — открытые данные Москвы, набор 752; порядок остановок восстановлен по близости.</> : null}
        {ctx.s.show_network && ctx.ds.network ? <> Тонкие серые — остальные трамваи Москвы (OpenStreetMap), прогноза по ним нет; пунктир — отключены на стенде.</> : null}
        {slow ? <> Подложка карты не загрузилась — линии показаны без улиц.</> : null}
      </MapInfo>
    </>
  )
}
