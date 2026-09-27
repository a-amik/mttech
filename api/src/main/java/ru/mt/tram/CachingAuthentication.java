package ru.mt.tram;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.security.authentication.ReactiveAuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import reactor.core.publisher.Mono;

/**
 * Проверка пароля идёт через bcrypt и стоит около 55 мс — на каждый запрос, потому
 * что базовая авторизация сессии не держит. Успешная пара логин-пароль запоминается
 * на пять минут: в памяти лежит не пароль, а его SHA-256.
 */
class CachingAuthentication implements ReactiveAuthenticationManager {

    private static final Duration TTL = Duration.ofMinutes(5);
    private static final int LIMIT = 100;

    private final ReactiveAuthenticationManager delegate;
    private final ConcurrentHashMap<String, Entry> cache = new ConcurrentHashMap<>();
    // Одновременные первые запросы с одной парой ждут одну проверку bcrypt, а не каждый свою:
    // в начале смены экран открывают разом, и без этого часть запросов упиралась в лимит.
    private final ConcurrentHashMap<String, Mono<Authentication>> pending = new ConcurrentHashMap<>();

    CachingAuthentication(ReactiveAuthenticationManager delegate) {
        this.delegate = delegate;
    }

    @Override
    public Mono<Authentication> authenticate(Authentication authentication) {
        var key = key(authentication.getName() + ":" + authentication.getCredentials());
        var hit = cache.get(key);
        if (hit != null && hit.until().isAfter(Instant.now())) {
            return Mono.just(new UsernamePasswordAuthenticationToken(
                    authentication.getName(), null, hit.authorities()));
        }
        return pending.computeIfAbsent(key, k -> delegate.authenticate(authentication).doOnNext(ok -> {
            if (cache.size() >= LIMIT) {
                cache.clear();
            }
            cache.put(key, new Entry(Instant.now().plus(TTL), List.copyOf(ok.getAuthorities())));
        }).doFinally(signal -> pending.remove(key)).cache());
    }

    /** Пара уже проверена или проверяется прямо сейчас — нового bcrypt для неё не будет. */
    boolean known(String key) {
        var hit = cache.get(key);
        return hit != null && hit.until().isAfter(Instant.now()) || pending.containsKey(key);
    }

    static String key(String raw) {
        try {
            var digest = MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private record Entry(Instant until, List<? extends GrantedAuthority> authorities) {
    }
}
