"""Злоупотребления: запросы, которыми можно положить сервис, не зная пароля или зная его.
Каждая проверка — что шлём, какой ответ считаем правильным и что пришло на деле.
Параллельно run.sh держит нагрузку экрана: сервис должен отбиваться, не мешая диспетчерам.

    python3 loadtest/abuse.py [--base http://localhost:18080] [--out abuse.md]
"""
import argparse
import base64
import http.client
import json
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def basic(pair):
    return "Basic " + base64.b64encode(pair.encode()).decode()


def call(base, path, method="GET", auth=None, body=None, headers=None, timeout=60):
    req = urllib.request.Request(base + path, data=body, method=method, headers=dict(headers or {}))
    if auth:
        req.add_header("Authorization", auth)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
            return r.status, len(data), time.time() - t0, data
    except urllib.error.HTTPError as e:
        data = e.read()
        return e.code, len(data), time.time() - t0, data
    except (OSError, urllib.error.URLError) as e:
        return f"обрыв: {e.__class__.__name__}", 0, time.time() - t0, b""


def send_big(host, port, path, auth, body, ctype):
    """Большое тело кусками. Сервис может ответить и закрыть соединение, не дочитав, —
    тогда ответ всё равно лежит в сокете, и его читаем."""
    conn = http.client.HTTPConnection(host, port, timeout=30)
    t0 = time.time()
    try:
        conn.putrequest("POST", path)
        conn.putheader("Authorization", auth)
        conn.putheader("Content-Type", ctype)
        conn.putheader("Content-Length", str(len(body)))
        conn.endheaders()
        for i in range(0, len(body), 65536):
            conn.send(body[i:i + 65536])
    except OSError:
        pass
    try:
        r = conn.getresponse()
        return r.status, time.time() - t0, r.read()[:200]
    except (OSError, http.client.HTTPException) as e:
        return f"обрыв без ответа: {e.__class__.__name__}", time.time() - t0, b""
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:18080")
    ap.add_argument("--out")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    host, port = urllib.parse.urlparse(base).hostname, urllib.parse.urlparse(base).port
    disp, ingest = basic("dispatcher:load-test"), basic("ingest:load-ingest")
    rows = []

    def check(name, expect, got, ok, note=""):
        rows.append((name, expect, got, "да" if ok else "НЕТ", note))
        print(("✓" if ok else "✗"), name, got, note, file=sys.stderr)

    # Роли и авторизация
    s, *_ = call(base, "/api/forecast?granularity=month")
    check("Без пароля", "401", s, s == 401)
    s, *_ = call(base, "/api/ingest", "POST", disp, b"tran_date_time;validation_result;ngpt_route\n", {"Content-Type": "text/csv"})
    check("Диспетчер шлёт валидации", "403", s, s == 403)
    s, *_ = call(base, "/api/telemetry", "POST", disp, b"board;time;lat;lon\n", {"Content-Type": "text/csv"})
    check("Диспетчер шлёт координаты", "403", s, s == 403)
    s, *_ = call(base, "/api/forecast?granularity=month", auth=ingest)
    check("Сервис приёма читает прогноз", "403", s, s == 403)

    # Размеры
    big = json.dumps({"route": 7, "date": "2025-12-24", "fact": {str(h): 100 for h in range(24)}, "pad": "x" * 10_000_000}).encode()
    s, t, _ = send_big(host, port, "/api/nowcast", disp, big, "application/json")
    check("JSON на 10 МБ в пересчёт", "413", s, s == 413, f"{t:.2f} с")
    fact = ",".join(f"{h % 24}:{h}" for h in range(10_000))
    s, n, t, _ = call(base, f"/api/nowcast?route=7&date=2025-12-24&fact={fact}", auth=disp)
    check("Факт на 10 000 пар в адресе", "414 или 400", s, s in (400, 414), f"{t:.2f} с")
    s, n, t, _ = call(base, "/api/forecast?granularity=month", auth=disp, headers={f"X-Pad-{i}": "y" * 1000 for i in range(40)})
    check("Заголовки на 40 КБ", "431 или 400", s, s in (400, 431), f"{t:.2f} с")
    s, n, t, _ = call(base, "/api/forecast?routes=" + ",".join(str(i) for i in range(1000, 1500)), auth=disp)
    check("500 несуществующих маршрутов", "404", s, s == 404, f"{t:.2f} с")
    s, n, t, _ = call(base, "/api/forecast?routes=" + ",".join(["7"] * 500), auth=disp)
    check("Маршрут 7, повторённый 500 раз, всё окно по часам", "200, ответ как на один маршрут", s,
          s == 200 and n < 300_000, f"{n / 1e3:.0f} КБ за {t:.2f} с")
    line = b"tran_date_time;validation_result;ngpt_route\n" + b"2025-12-24 08:00:00;1;" + b"7" * 5_000_000 + b"\n"
    s, t, data = send_big(host, port, "/api/ingest", ingest, line, "text/csv")
    check("Строка на 5 МБ без перевода строки в приём", "400", s, s == 400, f"{t:.2f} с")
    s, t, data = send_big(host, port, "/api/ingest", ingest, b"\x00\xff" * 2_000_000, "text/csv")
    check("4 МБ двоичного мусора в приём", "400", s, s == 400, f"{t:.2f} с")

    # Координаты: сколько разных бортов примет хранилище
    lines = ["board;route;time;lat;lon"] + [f"x{i};7;{int(time.time() * 1000)};55.75;37.6" for i in range(25_000)]
    s, n, t, data = call(base, "/api/telemetry", "POST", ingest, ("\n".join(lines) + "\n").encode(), {"Content-Type": "text/csv"})
    got = json.loads(data) if s == 200 else {}
    check("25 000 выдуманных бортов", "не больше 20 000 в памяти", f"{s}, принято {got.get('accepted')}, отказано {got.get('overflow')}",
          s == 200 and got.get("accepted", 0) <= 20_000)

    # Медленные соединения: открыли, прислали полстроки и молчат
    socks = []
    for _ in range(2000):
        try:
            c = socket.create_connection((host, port), timeout=5)
            c.sendall(b"GET /api/routes HTTP/1.1\r\nHost: x\r\n")
            socks.append(c)
        except OSError:
            break
    t0 = time.time()
    s, n, t, _ = call(base, "/api/forecast?granularity=month", auth=disp, timeout=10)
    check(f"{len(socks)} медленных соединений, запрос диспетчера", "200 быстро", s, s == 200, f"{t * 1000:.0f} мс")
    time.sleep(70)
    alive = 0
    for c in socks:
        try:
            c.settimeout(0.01)
            if c.recv(1) == b"":
                continue
            alive += 1
        except socket.timeout:
            alive += 1
        except OSError:
            pass
        finally:
            c.close()
    check("Медленные соединения через 70 с", "закрыты сервисом", f"живо {alive} из {len(socks)}", alive == 0)

    # Подмена адреса: блокировка перебора не снимается чужим X-Forwarded-For. Попытки идут
    # медленнее лимита bcrypt, чтобы 429 пришёл от блокировки, а не от лимита. Последней:
    # дальше этот адрес пять минут заблокирован.
    for i in range(22):
        call(base, "/api/routes", auth=basic(f"dispatcher:wrong-{i}"))
        time.sleep(0.15)
    s, *_ = call(base, "/api/routes", auth=disp, headers={"X-Forwarded-For": "10.9.8.7"})
    check("Перебор с адреса, потом верный пароль с чужим X-Forwarded-For", "429", s, s == 429,
          "адрес заблокирован; заголовку без балансировщика не верим")

    s, *_ = call(base, "/api/health")
    check("Сервис после всего", "200", s, s == 200)

    text = "| Проверка | Ожидаем | Получили | Верно | Примечание |\n|---|---|---|---|---|\n" + "".join(
        f"| {a} | {b} | {c} | {d} | {e} |\n" for a, b, c, d, e in rows)
    print(text)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    sys.exit(0 if all(r[3] == "да" for r in rows) else 1)


if __name__ == "__main__":
    main()
