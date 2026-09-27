// Все числа, от которых зависит экран, лежат здесь с источником. Форма настроек
// строится по SCHEMA, расчёт читает только Settings.

export type FieldType = 'number' | 'choice' | 'bool'

export interface Field {
  key: string
  label: string
  type: FieldType
  unit?: string
  min?: number
  max?: number
  step?: number
  hint: string
  choices?: { value: string; label: string }[]
}

export interface Group {
  key: string
  title: string
  tech?: boolean
  /** Вкладка «Факторы»: внешние поправки с основанием. */
  factors?: boolean
  fields: Field[]
}

export const ROUTE_IDS = ['1', '5', '7', '11', '12', '17', '25', '26', '28', '50']

// Интервал в пик подобран под наблюдаемый пик посадок; до наряда по выходам это допущение.
// Обычный будний пик маршрута: посадок на рейс в нагруженную сторону в самый загруженный час,
// медиана 45 будней сентября—октября 2025 (рейсы — расписание transport.mos.ru, доли направлений — 65/55 %).
// У маршрута 5 истории нет: он считается от вместимости вагона.
const USUAL_PEAK: Record<string, number> = {
  '1': 118, '7': 267, '11': 302, '12': 334, '17': 188, '25': 101, '26': 192, '28': 121, '50': 294,
}

const PEAK_INTERVAL: Record<string, number> = {
  '1': 8, '5': 10, '7': 6, '11': 5, '12': 5, '17': 4, '25': 10, '26': 7, '28': 9, '50': 5,
}

export const DEFAULTS: Record<string, number | string | boolean> = {
  threshold_pct: 90,
  warn_pct: 75,
  capacity: 177,
  turnover: 1.5,
  dir_peak_pct: 65,
  dir_off_pct: 55,
  load_basis: 'usual',
  usual_pct: 80,
  offpeak_factor: 1.6,
  peak_am_from: 7,
  peak_am_to: 10,
  peak_pm_from: 16,
  peak_pm_to: 20,
  band: '80',
  transfer_window_min: 90,
  gap_share_pct: 30,
  weekend_as: 'sunday',
  route5_start: '2025-12-16',
  show_fact: true,
  prio_high_pct: 100,
  target_pct: 85,
  delay_random_pct: 100,
  show_network: true,
  net_shift_pct: 30,
  f_rain: false,
  rain_mm: 5,
  rain_pct: -2.1,
  f_snow: false,
  snow_pct: 3,
  f_ice: false,
  ice_pct: 3,
  f_fare: false,
  fare_evasion_pct: 15,
  wait_gap_x: 2,
  r5_level: 0.71,
  nye_pct: -50,
  trips_source: 'schedule',
  fleet_low_pct: 80,
  nowcast: true,
  nowcast_min_hours: 2,
  nowcast_trust: 50,
  ...Object.fromEntries(ROUTE_IDS.map((id) => [`interval_${id}`, PEAK_INTERVAL[id]])),
  ...Object.fromEntries(Object.entries(USUAL_PEAK).map(([id, v]) => [`usual_${id}`, v])),
  ...Object.fromEntries(ROUTE_IDS.map((id) => [`cars_${id}`, '1'])),
}

export type Settings = typeof DEFAULTS

