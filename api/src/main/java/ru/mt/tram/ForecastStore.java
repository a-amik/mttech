package ru.mt.tram;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.stream.Stream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Прогноз лежит в памяти целиком: десять маршрутов × 61 день × 24 часа — это
 * 14 640 чисел, меньше шестидесяти килобайт. Считать нечего, API только выбирает
 * нужный срез, поэтому ответ не зависит от нагрузки на модель.
 *
 * Файл — тот же, что уходит на лидерборд: route;date;hour;prediction. Неполная сетка,
 * дубль ячейки, час вне 0—23 или отрицательный прогноз останавливают запуск: новая версия
 * прогноза не выходит в работу, пока старый контейнер отвечает. Версия — начало SHA-256 файла.
 */
@Component
public class ForecastStore {

    private static final Logger log = LoggerFactory.getLogger(ForecastStore.class);
    private static final int HOURS = 24;

    private final int[] routes;
    private final int[][][] values;   // [маршрут][день][час]
    private final LocalDate firstDay;
    private final int days;
    private final String version;

    public ForecastStore(@Value("${forecast.file}") Path file) throws IOException {
        var rows = read(file);
        this.routes = rows.stream().mapToInt(Row::route).distinct().sorted().toArray();
        this.firstDay = rows.stream().map(Row::date).min(LocalDate::compareTo).orElseThrow();
        var lastDay = rows.stream().map(Row::date).max(LocalDate::compareTo).orElseThrow();
        this.days = (int) ChronoUnit.DAYS.between(firstDay, lastDay) + 1;
        this.values = new int[routes.length][days][HOURS];
        var seen = new boolean[routes.length][days][HOURS];
        for (var row : rows) {
            int r = routeIndex(row.route());
            int d = (int) ChronoUnit.DAYS.between(firstDay, row.date());
            if (seen[r][d][row.hour()]) {
                throw new IllegalStateException("В прогнозе дубль: маршрут " + row.route() + ", " + row.date() + ", час " + row.hour());
            }
            seen[r][d][row.hour()] = true;
            values[r][d][row.hour()] = row.prediction();
        }
        if (rows.size() != points()) {
            throw new IllegalStateException("Сетка прогноза неполная: строк " + rows.size() + " из " + points()
                    + " (маршрутов " + routes.length + " × дней " + days + " × 24 часа)");
        }
        this.version = sha256(file).substring(0, 12);
        log.info("Прогноз загружен: маршрутов {}, дней {}, версия {}, файл {}", routes.length, days, version, file);
    }

    private static String sha256(Path file) throws IOException {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static List<Row> read(Path file) throws IOException {
        if (!Files.isReadable(file)) {
            throw new IOException("Файл прогноза не найден: " + file.toAbsolutePath());
        }
        var rows = new ArrayList<Row>(15_000);
        try (Stream<String> lines = Files.lines(file, StandardCharsets.UTF_8)) {
            lines.skip(1).forEach(line -> {
                if (line.isBlank()) {
                    return;
                }
                var p = line.split(";");
                if (p.length != 4) {
                    throw new IllegalStateException("Строка прогноза не route;date;hour;prediction: " + line);
                }
                int hour = Integer.parseInt(p[2].trim());
                double prediction = Double.parseDouble(p[3].trim());
                if (hour < 0 || hour >= HOURS || !Double.isFinite(prediction) || prediction < 0) {
                    throw new IllegalStateException("Строка прогноза вне допустимого: " + line);
                }
                rows.add(new Row(Integer.parseInt(p[0].trim()), LocalDate.parse(p[1].trim()), hour, (int) Math.round(prediction)));
            });
        }
        return rows;
    }

    public int[] routes() {
        return routes.clone();
    }

    /** Начало SHA-256 файла прогноза: по нему видно, какая версия отвечает. */
    public String version() {
        return version;
    }

    public LocalDate firstDay() {
        return firstDay;
    }

    public LocalDate lastDay() {
        return firstDay.plusDays(days - 1L);
    }

    public int points() {
        return routes.length * days * HOURS;
    }

    public boolean hasRoute(int route) {
        return routeIndex(route) >= 0;
    }

    public boolean covers(LocalDate day) {
        return !day.isBefore(firstDay) && !day.isAfter(lastDay());
    }

    /** Посадки маршрута за час. Дни и маршруты вне окна прогноза дают ноль. */
    public int value(int route, LocalDate day, int hour) {
        int r = routeIndex(route);
        int d = (int) ChronoUnit.DAYS.between(firstDay, day);
        if (r < 0 || d < 0 || d >= days || hour < 0 || hour >= HOURS) {
            return 0;
        }
        return values[r][d][hour];
    }

    private int routeIndex(int route) {
        for (int i = 0; i < routes.length; i++) {
            if (routes[i] == route) {
                return i;
            }
        }
        return -1;
    }

    private record Row(int route, LocalDate date, int hour, int prediction) {
    }
}
