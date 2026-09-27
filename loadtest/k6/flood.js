// Перебор паролей: каждый запрос с новым неверным паролем, чтобы память неудачных пар
// не помогала, — худший случай для bcrypt. Запускается отдельно от диспетчеров,
// из своего контейнера: так у атаки свой адрес.
import http from 'k6/http'
import { Counter } from 'k6/metrics'
import { base, basic } from './common.js'

const refused = new Counter('flood_401')
const limited = new Counter('flood_429')
const other = new Counter('flood_other')

export const options = {
  discardResponseBodies: true,
  scenarios: {
    flood: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RPS || 100),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: 100,
      maxVUs: 2000,
    },
  },
  summaryTrendStats: ['med', 'p(95)', 'max'],
}

export default function () {
  const res = http.get(`${base}/api/routes`, {
    headers: basic('dispatcher', `wrong-${Math.random().toString(36).slice(2)}`),
    timeout: '10s',
    responseCallback: http.expectedStatuses(401, 429),
  })
  if (res.status === 401) refused.add(1)
  else if (res.status === 429) limited.add(1)
  else other.add(1)
}