export const SCHEMA: Group[] = [
  {
    key: 'load',
    title: 'Порог и загрузка',
    fields: [
      { key: 'threshold_pct', label: 'Порог перегрузки', type: 'number', unit: '%', min: 50, max: 150, step: 5, hint: 'Доля вместимости часа, выше которой маршрут и остановка помечаются. Выбирает диспетчер смены.' },
      { key: 'warn_pct', label: 'Порог внимания', type: 'number', unit: '%', min: 40, max: 140, step: 5, hint: 'Ступень ниже порога: «внимание» в списке маршрутов.' },
      { key: 'capacity', label: 'Вместимость вагона', type: 'number', unit: 'мест', min: 100, max: 400, step: 1, hint: 'Норма комфорта по СП 98.13330.2012: все места для сидения заняты и 4,5 стоящих на 1 м² свободной площади. 71-931М «Витязь-М» (наряд из справочника): 60—64 места, около 25 м² свободной площади — 64 + 4,5 × 25 ≈ 177. Номинальная вместимость 188 (5 чел/м²), полная 265 (8 чел/м²) — Википедия, «Витязь-М».' },
      { key: 'turnover', label: 'Пассажиросмена за рейс', type: 'number', min: 1, max: 4, step: 0.1, hint: 'Сколько раз место занимают за рейс. Валидация видит только вход, поэтому загрузка — оценка: посадки пикового направления ÷ (рейсы × вагоны × места × пассажиросмена).' },
      { key: 'dir_peak_pct', label: 'Доля пикового направления в пик', type: 'number', unit: '%', min: 50, max: 90, step: 5, hint: 'Посадки в данных — сумма двух направлений, а вагон едет в одну сторону. Загрузка считается по более нагруженной стороне. Допущение: направления в валидациях нет; у радиальных маршрутов в часы пик обычно 60—70 %.' },
      { key: 'load_basis', label: 'Загрузка считается от', type: 'choice', choices: [{ value: 'usual', label: 'обычного пика маршрута' }, { value: 'seats', label: 'вместимости вагона' }], hint: 'Обычный пик: расписание перевозчик строит под обычный спрос, поэтому обычный будний пик маршрута принят за долю нормы ниже, а красное — спрос выше обычного. Маршрут, тесный каждый день, так красным не станет. Вместимость: места × пассажиросмена; без входов и выходов по остановкам она завышает загрузку длинных маршрутов (7, 11, 12, 50 — рейс 62—74 мин) и занижает коротких.' },
      { key: 'usual_pct', label: 'Обычный будний пик — это', type: 'number', unit: '% нормы', min: 50, max: 100, step: 5, hint: 'При 80 % и пороге 90 % красное — спрос на рейс выше обычного пика на 12,5 % и больше; внимание (75 %) — уже на обычном пике.' },
      { key: 'dir_off_pct', label: 'Доля пикового направления вне пика', type: 'number', unit: '%', min: 50, max: 90, step: 5, hint: 'Днём и вечером потоки ближе к поровну. Допущение, как и в пик.' },
      { key: 'show_fact', label: 'Показывать факт рядом с прогнозом', type: 'bool', hint: 'Факт есть за сентябрь и октябрь 2025; на ноябрь—декабрь только прогноз.' },
    ],
  },
  {
    key: 'intervals',
    title: 'Рейсы и интервалы',
    fields: [
      { key: 'trips_source', label: 'Рейсы в час', type: 'choice', choices: [{ value: 'schedule', label: 'по расписанию' }, { value: 'interval', label: 'по интервалам' }], hint: 'Расписание transport.mos.ru на дату: архив с 14 октября 2025, раньше — типовое расписание октября по типу дня. У маршрута 5 расписания за 2025 год нет, у него всегда интервал.' },
      { key: 'fleet_low_pct', label: 'Выпуск ниже нормы с', type: 'number', unit: '%', min: 50, max: 100, step: 5, hint: 'Вагонов с валидациями против обычного при таком расписании. 14—31 октября в будни 78—112 % нормы; выходные 7 и 50 в ремонт — 13—83 %.' },
      ...ROUTE_IDS.map((id): Field => ({
        key: `interval_${id}`, label: `Интервал в пик, маршрут ${id}`, type: 'number', unit: 'мин', min: 2, max: 30, step: 1,
        hint: id === '5' ? 'Действует всегда: расписания маршрута 5 за 2025 год в архиве нет.' : id === '17' ? 'Допущение, подобрано под пик посадок; при рейсах по расписанию не используется.' : '',
      })),
      { key: 'offpeak_factor', label: 'Интервал вне пика длиннее в', type: 'number', unit: 'раз', min: 1, max: 3, step: 0.1, hint: 'Допущение по образцу расписания маршрута 1 из справочника.' },
      { key: 'peak_am_from', label: 'Утренний пик с', type: 'number', unit: 'ч', min: 5, max: 10, step: 1, hint: 'Пик по меткам сентября—октября 2025.' },
      { key: 'peak_am_to', label: 'Утренний пик до', type: 'number', unit: 'ч', min: 7, max: 12, step: 1, hint: '' },
      { key: 'peak_pm_from', label: 'Вечерний пик с', type: 'number', unit: 'ч', min: 14, max: 19, step: 1, hint: '' },
      { key: 'peak_pm_to', label: 'Вечерний пик до', type: 'number', unit: 'ч', min: 17, max: 23, step: 1, hint: '' },
    ],
  },
  {
    key: 'model',
    title: 'Прогноз',
    tech: true,
    fields: [
      { key: 'band', label: 'Полоса разброса', type: 'choice', choices: [{ value: '50', label: 'узкая' }, { value: '80', label: 'полная' }], hint: 'Квантили 10 и 90 % посадок «маршрут × день недели × час» за сентябрь—октябрь 2025, перенесённые на прогноз. Это разброс истории, а не откалиброванная вероятность; узкая — половина полной. У маршрута 5 истории нет, полоса взята у маршрута 25, по профилю которого он и считается.' },
      { key: 'weekend_as', label: 'Будний выходной считать как', type: 'choice', choices: [{ value: 'sunday', label: 'воскресенье' }, { value: 'saturday', label: 'субботу' }], hint: 'Данные 2025: будний выходной собирает 24—57 % будня, ближе к воскресенью.' },
      { key: 'route5_start', label: 'Маршрут 5 работает с', type: 'choice', choices: [{ value: '2025-12-16', label: '16 декабря' }, { value: '2025-11-01', label: 'с начала окна' }], hint: 'Дата версии в справочнике; ответ организаторов 25.09.2026: до неё в эталоне нули.' },
      { key: 'transfer_window_min', label: 'Окно пересадки для снятия дублей', type: 'number', unit: 'мин', min: 30, max: 180, step: 15, hint: 'Тариф «90 минут». Метрику не двигает: посадка — любая успешная валидация. Нужен для числа пассажиров при загрузке CSV.' },
      { key: 'gap_share_pct', label: 'Провал наблюдений ниже', type: 'number', unit: '% нормы', min: 5, max: 60, step: 5, hint: 'Норма дня — медиана того же дня недели в ±4 неделях. Ниже этой доли день считается провалом валидаций, а не спадом спроса; такие дни в профиль не берутся.' },
    ],
  },
]

