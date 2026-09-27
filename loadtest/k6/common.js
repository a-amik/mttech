// Общее для сценариев: адрес, пароли и смесь запросов диспетчерского экрана.
import http from 'k6/http'
import encoding from 'k6/encoding'
import { check } from 'k6'

export const base = __ENV.BASE || 'http://localhost:18080'
export const password = __ENV.API_PASSWORD || 'load-test'

export function basic(user, pass) {
  return { Authorization: `Basic ${encoding.b64encode(`${user}:${pass}`)}` }
}

export const dispatcher = basic('dispatcher', password)

// Доли — как работает экран: чаще всего день маршрута по часам, реже месяц и выгрузка.
const mix = [
  [30, () => { const d = day(); return `/api/forecast?routes=${route()}&from=${d}&to=${d}` }],
  [10, () => `/api/stops?route=${stopRoute()}&date=${day()}&hour=${Math.floor(Math.random() * 24)}`],
  [20, () => `/api/forecast?granularity=day&routes=${route()}&from=2025-12-01&to=2025-12-31`],
  [10, () => '/api/forecast?granularity=month&weather=0.98'],
  [15, () => { const d = day(); return `/api/risk?capacity=1500&from=${d}&to=${d}` }],
  [10, () => `/api/nowcast?route=${route()}&date=${day()}&fact=6:410,7:1290,8:1980`],
  [5, () => `/api/forecast.csv?routes=${route()}`],
]
const total = mix.reduce((s, [w]) => s + w, 0)
const routes = [1, 5, 7, 11, 12, 17, 25, 26, 28, 50]

// Доли остановок есть у пяти маршрутов; у остальных /api/stops честно отвечает 404.
const stopRoutes = [7, 17, 25, 28, 50]
function stopRoute() {
  return stopRoutes[Math.floor(Math.random() * stopRoutes.length)]
}

function route() {
  return routes[Math.floor(Math.random() * routes.length)]
}

function day() {
  const d = new Date(Date.UTC(2025, 10, 1) + Math.floor(Math.random() * 61) * 86400000)
  return d.toISOString().slice(0, 10)
}

export function dispatcherRequest() {
  let r = Math.random() * total
  let path = mix[mix.length - 1][1]
  for (const [w, p] of mix) {
    if ((r -= w) < 0) {
      path = p
      break
    }
  }
  const res = http.get(base + path(), { headers: dispatcher, tags: { name: 'dispatcher' } })
  check(res, { '200': (x) => x.status === 200 })
  return res
}
