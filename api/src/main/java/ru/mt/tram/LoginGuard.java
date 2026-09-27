package ru.mt.tram;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

/**
 * Перебор паролей не должен отнимать процессор у диспетчеров. Проверка пароля через bcrypt
 * стоит около 55 мс ядра, и неверные пароли не кэшируются: сотня таких запросов в секунду
 * занимает оба ядра контейнера. Поэтому до проверки пароля:
 *
 * - адрес, с которого за минуту пришло больше failsPerIp неверных пар, получает 429
 *   на blockMinutes, не доходя до bcrypt;
 * - пара, которая только что не подошла, отклоняется сразу, без повторного bcrypt;
 * - новых проверок bcrypt в секунду не больше bcryptPerSecond на весь сервис. Остальным —
 *   429 с Retry-After. Уже проверенные пары идут мимо лимита: у работающего диспетчера
 *   пароль в кэше, и атака его не задевает.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class LoginGuard implements WebFilter {

    private static final long WINDOW_MS = 60_000;
    private static final long FAILED_PAIR_MS = 60_000;
    private static final int TRACKED = 10_000;

    private final CachingAuthentication auth;
    private final int bcryptPerSecond;
    private final int failsPerIp;
    private final long blockMs;

    private final ConcurrentHashMap<String, Window> byIp = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> failedPairs = new ConcurrentHashMap<>();
    private final AtomicInteger spent = new AtomicInteger();
    private volatile long second;

    LoginGuard(CachingAuthentication auth,
               @Value("${api.guard.bcrypt-per-second:8}") int bcryptPerSecond,
               @Value("${api.guard.fails-per-ip:20}") int failsPerIp,
               @Value("${api.guard.block-minutes:5}") int blockMinutes) {
        this.auth = auth;
        this.bcryptPerSecond = bcryptPerSecond;
        this.failsPerIp = failsPerIp;
        this.blockMs = blockMinutes * 60_000L;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        var header = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.regionMatches(true, 0, "Basic ", 0, 6)) {
            return chain.filter(exchange);
        }
        long now = System.currentTimeMillis();
        var ip = ip(exchange);
        var window = byIp.get(ip);
        if (window != null && window.blockedUntil > now) {
            return refuse(exchange, HttpStatus.TOO_MANY_REQUESTS, (window.blockedUntil - now) / 1000 + 1,
                    "слишком много неверных паролей с этого адреса");
        }
        var key = key(header);
        if (key == null) {
            return chain.filter(exchange);
        }
        var failedUntil = failedPairs.get(key);
        if (failedUntil != null && failedUntil > now) {
            fail(ip, now);
            return refuse(exchange, HttpStatus.UNAUTHORIZED, 0, "неверный логин или пароль");
        }
        if (!auth.known(key) && !takeBcrypt(now)) {
            return refuse(exchange, HttpStatus.TOO_MANY_REQUESTS, 1, "проверка паролей перегружена, повторите через секунду");
        }
        return chain.filter(exchange).doFinally(signal -> {
            if (exchange.getResponse().getStatusCode() == HttpStatus.UNAUTHORIZED) {
                long t = System.currentTimeMillis();
                if (failedPairs.size() > TRACKED) {
                    failedPairs.clear();
                }
                failedPairs.put(key, t + FAILED_PAIR_MS);
                fail(ip, t);
            }
        });
    }

    private boolean takeBcrypt(long now) {
        long s = now / 1000;
        if (s != second) {
            second = s;
            spent.set(0);
        }
        return spent.incrementAndGet() <= bcryptPerSecond;
    }

    private void fail(String ip, long now) {
        if (byIp.size() > TRACKED) {
            byIp.values().removeIf(w -> w.blockedUntil < now && now - w.started > WINDOW_MS);
        }
        byIp.compute(ip, (k, w) -> {
            if (w == null || now - w.started > WINDOW_MS) {
                w = new Window(now);
            }
            if (++w.fails > failsPerIp) {
                w.blockedUntil = now + blockMs;
            }
            return w;
        });
    }

    private static String key(String header) {
        try {
            var raw = new String(Base64.getDecoder().decode(header.substring(6).trim()), StandardCharsets.UTF_8);
            return CachingAuthentication.key(raw);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String ip(ServerWebExchange exchange) {
        var address = exchange.getRequest().getRemoteAddress();
        return address == null || address.getAddress() == null ? "unknown" : address.getAddress().getHostAddress();
    }

    private static Mono<Void> refuse(ServerWebExchange exchange, HttpStatus status, long retryAfter, String message) {
        var response = exchange.getResponse();
        response.setStatusCode(status);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        if (retryAfter > 0) {
            response.getHeaders().set(HttpHeaders.RETRY_AFTER, Long.toString(retryAfter));
        }
        if (status == HttpStatus.UNAUTHORIZED) {
            response.getHeaders().set(HttpHeaders.WWW_AUTHENTICATE, "Basic realm=\"Realm\"");
        }
        var body = "{\"status\":" + status.value() + ",\"message\":\"" + message + "\"}";
        var buffer = response.bufferFactory().wrap(body.getBytes(StandardCharsets.UTF_8));
        return response.writeWith(Mono.just(buffer));
    }

    private static final class Window {
        final long started;
        int fails;
        long blockedUntil;

        Window(long started) {
            this.started = started;
        }
    }
}