SCHEMA.push({
  key: 'windows',
  title: 'Окна риска и решение',
  fields: [
    { key: 'prio_high_pct', label: 'Первый приоритет с', type: 'number', unit: '%', min: 90, max: 160, step: 5, hint: 'Три приоритета по EEMUA 191: первый — от этой загрузки, второй — от порога перегрузки, третий — от порога внимания.' },
    { key: 'target_pct', label: 'Загрузка после решения', type: 'number', unit: '%', min: 50, max: 100, step: 5, hint: 'Сколько рейсов добавить в час, рекомендация считает до этой загрузки в каждом часе окна. Выбирает диспетчер смены.' },
    { key: 'delay_random_pct', label: 'Пассажиров копится с интервалом', type: 'number', unit: '%', min: 0, max: 100, step: 10, hint: 'Для сценария «рейс опоздал»: какая доля пассажиров приходит на остановку когда придётся, а не к рейсу по расписанию. Эти пассажиры копятся, пока вагона нет, и опоздавший забирает их за весь удлинённый интервал. При частых рейсах почти все идут не по расписанию. Допущение: минуты прихода вагона в валидациях нет.' },
  ],
})

SCHEMA.push({
  key: 'network',
  title: 'Сеть вне задания',
  fields: [
    { key: 'show_network', label: 'Показывать на карте остальные трамваи Москвы', type: 'bool', hint: '28 маршрутов вне задания, трассы OpenStreetMap на сентябрь 2026. Прогноза по ним нет: только фон и отключения на стенде.' },
    { key: 'net_shift_pct', label: 'Прирост на общих остановках при отключении', type: 'number', unit: '%', min: 0, max: 100, step: 5, hint: 'Допущение: на сколько растут посадки маршрута задания на остановках, общих с отключённым маршрутом. Весь маршрут прибавляет эту величину, умноженную на долю общих остановок (120 м).' },
  ],
})

SCHEMA.push({
  key: 'usual',
  title: 'Обычный будний пик, посадок на рейс',
  fields: Object.keys(USUAL_PEAK).map((id): Field => ({
    key: `usual_${id}`, label: `Маршрут ${id}`, type: 'number', min: 20, max: 800, step: 1,
    hint: id === '1' ? 'В нагруженную сторону в самый загруженный час, медиана будней сентября—октября 2025.' : '',
  })),
})

SCHEMA.push({
  key: 'fleet',
  title: 'Вагонов в составе',
  fields: ROUTE_IDS.map((id): Field => ({
    key: `cars_${id}`, label: `Маршрут ${id}`, type: 'choice',
    choices: [{ value: '1', label: '1 вагон' }, { value: '2', label: '2 вагона' }],
    hint: '',
  })),
})

/** Вагонов в составе на маршруте: вместимость часа растёт вместе с ним. */
export const carsOf = (s: Settings, route: string) => Number(s[`cars_${route}`] ?? 1) || 1

