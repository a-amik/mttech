package ru.mt.tram;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Посадки по остановкам: прогноз маршрута за час × доля остановки из октябрьских валидаций.
 * С hour — один час, без него — сумма за день. Остановки двух направлений отдаются раздельно:
 * одна и та же точка в разные стороны — разные посадки.
 */
@RestController
@RequestMapping("/api")
public class StopController {

    private final ForecastStore forecast;
    private final StopStore stops;

    public StopController(ForecastStore forecast, StopStore stops) {
        this.forecast = forecast;
        this.stops = stops;
    }

    @GetMapping("/stops")
    public Map<String, Object> stops(@RequestParam int route, @RequestParam String date,
                                     @RequestParam(required = false) Integer hour) {
        LocalDate day;
        try {
            day = LocalDate.parse(date);
        } catch (DateTimeParseException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "дата в формате ГГГГ-ММ-ДД: " + date);
        }
        if (!forecast.hasRoute(route)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "маршрута " + route + " нет в прогнозе");
        }
        if (!forecast.covers(day)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "окно прогноза — " + forecast.firstDay() + " … " + forecast.lastDay());
        }
        if (hour != null && (hour < 0 || hour > 23)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "hour: от 0 до 23");
        }
        if (!stops.has(route)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "по остановкам маршрут " + route
                    + " не оценён: направление рейсов по валидациям не определилось или истории нет");
        }
        // направление|порядковый номер → посадки
        var sum = new TreeMap<String, double[]>();
        var names = new LinkedHashMap<String, StopStore.Stop>();
        int from = hour == null ? 0 : hour;
        int to = hour == null ? 23 : hour;
        long routeTotal = 0;
        long unallocated = 0;
        var borrowed = new TreeMap<Integer, Integer>();
        for (int h = from; h <= to; h++) {
            int value = forecast.value(route, day, h);
            routeTotal += value;
            var list = stops.stops(route, day, h);
            if (list.isEmpty()) {
                unallocated += value;
                continue;
            }
            if (list.get(0).fromHour() != h) {
                borrowed.put(h, list.get(0).fromHour());
            }
            for (var s : list) {
                var key = String.format("%d|%03d", s.direction(), s.seq());
                sum.computeIfAbsent(key, k -> new double[1])[0] += value * s.share();
                names.putIfAbsent(key, s);
            }
        }
        // Округление наибольшими остатками: сумма по остановкам ровно равна посадкам маршрута,
        // а не расходится на десяток от округления каждой остановки.
        var keys = new ArrayList<>(sum.keySet());
        var whole = new long[keys.size()];
        long allocated = routeTotal - unallocated;
        long rest = allocated;
        for (int i = 0; i < keys.size(); i++) {
            whole[i] = (long) Math.floor(sum.get(keys.get(i))[0]);
            rest -= whole[i];
        }
        var order = new ArrayList<Integer>();
        for (int i = 0; i < keys.size(); i++) {
            order.add(i);
        }
        order.sort((i, j) -> Double.compare(sum.get(keys.get(j))[0] - whole[j], sum.get(keys.get(i))[0] - whole[i]));
        for (int k = 0; k < rest && k < order.size(); k++) {
            whole[order.get(k)]++;
        }
        var items = new ArrayList<Map<String, Object>>();
        for (int i = 0; i < keys.size(); i++) {
            var s = names.get(keys.get(i));
            var item = new LinkedHashMap<String, Object>();
            item.put("direction", s.direction());
            item.put("seq", s.seq());
            item.put("name", s.name());
            item.put("boardings", whole[i]);
            items.add(item);
        }
        var out = new LinkedHashMap<String, Object>();
        out.put("route", route);
        out.put("date", day.toString());
        out.put("hour", hour);
        out.put("dayType", stops.dayType(day));
        out.put("routeTotal", routeTotal);
        // посадки часов, для которых долей нет вовсе, — не теряются молча
        out.put("unallocated", unallocated);
        // час → час, чьи доли взяты: в октябре в этот час посадок не было
        out.put("sharesFrom", borrowed);
        out.put("confidence", stops.confidence(route));
        out.put("estimate", "доли остановок из валидаций 13—31 октября, привязанных к остановке по времени и расписанию; точность ±1—2 остановки");
        out.put("stops", items);
        return out;
    }

    /** Маршруты, для которых есть доли остановок, и уверенность в направлении рейсов. */
    @GetMapping("/stops/routes")
    public List<Map<String, Object>> routes() {
        var out = new ArrayList<Map<String, Object>>();
        for (int route : forecast.routes()) {
            var item = new LinkedHashMap<String, Object>();
            item.put("route", route);
            item.put("confidence", stops.has(route) ? stops.confidence(route) : "не оценён");
            out.add(item);
        }
        return out;
    }
}
