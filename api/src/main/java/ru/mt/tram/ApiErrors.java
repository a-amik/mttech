package ru.mt.tram;

import java.util.Map;

import org.springframework.core.io.buffer.DataBufferLimitException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/** Причина отказа возвращается текстом: клиент должен понять, что поправить в запросе. */
@RestControllerAdvice
class ApiErrors {

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, Object>> onBadRequest(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode())
                .body(Map.of("status", e.getStatusCode().value(), "message", String.valueOf(e.getReason())));
    }

    /** Тело больше лимита кодека (256 КБ): так выглядит попытка занять память сервиса, а не запрос экрана. */
    @ExceptionHandler(DataBufferLimitException.class)
    ResponseEntity<Map<String, Object>> onTooLarge(DataBufferLimitException e) {
        return ResponseEntity.status(HttpStatus.CONTENT_TOO_LARGE)
                .body(Map.of("status", 413, "message", "тело запроса больше 256 КБ"));
    }
}