export const isPeak = (s: Settings, h: number) =>
  (h >= Number(s.peak_am_from) && h < Number(s.peak_am_to)) || (h >= Number(s.peak_pm_from) && h < Number(s.peak_pm_to))

// plan — плановые рейсы дня по часам (model.planDay); без него рейсы считаются по интервалу.

/** Рейсов в час в каждую сторону: по расписанию дня или по интервалу — в пик интервал маршрута, вне пика длиннее. */
export function tripsHour(s: Settings, route: string, h: number, plan?: number[] | null): number {
  if (plan) return plan[h] ?? 0
  if (h >= 1 && h < 5) return 0
  const peak = Number(s[`interval_${route}`] ?? 8)
  return 60 / (isPeak(s, h) ? peak : peak * Number(s.offpeak_factor))
}

/** Доля посадок часа, которая приходится на более нагруженное направление. */
export const dirShare = (s: Settings, h: number) => Number(isPeak(s, h) ? s.dir_peak_pct : s.dir_off_pct) / 100

/** Посадок в час, при которых загрузка 100 %: рейсы в одну сторону × вагоны × места × пассажиросмена,
 *  отнесённые к доле пикового направления. */
export const capacityHour = (s: Settings, route: string, h: number, plan?: number[] | null) =>
  (tripsHour(s, route, h, plan) * capacityTrip(s, route)) / dirShare(s, h)

/** Посадок на рейс в нагруженную сторону, при которых загрузка 100 %. */
export function capacityTrip(s: Settings, route: string): number {
  const usual = Number(s[`usual_${route}`] ?? 0)
  if (s.load_basis === 'usual' && usual) return (usual / (Number(s.usual_pct) / 100)) * carsOf(s, route)
  return Number(s.capacity) * Number(s.turnover) * carsOf(s, route)
}

/** Загрузка после добавленных рейсов: посадки те же, мест больше. */
export function loadWithTrips(s: Settings, route: string, h: number, load: number, extra: number, plan?: number[] | null): number {
  const trips = tripsHour(s, route, h, plan)
  return extra && trips ? (load * trips) / (trips + extra) : load
}

/** Поправка на неоплативших проезд: валидаций меньше, чем пассажиров в вагоне. Меняет только загрузку. */
export const fareFactor = (s: Settings) => (s.f_fare ? 1 / (1 - Math.min(0.9, Number(s.fare_evasion_pct) / 100)) : 1)

export const loadPct = (s: Settings, route: string, h: number, boardings: number, plan?: number[] | null) => {
  const cap = capacityHour(s, route, h, plan)
  return cap ? ((boardings * fareFactor(s)) / cap) * 100 : 0
}

