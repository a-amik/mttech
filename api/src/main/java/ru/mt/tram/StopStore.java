package ru.mt.tram;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Доли остановок в посадках маршрута за час — из tramflow.stops: валидации октября,
 * привязанные к остановке по времени, бортовому номеру и расписанию. Прогноз по остановке —
 * прогноз маршрута за час, умноженный на долю. Это оценка: эталона по остановкам нет.
 *
 * Маршруты, у которых направление рейсов по данным не определилось, в файле отсутствуют,
 * как и маршрут 5 без истории. Файлов нет — сервис работает, метод отвечает 404.
 */
@Component
public class StopStore {

    private static final Logger log = LoggerFactory.getLogger(StopStore.class);

    /** fromHour — час, чьи доли взяты: ночью выходного в октябре посадок бывает ноль, и час берёт соседний. */
    public record Stop(int direction, int seq, String name, double share, int fromHour) {
    }

    private final Map<String, List<Stop>> shares = new HashMap<>();   // маршрут|тип дня|час
    private final Map<Integer, String> confidence = new HashMap<>();
    private final Map<LocalDate, String> dayTypes = new HashMap<>();

    public StopStore(@Value("${stops.file}") Path file, @Value("${stops.days}") Path days) throws IOException {
        if (!Files.isReadable(file) || !Files.isReadable(days)) {
            log.warn("Доли остановок не загружены: нет {} или {}", file, days);
            return;
        }
        var lines = Files.readAllLines(file, StandardCharsets.UTF_8);
        for (var line : lines.subList(1, lines.size())) {
            if (line.isBlank()) {
                continue;
            }
            // route;day_type;hour;direction;stop_seq;stop_name;share;boardings;confidence;from_hour
            var p = line.split(";", -1);
            int route = Integer.parseInt(p[0]);
            double share = Double.parseDouble(p[6]);
            if (!Double.isFinite(share) || share < 0 || share > 1) {
                throw new IllegalStateException("Доля остановки вне 0—1: " + line);
            }
            shares.computeIfAbsent(key(route, p[1], Integer.parseInt(p[2])), k -> new ArrayList<>())
                    .add(new Stop(Integer.parseInt(p[3]), Integer.parseInt(p[4]), p[5], share,
                            p.length > 9 ? Integer.parseInt(p[9]) : Integer.parseInt(p[2])));
            confidence.put(route, p[8]);
        }
        for (var line : Files.readAllLines(days, StandardCharsets.UTF_8)) {
            var p = line.split(";");
            if (p.length == 2 && !p[0].equals("date")) {
                dayTypes.put(LocalDate.parse(p[0]), p[1]);
            }
        }
        log.info("Доли остановок: маршрутов {}, срезов {}", confidence.size(), shares.size());
    }

    public boolean has(int route) {
        return confidence.containsKey(route);
    }

    public String confidence(int route) {
        return confidence.get(route);
    }

    public String dayType(LocalDate day) {
        return dayTypes.getOrDefault(day, day.getDayOfWeek().getValue() >= 6 ? "weekend" : "weekday");
    }

    /** Остановки маршрута с долями за час; пусто — посадок в этот час в октябре не было. */
    public List<Stop> stops(int route, LocalDate day, int hour) {
        return shares.getOrDefault(key(route, dayType(day), hour), List.of());
    }

    private static String key(int route, String dayType, int hour) {
        return route + "|" + dayType + "|" + hour;
    }
}
