// Ступени нагрузки в открытой модели: запросы приходят с заданной частотой,
// сколько бы ни отвечал сервис. Каждая ступень — отдельный сценарий со своим порогом.
import { dispatcherRequest } from './common.js'

const steps = (__ENV.STEPS || '100,300,500,1000,2000').split(',').map(Number)
const hold = Number(__ENV.HOLD || 40)

export const options = {
  discardResponseBodies: true,
  scenarios: Object.fromEntries(steps.map((rps, i) => [`rps${rps}`, {
    executor: 'constant-arrival-rate',
    rate: rps,
    timeUnit: '1s',
    duration: `${hold}s`,
    startTime: `${i * (hold + 5)}s`,
    preAllocatedVUs: Math.max(20, rps / 10),
    maxVUs: Math.max(200, rps),
  }])),
  thresholds: Object.fromEntries(steps.flatMap((rps) => [
    [`http_req_duration{scenario:rps${rps}}`, ['p(95)<300']],
    [`http_req_failed{scenario:rps${rps}}`, ['rate<0.01']],
    [`http_reqs{scenario:rps${rps}}`, ['count>0']],
  ])),
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
}

export default function () {
  dispatcherRequest()
}
