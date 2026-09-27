package ru.mt.tram;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLongArray;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Последнее положение каждого вагона по ГЛОНАСС. Трек не храним: экрану диспетчера нужно,
 * где вагон сейчас и давно ли он выходил на связь, а история точек — задача навигационной
 * платформы, откуда они приходят.
 *
 * Точка проходит проверки до того, как сдвинет вагон на карте. Отметки отбрасываются
 * по причинам — так видно, что именно шлёт неисправный терминал.
 */
@Component
public class TelemetryStore {

    // Москва с запасом: всё, что снаружи, — сбой приёмника (частый случай — нули вместо координат).
    static final double LAT_MIN = 55.1;
    static final double LAT_MAX = 56.1;
    static final double LON_MIN = 36.8;
    static final double LON_MAX = 38.3;
    // Трамвай быстрее 80 км/ч не ездит; скорость между двумя отметками выше 150 км/ч — скачок
    // координат от переотражения сигнала среди домов, а не движение.
    static final double SPEED_MAX = 80;
    static final double JUMP_KMH = 150;
    static final long FUTURE_MS = 60_000;
    static final int BOARDS_MAX = 20_000;

    enum Verdict { ACCEPTED, OUTSIDE, SPEED, FUTURE, JUMP, OLD, DUPLICATE, OVERFLOW }

    record Position(String board, String route, long time, double lat, double lon, double speed, double course,
                    long received) {
    }

    private final ConcurrentHashMap<String, Position> boards = new ConcurrentHashMap<>();
    // Последняя отметка, отброшенная как скачок. Если следующая с ней согласна, скачком был,
    // наоборот, прежний вагон на карте — иначе вагон с неверной первой отметкой застрял бы навсегда.
    private final ConcurrentHashMap<String, Position> jumped = new ConcurrentHashMap<>();
    private final AtomicLongArray counts = new AtomicLongArray(Verdict.values().length);
    private final long staleMs;

    public TelemetryStore(@Value("${telemetry.stale-seconds:120}") int staleSeconds) {
        this.staleMs = staleSeconds * 1000L;
    }

    Verdict put(String board, String route, long time, double lat, double lon, double speed, double course, long now) {
        var point = new Position(board, route, time, lat, lon, speed, course, now);
        var verdict = check(board, time, lat, lon, speed, now);
        if (verdict == Verdict.JUMP) {
            var prev = jumped.put(board, point);
            if (prev != null && time > prev.time() && fits(prev, lat, lon, time)) {
                verdict = Verdict.ACCEPTED;
            }
        }
        counts.incrementAndGet(verdict.ordinal());
        if (verdict == Verdict.ACCEPTED) {
            boards.put(board, point);
            jumped.remove(board);
        }
        return verdict;
    }

    private Verdict check(String board, long time, double lat, double lon, double speed, long now) {
        // NaN проходит любые сравнения, поэтому границы проверяются прямыми условиями
        if (!(lat >= LAT_MIN && lat <= LAT_MAX && lon >= LON_MIN && lon <= LON_MAX)) {
            return Verdict.OUTSIDE;
        }
        if (!(speed >= 0 && speed <= SPEED_MAX)) {
            return Verdict.SPEED;
        }
        if (time > now + FUTURE_MS) {
            return Verdict.FUTURE;
        }
        var last = boards.get(board);
        if (last == null) {
            return boards.size() >= BOARDS_MAX ? Verdict.OVERFLOW : Verdict.ACCEPTED;
        }
        if (time == last.time()) {
            return Verdict.DUPLICATE;
        }
        // Опоздавшая отметка старше той, что уже на карте, вагон назад не двигает.
        if (time < last.time()) {
            return Verdict.OLD;
        }
        return fits(last, lat, lon, time) ? Verdict.ACCEPTED : Verdict.JUMP;
    }

    private static boolean fits(Position from, double lat, double lon, long time) {
        double hours = (time - from.time()) / 3_600_000.0;
        return km(from.lat(), from.lon(), lat, lon) / hours <= JUMP_KMH;
    }

    List<Position> positions(String route) {
        var out = new ArrayList<Position>(boards.size());
        for (var p : boards.values()) {
            if (route == null || route.equals(p.route())) {
                out.add(p);
            }
        }
        return out;
    }

    boolean stale(Position p, long now) {
        return now - p.time() > staleMs;
    }

    long staleMs() {
        return staleMs;
    }

    Map<String, Long> counts() {
        var out = new java.util.LinkedHashMap<String, Long>();
        for (var v : Verdict.values()) {
            out.put(v.name().toLowerCase(), counts.get(v.ordinal()));
        }
        return out;
    }

    static double km(double lat1, double lon1, double lat2, double lon2) {
        double dy = (lat2 - lat1) * 111.32;
        double dx = (lon2 - lon1) * 111.32 * Math.cos(Math.toRadians((lat1 + lat2) / 2));
        return Math.hypot(dx, dy);
    }
}