// Внешние факторы: тумблер только у фактора с известной величиной, рядом основание.
// Положение по умолчанию задаёт доказательство: подтверждён историей или попыткой — включён,
// гипотеза — выключен. Числа измерены в tramflow.factors и на лидерборде 25.09.2026.
SCHEMA.push({
  key: 'factors',
  title: 'Внешние факторы',
  factors: true,
  fields: [
    { key: 'f_rain', label: 'Дождь', type: 'bool', hint: 'История: будни с дождём от порога дают −2,1 % к тому же дню недели, 25 дней января—октября, минус во всех шести месяцах. На окне попытка v21 дала −0,0002: вклад в пределах шума.' },
    { key: 'rain_mm', label: 'Порог дождя за сутки', type: 'number', unit: 'мм', min: 1, max: 10, step: 1, hint: 'Ниже порога эффекта нет: 0,0 % на 43 днях с дождём до 5 мм.' },
    { key: 'rain_pct', label: 'Эффект дождя', type: 'number', unit: '%', min: -10, max: 5, step: 0.1, hint: 'Измерено на истории; попытка на окне знак не подтвердила.' },
    { key: 'f_snow', label: 'Снегопад', type: 'bool', hint: 'Гипотеза: в истории 2025 года два дня снегопада, не мера. Попытка v24 (26 декабря × 1,03) дала +0,0001.' },
    { key: 'snow_pct', label: 'Эффект снегопада от 5 см', type: 'number', unit: '%', min: -40, max: 20, step: 1, hint: 'Стенд эмуляции задаёт снег своей ручкой; она главнее этого числа.' },
    { key: 'f_ice', label: 'Ледяной дождь', type: 'bool', hint: 'Гипотеза: призыв Дептранса пересесть на транспорт 24 ноября и 16 декабря. Попытка v23 (× 1,03) дала 0,0000.' },
    { key: 'ice_pct', label: 'Эффект ледяного дождя', type: 'number', unit: '%', min: -10, max: 10, step: 1, hint: 'Дни — по постам «Дептранс. Оперативно», день поста и следующий.' },
    { key: 'f_fare', label: 'Поправка на неоплативших проезд', type: 'bool', hint: 'Гипотеза: валидация не видит тех, кто не оплатил проезд, поэтому загрузка по валидациям занижена. Официальной доли безбилетников в трамвае нет. Оценка Мосгордумы — город теряет около 2,7 млрд ₽ в год на наземном транспорте (ТАСС, tass.ru/obschestvo/17893363; год оценки не указан). Цифра «платят около 85 %» встречается без первоисточника. В апреле 2025 в трамваях на 14 % чаще оплачивали проезд, чем годом раньше (gazetametro.ru, 13.04.2025). С 09.01.2026 штраф — 5 000 ₽ (Коммерсантъ, kommersant.ru/doc/8315995). Поправка меняет только загрузку, прогноз посадок и метрику не трогает.' },
    { key: 'fare_evasion_pct', label: 'Доля неоплативших', type: 'number', unit: '%', min: 0, max: 40, step: 1, hint: 'Сколько пассажиров едет без валидации. Посадки на рейс делятся на (1 − доля). Пример: маршрут 7, 23 декабря, 08:00 после +1 рейса — 79 %, с долей 15 % — около 93 %, одного рейса мало.' },
    { key: 'r5_level', label: 'Уровень маршрута 5 от профиля 25-го', type: 'number', min: 0.5, max: 1.5, step: 0.01, hint: 'Попытка v19: 0,71 дал +0,0013 — 40 тысяч поездок за первую неделю по Дептрансу против 56 тысяч у профиля 25-го. Не выключается: без уровня у маршрута нет прогноза.' },
    { key: 'nye_pct', label: 'Вечер 31 декабря с 18:00', type: 'number', unit: '%', min: -80, max: 0, step: 5, hint: 'Попытка v11: −50 % дали +0,0006. Круглосуточно в ту ночь ходили 7, 11, 17, 26, 28 и 50, но их ночные часы уже за окном.' },
  ],
})

// Пересчёт остатка дня по факту прошедших часов — единственный вход живого дня,
// который на истории поднимает точность: выпуск и погода дневной остаток не объясняют.
SCHEMA.push({
  key: 'nowcast',
  title: 'Пересчёт по факту дня',
  fields: [
    { key: 'nowcast', label: 'Пересчитывать остаток дня по факту', type: 'bool', hint: 'Отношение факта к прогнозу за часы до часа смены переносится на оставшиеся часы. Октябрь 2025, остаток дня по девяти маршрутам: до 9:00 — +0,4 пп, до 11:00 — +0,8 пп, до 16:00 — +0,8 пп. Считается по часам, где прогноз от 50 посадок, множитель в пределах 0,8—1,25. Действует в дни с фактом: сентябрь—октябрь и день со стенда.' },
    { key: 'nowcast_min_hours', label: 'Не раньше, чем часов факта', type: 'number', unit: 'ч', min: 1, max: 8, step: 1, hint: 'Первые часы после 5:00 малы и шумны; по одному часу отношение случайно.' },
    { key: 'nowcast_trust', label: 'Доверие факту', type: 'number', unit: '%', min: 0, max: 100, step: 10, hint: '100 — перенос отношения целиком, 50 — корень из него. Октябрь 2025, остаток дня: при 50 пересчёт не хуже прогноза ни в один час смены (9:00 — 0,904 против 0,900, 11:00 — 0,906 против 0,898); при 100 в 7—9 часов хуже (7:00 — 0,892 против 0,904).' },
  ],
})

// Ожидание на остановке: сколько людей копится, пока нет вагона. Оценка по долям остановок и интервалу.
SCHEMA.push({
  key: 'wait',
  title: 'Ожидание на остановке',
  fields: [
    { key: 'wait_gap_x', label: 'Копятся, если с прошлого вагона больше', type: 'number', unit: 'интервала', min: 1.5, max: 4, step: 0.5, hint: 'По отметкам ГЛОНАСС: сколько плановых интервалов прошло с прохода прошлого вагона, чтобы остановка на схеме линии была помечена «копятся». Без ГЛОНАСС пометки нет: ожидание считается по половине интервала.' },
  ],
})
