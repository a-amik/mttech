# Образ решения: экран диспетчера и публичный API прогноза в одном контейнере.
# Интернет нужен только на сборке — у жюри его не будет, поэтому подложка карты
# и данные экрана уезжают внутрь образа файлами.

FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM maven:3.9-eclipse-temurin-21 AS api
WORKDIR /src
COPY api/pom.xml .
RUN mvn -q -B dependency:go-offline
COPY api/src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S -G app app
COPY --from=api /src/target/forecast-api-1.0.0.jar app.jar
COPY --from=web /web/dist /app/static
COPY api/data/forecast.csv api/data/stop_shares.csv api/data/day_types.csv /app/data/
RUN mkdir -p /app/state && chown app /app/state
VOLUME /app/state
USER app
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
