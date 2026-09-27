package ru.mt.tram;

import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

import jakarta.annotation.PreDestroy;
import org.springframework.core.ResolvableType;
import org.springframework.core.codec.StringDecoder;
import org.springframework.core.io.buffer.DataBufferLimitException;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Scheduler;
import reactor.core.scheduler.Schedulers;

/**
 * Приём валидаций выгрузкой в формате train.csv. Тело читается потоком, строка за строкой:
 * файл в гигабайты в память не ложится. Разбор идёт в одном отдельном потоке — приём
 * не отнимает у экрана диспетчера больше одного ядра, сколько бы выгрузок ни пришло.
 */
@RestController
@RequestMapping("/api")
public class IngestController {

    private static final int ERRORS_SHOWN = 5;
    // Факт принимается за год до окна прогноза и год после: дальше — ошибка источника, а не история.
    private static final int DAYS_AROUND = 366;

    private final FactStore facts;
    private final ForecastStore store;
    private final Scheduler parser = Schedulers.newSingle("ingest");
    private final StringDecoder lines = StringDecoder.textPlainOnly(List.of("\n"), true);

    public IngestController(FactStore facts, ForecastStore store) {
        this.facts = facts;
        this.store = store;
    }

    @PreDestroy
    void stop() {
        parser.dispose();
    }

