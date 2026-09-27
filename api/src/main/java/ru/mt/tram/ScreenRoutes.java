package ru.mt.tram;

import java.util.regex.Pattern;

import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;

import reactor.core.publisher.Mono;

/**
 * У каждого раздела экрана свой адрес: /table, /map, /sim, /reports/models и так далее.
 * Файла по такому пути нет, раздел рисует сам экран, поэтому сервис отдаёт на него index.html,
 * а экран по адресу открывает нужный раздел. Прямая ссылка и перезагрузка страницы попадают
 * туда же, куда вела кнопка. Авторизация та же, что у всего экрана: фильтр подменяет только путь.
 */
@Component
class ScreenRoutes implements WebFilter {

    // Список разделов тот же, что в web/src/lib/route.ts.
    private static final Pattern SCREEN = Pattern.compile("^/(table|map|month|year|live|sim|reports)(/[a-z-]+)?/?$");

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        var request = exchange.getRequest();
        if (request.getMethod() == HttpMethod.GET && SCREEN.matcher(request.getPath().value()).matches()) {
            return chain.filter(exchange.mutate().request(request.mutate().path("/index.html").build()).build());
        }
        return chain.filter(exchange);
    }
}
