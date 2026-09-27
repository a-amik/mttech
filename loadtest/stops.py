"""Посадки по остановкам: инвариант суммы, согласие с прогнозом маршрута, отказы.

Для каждого маршрута с долями — все 61 день окна × 24 часа и суммы за день:
сумма посадок по остановкам равна routeTotal с точностью до округления, а routeTotal
равен прогнозу маршрута за тот же час из /api/forecast. Маршруты без долей и неверные
параметры должны давать 404 и 400, чужая роль — 403, без пароля — 401.

    python3 loadtest/stops.py [--base http://localhost:18080] [--out stops.md]
    python3 loadtest/stops.py --absent   # сервис поднят без файлов долей
"""
import argparse
import base64
import http.client
import json
import sys
import time
import urllib.parse
from datetime import date, timedelta


class Api:
    def __init__(self, base):
        u = urllib.parse.urlparse(base)
        self.host, self.port = u.hostname, u.port
        self.conn = http.client.HTTPConnection(self.host, self.port, timeout=30)

    def get(self, path, auth="dispatcher:load-test"):
        headers = {"Authorization": "Basic " + base64.b64encode(auth.encode()).decode()} if auth else {}
        t0 = time.perf_counter()
        try:
            self.conn.request("GET", path, headers=headers)
            r = self.conn.getresponse()
            body = r.read()
        except (OSError, http.client.HTTPException):
            self.conn.close()
            self.conn = http.client.HTTPConnection(self.host, self.port, timeout=30)
            self.conn.request("GET", path, headers=headers)
            r = self.conn.getresponse()
            body = r.read()
        ms = (time.perf_counter() - t0) * 1000
        try:
            data = json.loads(body)
        except ValueError:
            data = None
        return r.status, data, ms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:18080")
    ap.add_argument("--absent", action="store_true")
    ap.add_argument("--out")
    args = ap.parse_args()
    api = Api(args.base)
    rows = []

    def check(name, expect, got, ok, note=""):
        rows.append((name, expect, got, "да" if ok else "НЕТ", note))
        print(("✓" if ok else "✗"), name, got, note, file=sys.stderr)

    if args.absent:
        s, _, _ = api.get("/api/health", auth=None)
        check("Старт без файлов долей: health", "200", s, s == 200)
        s, _, _ = api.get("/api/stops?route=17&date=2025-12-02&hour=8")
        check("Старт без файлов долей: /api/stops", "404", s, s == 404)
        s, _, _ = api.get("/api/forecast?routes=17&from=2025-12-02&to=2025-12-02")
        check("Старт без файлов долей: прогноз", "200", s, s == 200)
        return finish(rows, args.out)

    s, health, _ = api.get("/api/health", auth=None)
    first, last = date.fromisoformat(health["from"]), date.fromisoformat(health["to"])
    days = [(first + timedelta(d)).isoformat() for d in range((last - first).days + 1)]
    s, listing, _ = api.get("/api/stops/routes")
    with_shares = [str(x["route"]) for x in listing if x.get("confidence") not in (None, "не оценён")]
    without = [str(x["route"]) for x in listing if x.get("confidence") in (None, "не оценён")]
    check("Список маршрутов с долями", "7, 17, 25, 28, 50", ", ".join(with_shares), sorted(with_shares, key=int) == ["7", "17", "25", "28", "50"])

    lat, bad_sum, bad_total, empty, calls = [], [], [], [], 0
    for route in with_shares:
        _, fc, _ = api.get(f"/api/forecast?routes={route}")
        plain = {(i["date"], i["hour"]): i["prediction"] for i in fc["items"]}
        for d in days:
            for h in list(range(24)) + [None]:
                q = f"/api/stops?route={route}&date={d}" + ("" if h is None else f"&hour={h}")
                s, x, ms = api.get(q)
                calls += 1
                lat.append(ms)
                if s != 200:
                    bad_sum.append((route, d, h, f"статус {s}"))
                    continue
                total = sum(p["boardings"] for p in x["stops"]) + x.get("unallocated", 0)
                # Остатки округления раздаются по остановкам, а посадки часа без долей идут
                # в unallocated: сумма обязана совпасть с маршрутом точно.
                if total != x["routeTotal"]:
                    bad_sum.append((route, d, h, f"{total} ≠ {x['routeTotal']}"))
                if not x["stops"] and x["routeTotal"] > 0:
                    empty.append((route, d, h))
                want = sum(plain[(d, hh)] for hh in range(24)) if h is None else plain[(d, h)]
                if abs(x["routeTotal"] - want) > 1:
                    bad_total.append((route, d, h, f"{x['routeTotal']} ≠ {want}"))
    lat.sort()
    q = lambda p: lat[min(len(lat) - 1, int(len(lat) * p))]
    check(f"Сумма по остановкам + unallocated = routeTotal точно, {calls} срезов", "все", f"расхождений {len(bad_sum)}", not bad_sum,
          "; ".join(map(str, bad_sum[:3])))
    check("Пустой список остановок при ненулевом маршруте", "нет", f"срезов {len(empty)}", not empty,
          "; ".join(map(str, empty[:3])))
    check("routeTotal = прогноз маршрута за тот же час или день", "все", f"расхождений {len(bad_total)}", not bad_total,
          "; ".join(map(str, bad_total[:3])))
    check("Время ответа /api/stops", "медиана / p95", f"{q(0.5):.1f} / {q(0.95):.1f} мс", q(0.95) < 50)

    for route in ["1", "5", "11", "12", "26"]:
        s, _, _ = api.get(f"/api/stops?route={route}&date=2025-12-02&hour=8")
        check(f"Маршрут {route} без долей", "404", s, s == 404, "в списке «не оценён»" if route in without else "")
    s, _, _ = api.get("/api/stops?route=99&date=2025-12-02&hour=8")
    check("Маршрут вне прогноза", "404", s, s == 404)
    s, _, _ = api.get("/api/stops?route=17&date=2025-12-02&hour=25")
    check("hour=25", "400", s, s == 400)
    s, _, _ = api.get("/api/stops?route=17&date=2026-03-01&hour=8")
    check("Дата вне окна", "400", s, s == 400)
    s, _, _ = api.get("/api/stops?route=17&date=2025-12-02&hour=8", auth=None)
    check("Без пароля", "401", s, s == 401)
    s, _, _ = api.get("/api/stops?route=17&date=2025-12-02&hour=8", auth="ingest:load-ingest")
    check("Роль приёма", "403", s, s == 403)
    return finish(rows, args.out)


def finish(rows, out):
    text = "| Проверка | Ожидаем | Получили | Верно | Примечание |\n|---|---|---|---|---|\n" + "".join(
        f"| {a} | {b} | {c} | {d} | {e} |\n" for a, b, c, d, e in rows)
    print(text)
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(text)
    sys.exit(0 if all(r[3] == "да" for r in rows) else 1)


if __name__ == "__main__":
    main()