    /**
     * X-Batch-Id — номер пачки у отправителя. Пачку с уже принятым номером не считаем
     * второй раз: после обрыва связи источник может прислать её повторно.
     */
    @PostMapping("/ingest")
    public Mono<Map<String, Object>> ingest(ServerHttpRequest request,
                                            @RequestHeader(value = "X-Batch-Id", required = false) String batch) {
        if (batch != null && !facts.claimBatch(batch)) {
            var out = new LinkedHashMap<String, Object>();
            out.put("batch", batch);
            out.put("duplicate", true);
            out.put("accepted", 0);
            // Тело дочитывается и выбрасывается: ответ до конца отправки рвёт соединение у источника.
            return request.getBody().then(Mono.just(out));
        }
        var run = new Run();
        return lines.decode(request.getBody(), ResolvableType.forClass(String.class), null, null)
                .onErrorMap(DataBufferLimitException.class, e -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "строка длиннее 256 КБ: это не выгрузка train.csv"))
                .publishOn(parser)
                .doOnNext(run::line)
                .then(Mono.fromSupplier(() -> {
                    var out = run.result(batch);
                    facts.accept(batch, run.part);
                    return out;
                }))
                .doOnError(e -> release(batch))
                .doOnCancel(() -> release(batch));
    }

    private void release(String batch) {
        if (batch != null) {
            facts.releaseBatch(batch);
        }
    }

    /** Факт маршрута за день: посадки по часам и время последней валидации. */
    @GetMapping("/fact")
    public Map<String, Object> fact(@RequestParam int route, @RequestParam String date) {
        LocalDate day;
        try {
            day = LocalDate.parse(date);
        } catch (RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "дата в формате ГГГГ-ММ-ДД: " + date);
        }
        var cell = facts.day(route, day);
        var out = new LinkedHashMap<String, Object>();
        out.put("route", route);
        out.put("date", day.toString());
        out.put("lastIngest", facts.lastIngest() == null ? null : facts.lastIngest().toString());
        if (cell == null) {
            out.put("hours", null);
            out.put("lastValidation", null);
            return out;
        }
        var hours = new int[24];
        System.arraycopy(cell, 0, hours, 0, 24);
        out.put("hours", hours);
        out.put("lastValidation", clock(cell[FactStore.LAST_MINUTE]));
        return out;
    }

    static String clock(int minuteOfDay) {
        return minuteOfDay < 0 ? null : String.format("%02d:%02d", minuteOfDay / 60, minuteOfDay % 60);
    }

    /** Разбор одной выгрузки. Живёт в потоке ingest, поэтому без синхронизации. */
    private final class Run {
        private final long started = System.nanoTime();
        private long lineNo;
        private long rows;
        private long accepted;
        private long refused;
        private long rejected;
        private long foreign;
        private final List<String> errors = new ArrayList<>();
        // Посадки пачки копятся здесь и уходят в общий факт одним движением в конце.
        private final HashMap<Long, int[]> part = new HashMap<>();
        private final long minDay = store.firstDay().toEpochDay() - DAYS_AROUND;
        private final long maxDay = store.lastDay().toEpochDay() + DAYS_AROUND;
        private int[] lastCell;
        private long lastCellKey = Long.MIN_VALUE;
        private final TreeSet<Integer> routes = new TreeSet<>();
        private final TreeSet<String> days = new TreeSet<>();
        private int colTime = -1;
        private int colResult = -1;
        private int colRoute = -1;
        private int columns;
        private long lastDayKey = Long.MIN_VALUE;
        private long lastEpochDay;
        private final int[] cut = new int[64];

        void line(String raw) {
            lineNo++;
            var line = raw.endsWith("\r") ? raw.substring(0, raw.length() - 1) : raw;
            if (line.isEmpty()) {
                return;
            }
            if (colTime < 0) {
                header(line);
                return;
            }
            rows++;
            int n = split(line);
            if (n < columns) {
                reject("полей " + n + " вместо " + columns);
                return;
            }
            if (!field(line, colResult).equals("1")) {
                refused++;
                return;
            }
            var ts = field(line, colTime);
            var route = leadingNumber(field(line, colRoute));
            if (ts.length() < 16 || route < 0) {
                reject(route < 0 ? "нет номера маршрута" : "время не в формате ГГГГ-ММ-ДД чч:мм");
                return;
            }
            if (!store.hasRoute(route)) {
                foreign++;
                return;
            }
            try {
                int year = Integer.parseInt(ts, 0, 4, 10);
                int month = Integer.parseInt(ts, 5, 7, 10);
                int dom = Integer.parseInt(ts, 8, 10, 10);
                int hour = Integer.parseInt(ts, 11, 13, 10);
                int minute = Integer.parseInt(ts, 14, 16, 10);
                if (hour > 23 || minute > 59) {
                    reject("час или минута вне суток");
                    return;
                }
                long dayKey = year * 10_000L + month * 100L + dom;
                if (dayKey != lastDayKey) {
                    lastEpochDay = LocalDate.of(year, month, dom).toEpochDay();
                    lastDayKey = dayKey;
                    if (lastEpochDay >= minDay && lastEpochDay <= maxDay) {
                        days.add(ts.substring(0, 10));
                    }
                }
                if (lastEpochDay < minDay || lastEpochDay > maxDay) {
                    reject("дата дальше года от окна прогноза");
                    return;
                }
                long cellKey = FactStore.key(route, lastEpochDay);
                if (cellKey != lastCellKey) {
                    lastCell = part.computeIfAbsent(cellKey, k -> {
                        var a = new int[25];
                        a[FactStore.LAST_MINUTE] = -1;
                        return a;
                    });
                    lastCellKey = cellKey;
                }
                lastCell[hour]++;
                lastCell[FactStore.LAST_MINUTE] = Math.max(lastCell[FactStore.LAST_MINUTE], hour * 60 + minute);
                routes.add(route);
                accepted++;
            } catch (RuntimeException e) {
                reject("время не в формате ГГГГ-ММ-ДД чч:мм");
            }
        }

        private void header(String line) {
            var names = line.split(";", -1);
            for (int i = 0; i < names.length; i++) {
                switch (unquote(names[i]).trim()) {
                    case "tran_date_time" -> colTime = i;
                    case "validation_result" -> colResult = i;
                    case "ngpt_route" -> colRoute = i;
                    default -> {
                    }
                }
            }
            if (colTime < 0 || colResult < 0 || colRoute < 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "первая строка — заголовок train.csv: нужны tran_date_time, validation_result, ngpt_route");
            }
            columns = Math.max(colTime, Math.max(colResult, colRoute)) + 1;
        }

        /** Границы полей в cut: без split и лишних строк на каждую из миллионов строк. */
        private int split(String line) {
            int n = 0;
            cut[n++] = -1;
            for (int i = 0; i < line.length() && n < cut.length; i++) {
                if (line.charAt(i) == ';') {
                    cut[n++] = i;
                }
            }
            if (n < cut.length) {
                cut[n] = line.length();
            }
            return n;
        }

        private String field(String line, int col) {
            return unquote(line.substring(cut[col] + 1, cut[col + 1]));
        }

        private void reject(String why) {
            rejected++;
            if (errors.size() < ERRORS_SHOWN) {
                errors.add("строка " + lineNo + ": " + why);
            }
        }

        Map<String, Object> result(String batch) {
            if (colTime < 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "пустая выгрузка: нет даже заголовка");
            }
            double seconds = Duration.ofNanos(System.nanoTime() - started).toMillis() / 1000.0;
            var out = new LinkedHashMap<String, Object>();
            out.put("batch", batch);
            out.put("duplicate", false);
            out.put("rows", rows);
            out.put("accepted", accepted);
            out.put("refused", refused);
            out.put("rejected", rejected);
            out.put("foreign", foreign);
            out.put("errors", errors);
            out.put("routes", routes);
            out.put("days", days.size() <= 3 ? days : List.of(days.first(), "…", days.last()));
            out.put("seconds", seconds);
            out.put("rowsPerSecond", seconds > 0 ? Math.round(rows / seconds) : rows);
            return out;
        }
    }

    private static String unquote(String s) {
        return s.length() >= 2 && s.charAt(0) == '"' && s.charAt(s.length() - 1) == '"' ? s.substring(1, s.length() - 1) : s;
    }

    private static int leadingNumber(String s) {
        int i = 0;
        while (i < s.length() && Character.isDigit(s.charAt(i))) {
            i++;
        }
        if (i == 0 || i > 6) {
            return -1;
        }
        return Integer.parseInt(s, 0, i, 10);
    }
}
