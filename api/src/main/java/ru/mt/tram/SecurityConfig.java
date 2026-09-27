package ru.mt.tram;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.ReactiveAuthenticationManager;
import org.springframework.security.authentication.UserDetailsRepositoryReactiveAuthenticationManager;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.core.userdetails.MapReactiveUserDetailsService;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.server.SecurityWebFilterChain;

/**
 * Базовая авторизация на всём API. Пользователей два: диспетчер читает прогноз и экран,
 * сервис приёма только загружает валидации и координаты — у каждого своя роль, и чужое ему закрыто.
 * Логины и пароли приходят переменными среды и хэшируются при старте. Открыты только
 * проверки живости — по ним ходит оркестратор контейнеров, а не человек.
 */
@Configuration
@EnableWebFluxSecurity
public class SecurityConfig {

    @Bean
    CachingAuthentication authenticationManager(@Value("${api.user}") String name,
                                                @Value("${api.password}") String password,
                                                @Value("${api.ingest-user}") String ingestName,
                                                @Value("${api.ingest-password}") String ingestPassword) {
        // Пароля по умолчанию нет: сервис без паролей в среде не поднимется, а не откроется всем.
        if (password.isBlank() || ingestPassword.isBlank()) {
            throw new IllegalStateException("Задайте API_PASSWORD и INGEST_PASSWORD: без них сервис не стартует");
        }
        var encoder = new BCryptPasswordEncoder();
        var dispatcher = User.withUsername(name).password(encoder.encode(password)).roles("DISPATCHER").build();
        var ingest = User.withUsername(ingestName).password(encoder.encode(ingestPassword)).roles("INGEST").build();
        var manager = new UserDetailsRepositoryReactiveAuthenticationManager(new MapReactiveUserDetailsService(dispatcher, ingest));
        manager.setPasswordEncoder(encoder);
        return new CachingAuthentication(manager);
    }

    @Bean
    SecurityWebFilterChain filterChain(ServerHttpSecurity http, ReactiveAuthenticationManager manager) {
        return http
                .csrf(ServerHttpSecurity.CsrfSpec::disable)
                .authenticationManager(manager)
                .authorizeExchange(exchange -> exchange
                        .pathMatchers("/api/health", "/actuator/health", "/actuator/health/**").permitAll()
                        .pathMatchers(HttpMethod.POST, "/api/ingest", "/api/telemetry").hasRole("INGEST")
                        .anyExchange().hasRole("DISPATCHER"))
                .httpBasic(basic -> {
                })
                .formLogin(ServerHttpSecurity.FormLoginSpec::disable)
                .build();
    }
}
