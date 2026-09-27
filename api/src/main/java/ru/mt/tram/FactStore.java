package ru.mt.tram;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicIntegerArray;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Факт посадок, принятый из выгрузок валидаций: маршрут × день × час. Хранится только
 * счётчик, сами валидации не держим — за день по десяти маршрутам их сотни тысяч,
 * а пересчёту нужны суммы по часам.
 *
 * В ячейке 24 лежит минута последней валидации дня: по ней видно, насколько свеж факт
 * и какой час ещё не закрыт.
 */
@Component
public class FactStore {

    static final int LAST_MINUTE = 24;
    private static final int BATCHES_KEPT = 100_000;

    private final ConcurrentHashMap<Long, AtomicIntegerArray> cells = new ConcurrentHashMap<>();
    private final AtomicLong accepted = new AtomicLong();
    private volatile Instant lastIngest;
    private final FactJournal journal;

    // Номера принятых пачек: повторная отправка той же пачки после обрыва не удваивает факт.
    private final Set<String> batches = Collections.newSetFromMap(Collections.synchronizedMap(
            new LinkedHashMap<>() {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                    return size() > BATCHES_KEPT;
                }
            }));

    public FactStore(@Value("${fact.journal:}") String journalPath) {
        journal = new FactJournal(journalPath);
        journal.open(this);
    }

    /** Принятая пачка: в память, затем в журнал на диске — перезапуск её не теряет. */
    void accept(String batch, Map<Long, int[]> part) {
        addAll(part);
        journal.append(batch, part);
        touch();
    }

    public boolean journaled() {
        return journal.enabled();
    }

    /**
     * Пачка целиком: посадки по часам и минута последней валидации на каждый маршрут-день.
     * Приём зовёт это один раз, после того как выгрузка дочитана без ошибки, — оборванная
     * посередине пачка в факт не попадает и при повторе не удваивается.
     */
    void addAll(Map<Long, int[]> part) {
        long n = 0;
        for (var e : part.entrySet()) {
            var cell = cells.computeIfAbsent(e.getKey(), k -> {
                var a = new AtomicIntegerArray(25);
                a.set(LAST_MINUTE, -1);
                return a;
            });
            var add = e.getValue();
            for (int h = 0; h < LAST_MINUTE; h++) {
                if (add[h] != 0) {
                    cell.addAndGet(h, add[h]);
                    n += add[h];
                }
            }
            cell.accumulateAndGet(LAST_MINUTE, add[LAST_MINUTE], Math::max);
        }
        accepted.addAndGet(n);
    }

    /** Посадки по часам и минута последней валидации; null — факта за этот день нет. */
    public int[] day(int route, LocalDate day) {
        var cell = cells.get(key(route, day.toEpochDay()));
        if (cell == null) {
            return null;
        }
        var out = new int[25];
        for (int i = 0; i < out.length; i++) {
            out[i] = cell.get(i);
        }
        return out;
    }

    /** true — пачка новая и помечена принятой; false — такую уже принимали. */
    boolean claimBatch(String id) {
        return batches.add(id);
    }

    void releaseBatch(String id) {
        batches.remove(id);
    }

    void touch() {
        lastIngest = Instant.now();
    }

    public Instant lastIngest() {
        return lastIngest;
    }

    public long accepted() {
        return accepted.get();
    }

    public int days() {
        return cells.size();
    }

    static long key(int route, long epochDay) {
        return route * 1_000_000L + epochDay;
    }
}
