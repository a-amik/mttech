package ru.mt.tram;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Срезы прогноза: час, день, месяц. Поправки — общий множитель на выбранный срез:
 * погода и трафик оцениваются индексом по маршруту или городу, а не по остановкам,
 * поэтому умножение честнее, чем вид точного расчёта.
 */
@RestController
@RequestMapping("/api")
public class ForecastController {

    private final ForecastStore store;
    private final FactStore facts;

    // Отношение считается по часам, где прогноз от NOWCAST_HOUR_MIN посадок, и только при сумме
    // от NOWCAST_SUM_MIN: в 5—6 утра у малых маршрутов прогноз — единицы посадок, и одна лишняя
    // валидация давала множитель ×3 на весь день. Шире 0,8—1,25 на октябре только хуже.
    private static final double NOWCAST_MIN = 0.8;
    private static final double NOWCAST_MAX = 1.25;
    private static final int NOWCAST_HOUR_MIN = 50;
    private static final int NOWCAST_SUM_MIN = 300;
    // Час, где факт меньше пятой части прогноза, — провал данных (обрыв связи с валидаторами,
    // сбой выгрузки), а не пустой трамвай: в отношение он не входит, иначе один такой час
    // уводил весь остаток дня к нижней границе 0,8.
    private static final double GAP_SHARE = 0.2;

