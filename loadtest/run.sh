#!/bin/sh
# Нагрузочные проверки сервиса. Каждая поднимает свой контур, пишет результат
# в results/<время>-<проверка>/ и гасит контур за собой.
#
#   sh loadtest/run.sh build      образ из корневого Dockerfile (тот, что уходит жюри)
#   sh loadtest/run.sh steps      ступени 100 → 2000 запросов в секунду на одной копии
#   sh loadtest/run.sh ingest     приём test.csv целиком под нагрузкой экрана
#   sh loadtest/run.sh failover   две копии за nginx, одна падает под нагрузкой
#   sh loadtest/run.sh auth       перебор паролей: без защиты, с разных адресов, с одного
#   sh loadtest/run.sh gaps       провалы данных: пропуски, дубли, опоздания, мусор
#   sh loadtest/run.sh glonass    координаты 38 маршрутов: 600 и 6000 отметок в секунду со сбоями
#   sh loadtest/run.sh stream     поток валидаций ×1, ×10, ×100, ×1000 под нагрузкой экрана
#   sh loadtest/run.sh abuse      злоупотребления: роли, огромные тела, медленные соединения, подмена адреса
#   sh loadtest/run.sh stops      посадки по остановкам: сумма, согласие с прогнозом, отказы, старт без долей
#   sh loadtest/run.sh soak       8 часов всего сразу; LOAD_PORT=18090 COMPOSE_PROJECT_NAME=tram-soak
#   sh loadtest/run.sh all        всё по очереди
set -eu
cd "$(dirname "$0")"
HERE=$(pwd)
IMAGE=${IMAGE:-tram-forecast:load}
LOAD_PORT=${LOAD_PORT:-18080}
BASE=http://localhost:$LOAD_PORT
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-tram-load}
export IMAGE LOAD_PORT COMPOSE_PROJECT_NAME

out() {
  OUT="$HERE/results/$(date +%Y%m%d-%H%M%S)-$1"
  mkdir -p "$OUT"
  echo "→ $OUT"
}

up() {
  docker compose --profile "$1" up -d --quiet-pull >/dev/null 2>&1
  i=0
  until curl -sf "$BASE/api/health" >/dev/null; do
    i=$((i + 1)); [ $i -gt 120 ] && { echo "сервис не поднялся"; exit 1; }
    sleep 0.5
  done
}

down() {
  docker compose --profile single --profile pair down -t 2 >/dev/null 2>&1 || true
}

# docker stats раз в секунду, пока жив процесс $1
stats() {
  echo "time;name;cpu;mem" > "$OUT/stats.csv"
  while kill -0 "$1" 2>/dev/null; do
    docker stats --no-stream --format "{{.Name}};{{.CPUPerc}};{{.MemUsage}}" \
      | grep "^$COMPOSE_PROJECT_NAME" | sed "s/^/$(date +%s);/" >> "$OUT/stats.csv" || true
    sleep "${STATS_EVERY:-1}"
  done
}

k6run() {
  script=$1; name=$2; shift 2
  k6 run --quiet --no-color -e BASE="$BASE" "$@" --summary-export "$OUT/$name.json" "k6/$script" \
    > "$OUT/$name.txt" 2>&1 || echo "  $name: пороги не выдержаны (см. $name.txt)"
}

report() {
  python3 report.py "$OUT" | tee "$OUT/report.md"
}

build() {
  docker buildx build --platform "${PLATFORM:-linux/$(uname -m | sed s/x86_64/amd64/ | sed s/aarch64/arm64/)}" \
    -t "$IMAGE" --load .. 
}

steps() {
  out steps; down; up single
  k6run steps.js steps -e STEPS="${STEPS:-100,300,500,1000,2000}" -e HOLD="${HOLD:-40}" & pid=$!
  stats $pid & wait $pid
  down; report
}

ingest() {
  out ingest; down; up single
  k6run steady.js steady -e DURATION="${INGEST_WINDOW:-180s}" & pid=$!
  stats $pid &
  sleep 10
  unzip -p ../data/source/dataset.zip test.csv \
    | curl -s -T - -X POST -u ingest:load-ingest -H 'Content-Type: text/csv' \
        -H "X-Batch-Id: test-csv-$(date +%s)" "$BASE/api/ingest" > "$OUT/ingest.json"
  wait $pid
  down; report
}

failover() {
  out failover; down; up pair
  k6run steady.js steady -e DURATION=90s -e MAX_FAILED=0.001 & pid=$!
  stats $pid &
  sleep 30; echo "$(date +%s);kill api-a" >> "$OUT/events.txt"; docker compose kill api-a >/dev/null
  sleep 30; echo "$(date +%s);start api-a" >> "$OUT/events.txt"; docker compose --profile pair start api-a >/dev/null
  wait $pid
  down; report
}

