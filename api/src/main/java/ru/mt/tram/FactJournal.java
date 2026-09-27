package ru.mt.tram;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Журнал принятого факта на диске: перезапуск копии не теряет посадки, принятые из выгрузок.
 * Строка на маршрут-день внутри пачки — «маршрут;день;24 часа;минута», пачка открывается
 * строкой «#пачка;номер». Пишется после того, как пачка целиком легла в память, с dsync:
 * половины пачки в журнале не бывает. Пустой путь — журнала нет, факт живёт до перезапуска.
 */
final class FactJournal {

    private static final Logger log = LoggerFactory.getLogger(FactJournal.class);

    private final Path file;
    private FileChannel out;

    FactJournal(String path) {
        file = path == null || path.isBlank() ? null : Path.of(path);
    }

    boolean enabled() {
        return out != null;
    }

    Path path() {
        return file;
    }

    /** Воспроизводит журнал в хранилище и открывает его на дозапись. */
    void open(FactStore store) {
        if (file == null) {
            return;
        }
        try {
            Files.createDirectories(file.toAbsolutePath().getParent());
            if (Files.exists(file)) {
                replay(store);
            }
            out = FileChannel.open(file, StandardOpenOption.CREATE, StandardOpenOption.WRITE,
                    StandardOpenOption.APPEND, StandardOpenOption.DSYNC);
        } catch (IOException e) {
            log.warn("журнал факта {} недоступен, факт живёт в памяти до перезапуска: {}", file, e.getMessage());
            out = null;
        }
    }

    private void replay(FactStore store) throws IOException {
        int batches = 0;
        long rows = 0;
        try (BufferedReader in = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            Map<Long, int[]> part = new LinkedHashMap<>();
            String batch = null;
            for (String line; (line = in.readLine()) != null; ) {
                if (line.startsWith("#")) {
                    flush(store, part, batch);
                    part = new LinkedHashMap<>();
                    batch = line.length() > 1 ? line.substring(1) : null;
                    batches++;
                    continue;
                }
                var f = line.split(";");
                if (f.length != 27) {
                    continue;
                }
                var add = new int[25];
                for (int i = 0; i < 25; i++) {
                    add[i] = Integer.parseInt(f[i + 2]);
                }
                part.put(FactStore.key(Integer.parseInt(f[0]), Long.parseLong(f[1])), add);
                rows++;
            }
            flush(store, part, batch);
        }
        log.info("журнал факта {}: восстановлено пачек {}, строк {}", file, batches, rows);
    }

    private static void flush(FactStore store, Map<Long, int[]> part, String batch) {
        if (part.isEmpty()) {
            return;
        }
        store.addAll(part);
        if (batch != null && !batch.isEmpty()) {
            store.claimBatch(batch);
        }
    }

    /** Дописывает принятую пачку; сбой записи не роняет приём, только предупреждает. */
    synchronized void append(String batch, Map<Long, int[]> part) {
        if (out == null || part.isEmpty()) {
            return;
        }
        var sb = new StringBuilder(64 + part.size() * 80);
        sb.append('#').append(batch == null ? "" : batch).append('\n');
        for (var e : part.entrySet()) {
            long key = e.getKey();
            sb.append(key / 1_000_000L).append(';').append(key % 1_000_000L);
            for (int v : e.getValue()) {
                sb.append(';').append(v);
            }
            sb.append('\n');
        }
        try {
            out.write(StandardCharsets.UTF_8.encode(sb.toString()));
        } catch (IOException e) {
            log.warn("журнал факта {}: пачка {} не записана: {}", file, batch, e.getMessage());
        }
    }
}
