import { addProtocol, type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { cssVar } from './scale'

// Подложка едет внутри образа: у жюри интернета нет, а карта нужна с улицами.
// Срез Москвы собран из выгрузки OpenStreetMap (tools/basemap.sh), зумы 6—14,
// четыре слоя без подписей — без них не нужен набор глифов, а названия улиц
// диспетчеру не нужны: ориентир даёт трасса маршрута.
export const BASEMAP_URL = 'pmtiles:///tiles/moscow.pmtiles'
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

let registered = false
export function registerBasemap() {
  if (registered) return
  addProtocol('pmtiles', new Protocol().tile)
  registered = true
}

const MAJOR = ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link']

/** Цвета слоёв подложки: только токены темы, литералов здесь нет. */
export function basePaint() {
  return {
    bg: cssVar('--b-map-bg'),
    water: cssVar('--b-map-water'),
    green: cssVar('--b-map-green'),
    road: cssVar('--b-map-road'),
    road2: cssVar('--b-map-road-2'),
    rail: cssVar('--b-map-rail'),
  }
}

export const BASE_LAYERS = ['bg', 'base-water', 'base-green', 'base-road-minor', 'base-road-major', 'base-rail']

export function baseStyle(): StyleSpecification {
  const c = basePaint()
  return {
    version: 8,
    sources: {
      base: { type: 'vector', url: BASEMAP_URL, attribution: ATTRIBUTION },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': c.bg } },
      { id: 'base-green', type: 'fill', source: 'base', 'source-layer': 'green', paint: { 'fill-color': c.green } },
      { id: 'base-water', type: 'fill', source: 'base', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      {
        id: 'base-road-minor', type: 'line', source: 'base', 'source-layer': 'roads',
        filter: ['!', ['in', ['get', 'highway'], ['literal', MAJOR]]],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': c.road2,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 0.4, 14, 2, 17, 6],
        },
      },
      {
        id: 'base-road-major', type: 'line', source: 'base', 'source-layer': 'roads',
        filter: ['in', ['get', 'highway'], ['literal', MAJOR]],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': c.road,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.6, 12, 2.2, 15, 7, 17, 14],
        },
      },
      {
        id: 'base-rail', type: 'line', source: 'base', 'source-layer': 'rail',
        paint: { 'line-color': c.rail, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 15, 1.6], 'line-dasharray': [3, 2] },
      },
    ],
  } as StyleSpecification
}

/** Перекраска подложки при смене темы: слои те же, меняются только краски. */
export function toneBase(map: MapLibreMap) {
  if (!map.getLayer('bg')) return
  const c = basePaint()
  const setPaint = map.setPaintProperty as (l: string, k: string, v: unknown) => void
  const set = (layer: string, key: string, value: unknown) => {
    if (map.getLayer(layer)) setPaint.call(map, layer, key, value)
  }
  set('bg', 'background-color', c.bg)
  set('base-water', 'fill-color', c.water)
  set('base-green', 'fill-color', c.green)
  set('base-road-minor', 'line-color', c.road2)
  set('base-road-major', 'line-color', c.road)
  set('base-rail', 'line-color', c.rail)
}