    public ForecastController(ForecastStore store, FactStore facts) {
        this.store = store;
        this.facts = facts;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "up", "routes", store.routes().length,
                "from", store.firstDay().toString(), "to", store.lastDay().toString(),
                "points", store.points(), "version", store.version());
    }

    /** Маршруты с суммой за окно и часом суточного пика — для списка на дашборде. */
    @GetMapping("/routes")
    public List<Map<String, Object>> routes() {
        var out = new ArrayList<Map<String, Object>>();
        for (int route : store.routes()) {
            long total = 0;
            var byHour = new long[24];
            for (var day = store.firstDay(); !day.isAfter(store.lastDay()); day = day.plusDays(1)) {
                for (int hour = 0; hour < 24; hour++) {
                    int v = store.value(route, day, hour);
                    total += v;
                    byHour[hour] += v;
                }
            }
            int peak = 0;
            for (int hour = 1; hour < 24; hour++) {
                if (byHour[hour] > byHour[peak]) {
                    peak = hour;
                }
            }
            out.add(Map.of("route", route, "total", total, "peakHour", peak));
        }
        return out;
    }

    @GetMapping("/forecast")
    public Map<String, Object> forecast(@RequestParam(required = false) String routes,
                                        @RequestParam(required = false) String from,
                                        @RequestParam(required = false) String to,
                                        @RequestParam(defaultValue = "hour") String granularity,
                                        @RequestParam(defaultValue = "1.0") double weather,
                                        @RequestParam(defaultValue = "1.0") double event,
                                        @RequestParam(defaultValue = "1.0") double season) {
        var query = query(routes, from, to, granularity, factorOf(weather, event, season));
        var items = aggregate(query);
        long total = items.stream().mapToLong(i -> ((Number) i.get("prediction")).longValue()).sum();
        return Map.of("granularity", query.granularity(), "factor", round(query.factor(), 4),
                "from", query.from().toString(), "to", query.to().toString(),
                "total", total, "items", items);
    }

    /** Часы, где прогноз выше провозной способности: столько посадок вагоны не увезут. */
    @GetMapping("/risk")
    public Map<String, Object> risk(@RequestParam(required = false) String routes,
                                    @RequestParam(required = false) String from,
                                    @RequestParam(required = false) String to,
                                    @RequestParam int capacity,
                                    @RequestParam(defaultValue = "1.0") double weather) {
        if (capacity <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "capacity должен быть больше нуля");
        }
        var query = query(routes, from, to, "hour", factorOf(weather));
        var out = new ArrayList<Map<String, Object>>();
        for (int route : query.routes()) {
            for (var day = query.from(); !day.isAfter(query.to()); day = day.plusDays(1)) {
                for (int hour = 0; hour < 24; hour++) {
                    int v = apply(store.value(route, day, hour), query.factor());
                    if (v > capacity) {
                        out.add(Map.of("route", route, "date", day.toString(), "hour", hour,
                                "prediction", v, "capacity", capacity, "deficit", v - capacity));
                    }
                }
            }
        }
        return Map.of("capacity", capacity, "factor", round(query.factor(), 4), "hours", out.size(), "items", out);
    }

    /**
     * Остаток дня по факту прошедших часов: отношение факта к прогнозу за увиденные часы,
     * сжатое к единице (trust 0,5 — корень), переносится на оставшиеся. Октябрь 2025, остаток
     * дня по девяти маршрутам: факт до 9:00 — 0,904 против 0,900 без пересчёта, до 11:00 —
     * 0,906 против 0,898; при trust 1 в 7—9 часов хуже, чем без пересчёта.
     * Факт — пары час:посадки, например 6:120,7:340,8:410.
     */
    @GetMapping("/nowcast")
    public Map<String, Object> nowcast(@RequestParam int route,
                                       @RequestParam String date,
                                       @RequestParam(required = false) String fact,
                                       @RequestParam(required = false) Integer until,
                                       @RequestParam(defaultValue = "0.5") double trust,
                                       @RequestParam(defaultValue = "2") int minHours) {
        if (fact == null) {
            return fromIngest(route, date(date), until, trust, minHours);
        }
        var seen = new TreeMap<Integer, Integer>();
        for (var pair : fact.split(",")) {
            var p = pair.trim().split(":");
            if (p.length != 2) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "fact: пары час:посадки через запятую, например 6:120,7:340");
            }
            seen.put(number(p[0]), number(p[1]));
        }
        var out = nowcast(route, date(date), seen, trust, minHours);
        out.put("source", "request");
        return out;
    }

    /**
     * Факт берётся из принятых выгрузок: часы до until. Без until последний час с валидациями
     * считается незакрытым и в отношение не идёт — в нём ещё не все посадки.
     */
    private Map<String, Object> fromIngest(int route, LocalDate day, Integer until, double trust, int minHours) {
        var cell = facts.day(route, day);
        int last = cell == null ? -1 : cell[FactStore.LAST_MINUTE];
        int upTo = until != null ? until : (last < 0 ? 0 : last / 60);
        if (upTo < 0 || upTo > 24) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "until: час от 0 до 24");
        }
        var seen = new TreeMap<Integer, Integer>();
        for (int hour = 0; hour < upTo; hour++) {
            seen.put(hour, cell == null ? 0 : cell[hour]);
        }
        var out = nowcast(route, day, seen, trust, minHours);
        out.put("source", "ingest");
        out.put("lastValidation", last < 0 ? null : IngestController.clock(last));
        out.put("lastIngest", facts.lastIngest() == null ? null : facts.lastIngest().toString());
        return out;
    }

    @PostMapping(value = "/nowcast", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> nowcast(@RequestBody NowcastRequest body) {
        if (body.fact() == null || body.fact().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "fact: посадки по часам, {\"6\": 120, \"7\": 340}");
        }
        var out = nowcast(body.route(), date(body.date()), new TreeMap<>(body.fact()),
                body.trust() == null ? 0.5 : body.trust(), body.minHours() == null ? 2 : body.minHours());
        out.put("source", "request");
        return out;
    }

    private LinkedHashMap<String, Object> nowcast(int route, LocalDate day, TreeMap<Integer, Integer> seen, double trust, int minHours) {
        if (!store.hasRoute(route)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "маршрута " + route + " нет в прогнозе");
        }
        if (!store.covers(day)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "окно прогноза — " + store.firstDay() + " … " + store.lastDay());
        }
        if (!(trust >= 0 && trust <= 1)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "trust: от 0 до 1");
        }
        if (minHours < 1 || minHours > 24) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "minHours: от 1 до 24");
        }
        long factSum = 0;
        long forecastSum = 0;
        int used = 0;
        var gaps = new ArrayList<Integer>();
        for (var e : seen.entrySet()) {
            if (e.getKey() < 0 || e.getKey() > 23) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "час от 0 до 23: " + e.getKey());
            }
            if (e.getValue() < 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "посадки не бывают отрицательными");
            }
            int plainHour = store.value(route, day, e.getKey());
            if (plainHour < NOWCAST_HOUR_MIN) {
                continue;
            }
            if (e.getValue() < GAP_SHARE * plainHour) {
                gaps.add(e.getKey());
                continue;
            }
            used++;
            factSum += e.getValue();
            forecastSum += plainHour;
        }
        int fromHour = seen.isEmpty() ? 0 : seen.lastKey() + 1;
        boolean applied = used >= minHours && forecastSum >= NOWCAST_SUM_MIN;
        double factor = applied
                ? Math.pow(Math.min(NOWCAST_MAX, Math.max(NOWCAST_MIN, (double) factSum / forecastSum)), trust)
                : 1.0;
        var items = new ArrayList<Map<String, Object>>();
        long total = 0;
        for (int hour = fromHour; hour < 24; hour++) {
            int plain = store.value(route, day, hour);
            int v = apply(plain, factor);
            total += v;
            var row = new LinkedHashMap<String, Object>();
            row.put("hour", hour);
            row.put("prediction", v);
            row.put("plain", plain);
            items.add(row);
        }
        var out = new LinkedHashMap<String, Object>();
        out.put("route", route);
        out.put("date", day.toString());
        out.put("seenHours", seen.size());
        out.put("usedHours", used);
        out.put("gapHours", gaps);
        out.put("seenFact", factSum);
        out.put("seenForecast", forecastSum);
        out.put("fromHour", fromHour);
        out.put("factor", round(factor, 4));
        out.put("applied", applied);
        out.put("total", total);
        out.put("items", items);
        return out;
    }

    @GetMapping(value = "/forecast.csv", produces = "text/csv;charset=UTF-8")
    public String csv(@RequestParam(required = false) String routes,
                      @RequestParam(required = false) String from,
                      @RequestParam(required = false) String to,
                      @RequestParam(defaultValue = "hour") String granularity,
                      @RequestParam(defaultValue = "1.0") double weather) {
        var query = query(routes, from, to, granularity, factorOf(weather));
        var head = query.granularity().equals("hour") ? "route;date;hour;prediction" : "route;date;prediction";
        var sb = new StringBuilder(head).append('\n');
        for (var item : aggregate(query)) {
            sb.append(item.get("route")).append(';').append(item.get("date"));
            if (item.containsKey("hour")) {
                sb.append(';').append(item.get("hour"));
            }
            sb.append(';').append(item.get("prediction")).append('\n');
        }
        return sb.toString();
    }

    private List<Map<String, Object>> aggregate(Query query) {
        var out = new ArrayList<Map<String, Object>>();
        for (int route : query.routes()) {
            var months = new LinkedHashMap<String, Long>();
            for (var day = query.from(); !day.isAfter(query.to()); day = day.plusDays(1)) {
                long daySum = 0;
                for (int hour = 0; hour < 24; hour++) {
                    int v = apply(store.value(route, day, hour), query.factor());
                    daySum += v;
                    if (query.granularity().equals("hour")) {
                        var row = new LinkedHashMap<String, Object>();
                        row.put("route", route);
                        row.put("date", day.toString());
                        row.put("hour", hour);
                        row.put("prediction", v);
                        out.add(row);
                    }
                }
                if (query.granularity().equals("day")) {
                    out.add(row(route, day.toString(), daySum));
                } else if (query.granularity().equals("month")) {
                    months.merge(day.toString().substring(0, 7), daySum, Long::sum);
                }
            }
            months.forEach((month, sum) -> out.add(row(route, month, sum)));
        }
        return out;
    }

    private static Map<String, Object> row(int route, String date, long prediction) {
        var row = new LinkedHashMap<String, Object>();
        row.put("route", route);
        row.put("date", date);
        row.put("prediction", prediction);
        return row;
    }

    private static int apply(int value, double factor) {
        return (int) Math.round(value * factor);
    }

    private static double round(double value, int digits) {
        double scale = Math.pow(10, digits);
        return Math.round(value * scale) / scale;
    }

    /** Каждая поправка — конечное число больше нуля: NaN сравнения пропускают, поэтому проверка прямая. */
    private static double factorOf(double... parts) {
        double factor = 1;
        for (double part : parts) {
            if (!(part > 0 && part <= 5)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "поправки допустимы в пределах от 0 до 5");
            }
            factor *= part;
        }
        return factor;
    }

    private Query query(String routes, String from, String to, String granularity, double factor) {
        if (!List.of("hour", "day", "month").contains(granularity)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "granularity: hour, day или month");
        }
        if (!(factor > 0 && factor <= 5)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "поправки допустимы в пределах от 0 до 5");
        }
        int[] selected = store.routes();
        if (routes != null && !routes.isBlank()) {
            selected = Arrays.stream(routes.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                    .mapToInt(ForecastController::number).distinct().toArray();
            for (int route : selected) {
                if (!store.hasRoute(route)) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "маршрута " + route + " нет в прогнозе");
                }
            }
        }
        var start = from == null || from.isBlank() ? store.firstDay() : date(from);
        var end = to == null || to.isBlank() ? store.lastDay() : date(to);
        if (end.isBefore(start)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "to раньше from");
        }
        if (!store.covers(start) || !store.covers(end)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "окно прогноза — " + store.firstDay() + " … " + store.lastDay());
        }
        return new Query(selected, start, end, granularity, factor);
    }

    private static int number(String text) {
        try {
            return Integer.parseInt(text);
        } catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "маршрут задаётся числом: " + text);
        }
    }

    private static LocalDate date(String text) {
        try {
            return LocalDate.parse(text);
        } catch (DateTimeParseException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "дата в формате ГГГГ-ММ-ДД: " + text);
        }
    }

    private record Query(int[] routes, LocalDate from, LocalDate to, String granularity, double factor) {
    }

    /** Тело POST /api/nowcast: факт по часам, доверие и порог часов необязательны. */
    record NowcastRequest(int route, String date, Map<Integer, Integer> fact, Double trust, Integer minHours) {
    }
}
