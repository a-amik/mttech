package ru.mt.tram;

import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import jakarta.annotation.PreDestroy;
import org.springframework.core.ResolvableType;
import org.springframework.core.codec.StringDecoder;
import org.springframework.core.io.buffer.DataBufferLimitException;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Scheduler;
import reactor.core.scheduler.Schedulers;

/**
 * Координаты вагонов от навигационной платформы: пачка отметок CSV, строка на отметку.
 * Разбор идёт в одном отдельном потоке — так проверки «не старше ли отметка той,
 * что уже на карте» не гоняются между собой, а приём не отнимает у экрана больше ядра.
 *
 *   board;route;time;lat;lon;speed;course
 *   31055;25;2026-09-27T09:15:02Z;55.7801;37.6012;18.5;94
 *
 * time — ISO-8601 или миллисекунды от 1970 года; route, speed, course необязательны.
 */
@RestController
@RequestMapping("/api")
public class TelemetryController {

    private static final int ERRORS_SHOWN = 5;

    private final TelemetryStore store;
    private final Scheduler parser = Schedulers.newSingle("telemetry");
    private final StringDecoder lines = StringDecoder.textPlainOnly(List.of("\n"), true);

    public TelemetryController(TelemetryStore store) {
        this.store = store;
    }

    @PreDestroy
    void stop() {
        parser.dispose();
    }

    @PostMapping("/telemetry")
    public Mono<Map<String, Object>> telemetry(ServerHttpRequest request) {
        var run = new Run();
        return lines.decode(request.getBody(), ResolvableType.forClass(String.class), null, null)
                .onErrorMap(DataBufferLimitException.class, e -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "строка длиннее 256 КБ: это не пачка координат"))
                .publishOn(parser)
                .doOnNext(run::line)
                .then(Mono.fromSupplier(run::result));
    }

    /** Вагоны на карте: последнее положение и давность связи. stale — дольше порога без отметок. */
    @GetMapping("/vehicles")
    public Map<String, Object> vehicles(@RequestParam(required = false) String route) {
        long now = System.currentTimeMillis();
        var items = new ArrayList<Map<String, Object>>();
        int stale = 0;
        for (var p : store.positions(route)) {
            boolean lost = store.stale(p, now);
            stale += lost ? 1 : 0;
            var row = new LinkedHashMap<String, Object>();
            row.put("board", p.board());
            row.put("route", p.route());
            row.put("lat", p.lat());
            row.put("lon", p.lon());
            row.put("speed", p.speed());
            row.put("course", p.course());
            row.put("time", Instant.ofEpochMilli(p.time()).toString());
            row.put("age", (now - p.time()) / 1000);
            row.put("stale", lost);
            items.add(row);
        }
        var out = new LinkedHashMap<String, Object>();
        out.put("now", Instant.ofEpochMilli(now).toString());
        out.put("staleAfter", store.staleMs() / 1000);
        out.put("vehicles", items.size());
        out.put("online", items.size() - stale);
        out.put("stale", stale);
        out.put("received", store.counts());
        out.put("items", items);
        return out;
    }

    private final class Run {
        private final long started = System.nanoTime();
        private long lineNo;
        private long rows;
        private long rejected;
        private final EnumMap<TelemetryStore.Verdict, Long> verdicts = new EnumMap<>(TelemetryStore.Verdict.class);
        private final List<String> errors = new ArrayList<>();
        private int colBoard = -1;
        private int colRoute = -1;
        private int colTime = -1;
        private int colLat = -1;
        private int colLon = -1;
        private int colSpeed = -1;
        private int colCourse = -1;
        private int columns;

        void line(String raw) {
            lineNo++;
            var line = raw.endsWith("\r") ? raw.substring(0, raw.length() - 1) : raw;
            if (line.isBlank()) {
                return;
            }
            if (colBoard < 0) {
                header(line);
                return;
            }
            rows++;
            var p = line.split(";", -1);
            if (p.length < columns) {
                reject("полей " + p.length + " вместо " + columns);
                return;
            }
            try {
                var board = p[colBoard].trim();
                if (board.isEmpty()) {
                    reject("нет бортового номера");
                    return;
                }
                var t = p[colTime].trim();
                long time = !t.isEmpty() && Character.isDigit(t.charAt(t.length() - 1)) && t.chars().allMatch(Character::isDigit)
                        ? Long.parseLong(t) : Instant.parse(t).toEpochMilli();
                double lat = Double.parseDouble(p[colLat].trim());
                double lon = Double.parseDouble(p[colLon].trim());
                double speed = colSpeed < 0 || p[colSpeed].isBlank() ? 0 : Double.parseDouble(p[colSpeed].trim());
                double course = colCourse < 0 || p[colCourse].isBlank() ? 0 : Double.parseDouble(p[colCourse].trim());
                if (!Double.isFinite(course)) {
                    course = 0;
                }
                var route = colRoute < 0 ? "" : p[colRoute].trim();
                var v = store.put(board, route, time, lat, lon, speed, course, System.currentTimeMillis());
                verdicts.merge(v, 1L, Long::sum);
            } catch (RuntimeException e) {
                reject("число или время не разобрано");
            }
        }

        private void header(String line) {
            var names = line.split(";", -1);
            for (int i = 0; i < names.length; i++) {
                switch (names[i].trim()) {
                    case "board" -> colBoard = i;
                    case "route" -> colRoute = i;
                    case "time" -> colTime = i;
                    case "lat" -> colLat = i;
                    case "lon" -> colLon = i;
                    case "speed" -> colSpeed = i;
                    case "course" -> colCourse = i;
                    default -> {
                    }
                }
            }
            if (colBoard < 0 || colTime < 0 || colLat < 0 || colLon < 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "первая строка — заголовок: board;route;time;lat;lon;speed;course, обязательны board, time, lat, lon");
            }
            columns = 1 + Math.max(Math.max(colBoard, colTime), Math.max(Math.max(colLat, colLon),
                    Math.max(colRoute, Math.max(colSpeed, colCourse))));
        }

        private void reject(String why) {
            rejected++;
            if (errors.size() < ERRORS_SHOWN) {
                errors.add("строка " + lineNo + ": " + why);
            }
        }

        Map<String, Object> result() {
            if (colBoard < 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "пустая пачка: нет даже заголовка");
            }
            double seconds = (System.nanoTime() - started) / 1e9;
            var out = new LinkedHashMap<String, Object>();
            out.put("rows", rows);
            for (var v : TelemetryStore.Verdict.values()) {
                out.put(v.name().toLowerCase(), verdicts.getOrDefault(v, 0L));
            }
            out.put("unparsed", rejected);
            out.put("errors", errors);
            out.put("seconds", Math.round(seconds * 1000) / 1000.0);
            return out;
        }
    }
}