# Диспетчеры с хоста, атака из контейнера в сети контура: у них разные адреса.
flood_case() {
  case_name=$1; shift
  down
  env "$@" docker compose --profile single up -d --quiet-pull >/dev/null
  until curl -sf "$BASE/api/health" >/dev/null; do sleep 0.5; done
  k6run steady.js "$case_name-dispatchers" -e RPS=200 -e DURATION=60s & pid=$!
  stats $pid &
  docker run --rm --network "${COMPOSE_PROJECT_NAME}_default" -v "$HERE/k6:/k6:ro" -v "$OUT:/out" grafana/k6:latest \
    run --quiet --no-color -e BASE=http://api:8080 -e RPS="${FLOOD_RPS:-100}" -e DURATION=60s \
    --summary-export "/out/$case_name-flood.json" /k6/flood.js > "$OUT/$case_name-flood.txt" 2>&1 || true
  wait $pid
  mv "$OUT/stats.csv" "$OUT/$case_name-stats.csv"
}

auth() {
  out auth
  flood_case unprotected GUARD_BCRYPT_PER_SECOND=1000000 GUARD_FAILS_PER_IP=1000000
  flood_case distributed GUARD_FAILS_PER_IP=1000000
  flood_case single-ip
  down; report
}

glonass() {
  out glonass; down
  TELEMETRY_STALE_SECONDS=30 up single
  k6run steady.js steady -e DURATION=150s & pid=$!
  stats $pid &
  python3 glonass.py --base "$BASE" --per-route 16 --period 1 --duration 60 --faults --out "$OUT/glonass-600.json" >/dev/null
  python3 glonass.py --base "$BASE" --per-route 16 --period 0.1 --duration 60 --faults --seed 8 --out "$OUT/glonass-6000.json" >/dev/null
  wait $pid
  down; report
}

stream() {
  out stream; down; up single
  k6run steady.js steady -e DURATION=330s & pid=$!
  stats $pid &
  python3 stream.py --base "$BASE" --speed 1 --duration 60 --start 08:00 --day 2025-12-03 --out "$OUT/stream-1.json" >/dev/null
  python3 stream.py --base "$BASE" --speed 10 --duration 60 --start 07:00 --day 2025-12-04 --out "$OUT/stream-10.json" >/dev/null
  python3 stream.py --base "$BASE" --speed 100 --duration 90 --start 06:00 --day 2025-12-05 --out "$OUT/stream-100.json" >/dev/null
  python3 stream.py --base "$BASE" --speed 1000 --duration 90 --start 05:00 --batch 1 --day 2025-12-08 --out "$OUT/stream-1000.json" >/dev/null
  wait $pid
  down; report
}

# Долгий прогон: экран, координаты и валидации в реальном темпе одновременно. Идёт своим
# контуром на порту 18090, чтобы остальные проверки можно было гонять параллельно.
# k6 — кусками по 30 минут: так видно, растёт ли задержка к концу.
soak() {
  out soak; down
  up single
  hours=${SOAK_HOURS:-8}
  end=$(( $(date +%s) + hours * 3600 ))
  python3 glonass.py --base "$BASE" --per-route 16 --period 1 --duration $((hours * 3600)) --faults \
    --out "$OUT/soak-glonass.json" > "$OUT/soak-glonass.log" 2>&1 &
  gpid=$!
  python3 stream.py --base "$BASE" --speed 1 --duration $((hours * 3600)) --batch 10 \
    --start "$(TZ=Europe/Moscow date +%H:%M)" --day 2025-12-10 --out "$OUT/soak-stream.json" > "$OUT/soak-stream.log" 2>&1 &
  spid=$!
  stats $gpid > /dev/null 2>&1 &
  k=0
  while [ "$(date +%s)" -lt "$end" ]; do
    k6run steady.js "soak-$(printf %02d $k)" -e RPS="${SOAK_RPS:-50}" -e DURATION=30m
    k=$((k + 1))
  done
  wait $gpid $spid || true
  down; report
}

abuse() {
  out abuse; down; up single
  k6run steady.js steady -e DURATION=150s -e RPS=100 & pid=$!
  stats $pid &
  # Из своего контейнера: у атаки свой адрес, и блокировка перебора не задевает диспетчеров.
  docker run --rm --network "${COMPOSE_PROJECT_NAME}_default" -v "$HERE:/lt" -v "$OUT:/out" python:3.12-alpine \
    python /lt/abuse.py --base http://api:8080 --out /out/abuse.md 2> "$OUT/abuse.log" >/dev/null || echo "  abuse: есть непройденные"
  wait $pid
  down; report
}

stops() {
  out stops; down; up single
  python3 stops.py --base "$BASE" --out "$OUT/stops.md" 2> "$OUT/stops.log" >/dev/null || echo "  stops: есть непройденные"
  down
  STOPS_FILE=/app/data/absent.csv up single
  python3 stops.py --base "$BASE" --absent --out "$OUT/stops.md" 2>> "$OUT/stops.log" >/dev/null || echo "  stops без файлов: есть непройденные"
  down; report
}

gaps() {
  out gaps; down; up single
  python3 replay.py --base "$BASE" --out "$OUT/gaps.md" || echo "  gaps: есть расхождения"
  down; report
}

case "${1:-}" in
  build) build ;;
  steps) steps ;;
  ingest) ingest ;;
  failover) failover ;;
  auth) auth ;;
  gaps) gaps ;;
  glonass) glonass ;;
  stream) stream ;;
  soak) soak ;;
  abuse) abuse ;;
  stops) stops ;;
  all) steps; ingest; failover; auth; gaps; glonass; stream; abuse; stops ;;
  *) sed -n '2,18p' "$0"; exit 1 ;;
esac
