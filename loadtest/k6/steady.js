// Ровная нагрузка экрана диспетчеров: фоном для приёма выгрузки и для отказа копии.
import { dispatcherRequest } from './common.js'

export const options = {
  discardResponseBodies: true,
  scenarios: {
    dispatchers: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RPS || 300),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: 50,
      maxVUs: 500,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: [`rate<${__ENV.MAX_FAILED || 0.01}`],
  },
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
}

export default function () {
  dispatcherRequest()
}
