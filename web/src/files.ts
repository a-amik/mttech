import { DAYS, idxOf, isoOf, num } from './data'
import { forecastDay, type Ctx } from './model'
import { useStore } from './store'
import { workbook } from './xlsx'

// Файл в формате train.csv: успешные валидации по маршруту и часу, пассажиры — с учётом окна пересадки.
function aggregate(text: string, windowMin: number) {
  const lines = text.split(/\r?\n/)
  const head = lines[0].split(';').map((h) => h.trim().replace(/"/g, ''))
  const col = (name: string) => head.indexOf(name)
  const [cTime, cResult, cRoute, cCard] = [col('tran_date_time'), col('validation_result'), col('ngpt_route'), col('crd_hashcode')]
  if (cTime < 0 || cRoute < 0) throw new Error('нет колонок tran_date_time и ngpt_route')
  const byDay: Record<string, Record<string, number[]>> = {}
  const lastSeen = new Map<string, number>()
  let ok = 0
  let people = 0
  for (const line of lines.slice(1)) {
    if (!line) continue
    const f = line.split(';').map((x) => x.replace(/"/g, ''))
    if (cResult >= 0 && f[cResult] !== '1') continue
    const route = (f[cRoute].match(/\d+/) ?? [''])[0]
    const date = f[cTime].slice(0, 10)
    const hour = Number(f[cTime].slice(11, 13))
    if (!route || Number.isNaN(hour)) continue
    ok++
    ;((byDay[date] ??= {})[route] ??= Array(24).fill(0))[hour]++
    const t = Date.parse(f[cTime].replace(' ', 'T'))
    const card = cCard >= 0 ? f[cCard] : ''
    const prev = lastSeen.get(card)
    if (!card || prev === undefined || t - prev > windowMin * 60_000) people++
    if (card) lastSeen.set(card, t)
  }
  return { byDay, ok, people }
}

/** Загрузка CSV валидаций: день из окна встаёт на экран как эмуляция. */
export async function openValidations(f: File) {
  const st = useStore.getState()
  try {
    const { byDay, ok, people } = aggregate(await f.text(), Number(st.settings.transfer_window_min))
    const dates = Object.keys(byDay).sort()
    const inside = dates.find((d) => idxOf(d) >= 0 && idxOf(d) < DAYS)
    if (inside) {
      st.set({ sim: { idx: idxOf(inside), fact: byDay[inside], label: f.name }, day: idxOf(inside), horizon: 'day' })
    }
    st.notify(`«${f.name}»: посадок ${num(ok)}, пассажиров ≈ ${num(people)}, дней ${dates.length}${inside ? '' : '. Дат из окна сентябрь—декабрь нет — на экран не встал'}`)
  } catch (err) {
    st.notify(`Файл не принят: ${String(err instanceof Error ? err.message : err)}`)
  }
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Прогноз дня по маршрутам и часам: CSV в формате сабмита или книга XLSX. */
export function exportForecast(ctx: Ctx, day: number, format: 'csv' | 'xlsx' = 'csv') {
  const cells: (string | number)[][] = [['route', 'date', 'hour', 'prediction']]
  for (const r of ctx.ds.routes) forecastDay(ctx, r.id, day).forEach((v, h) => cells.push([r.id, isoOf(day), h, v]))
  if (format === 'xlsx') {
    download(workbook(`Прогноз ${isoOf(day)}`, cells), `forecast_${isoOf(day)}.xlsx`)
    return
  }
  const text = cells.map((row) => row.join(';')).join('\n')
  download(new Blob([text], { type: 'text/csv' }), `forecast_${isoOf(day)}.csv`)
}
