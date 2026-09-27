// Нагрузка на API прогноза: час дня по маршруту, день целиком, месяц и риск-часы.
// k6 run -e BASE=http://localhost:8080 -e PASSWORD=... -e API_USER=dispatcher bench/forecast.js
import http from 'k6/http'
import encoding from 'k6/encoding'
import { check } from 'k6'

const base = __ENV.BASE || 'http://localhost:8080'
const auth = `Basic ${encoding.b64encode(`${__ENV.API_USER || 'dispatcher'}:${__ENV.PASSWORD || 'changeme'}`)}`

export const options = {
  scenarios: {
    dispatcher: { executor: 'constant-vus', vus: 50, duration: '30s' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<100', 'p(99)<250'],
  },
}

const calls = [
  '/api/forecast?routes=7&from=2025-12-24&to=2025-12-24',
  '/api/forecast?granularity=day&from=2025-11-01&to=2025-11-30',
  '/api/forecast?granularity=month&weather=0.98',
  '/api/risk?capacity=1500&from=2025-12-31&to=2025-12-31',
]

export default function () {
  const url = base + calls[Math.floor(Math.random() * calls.length)]
  const res = http.get(url, { headers: { Authorization: auth } })
  check(res, { '200': (r) => r.status === 200 })
}
