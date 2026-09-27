"""Эмулятор навигационной платформы: вагоны всех 38 трамвайных маршрутов Москвы едут
по настоящим трассам и шлют отметки ГЛОНАСС в /api/telemetry.

Трассы — из web/public/data/network.json: десять маршрутов задания и 28 остальных из OSM.
Бортовые номера маршрутов задания — настоящие, из валидаций 21 октября 2025 года,
чтобы экран мог связать вагон на карте с его посадками.

В поток подмешиваются сбои, какие дают бортовые терминалы: нули вместо координат,
скачок от переотражения сигнала, опоздавшая и повторная отметка, время из будущего,
вагон, замолчавший на линии. Сколько каких подмешано, сверяется с тем, сколько
сервис отбросил по каждой причине.

    python3 loadtest/glonass.py --per-route 16 --period 1 --duration 60 [--faults] [--out summary.json]
"""
import argparse
import base64
import http.client
import json
import math
import random
import sys
import time
import urllib.parse
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
NETWORK = HERE.parent / "web/public/data/network.json"
LIVE = HERE.parent / "web/public/data/live/2025-10-21.json"
COS = math.cos(math.radians(55.75))


def metres(a, b):
    return math.hypot((a[0] - b[0]) * 111_320 * COS, (a[1] - b[1]) * 111_320)


class Path_:
    def __init__(self, pts):
        self.pts = pts
        self.cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            self.cum.append(self.cum[-1] + metres(a, b))
        self.length = self.cum[-1]

    def at(self, s):
        """Точка и курс на расстоянии s от начала; туда и обратно по кругу."""
        s = s % (2 * self.length)
        back = s > self.length
        if back:
            s = 2 * self.length - s
        lo, hi = 0, len(self.cum) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if self.cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        a, b = self.pts[lo], self.pts[hi]
        seg = self.cum[hi] - self.cum[lo] or 1
        k = (s - self.cum[lo]) / seg
        lon, lat = a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k
        dx, dy = (b[0] - a[0]) * COS, b[1] - a[1]
        course = (math.degrees(math.atan2(dx, dy)) + (180 if back else 0)) % 360
        return lat, lon, course


def routes():
    net = json.loads(NETWORK.read_text())
    out = {}
    for rid, pts in net["task"].items():
        if len(pts) > 1:
            out[rid] = [Path_(pts)]
    for r in net["routes"]:
        paths = [Path_(line) for line in r["lines"] if len(line) > 1]
        paths = [p for p in paths if p.length > 500]
        if paths:
            out[r["id"]] = paths
    return out


def real_boards():
    if not LIVE.exists():
        return {}
    return {r: [t["board"] for t in trams] for r, trams in json.loads(LIVE.read_text()).items()}


class Vehicle:
    def __init__(self, board, route, path, rnd):
        self.board, self.route, self.path = board, route, path
        self.s = rnd.uniform(0, 2 * path.length)
        self.v = rnd.uniform(14, 26)          # км/ч в среднем с остановками
        self.dwell = 0.0
        self.silent_from = None
        self.last = None
        self.prev = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:18080")
    ap.add_argument("--ingest", default="ingest:load-ingest")
    ap.add_argument("--user", default="dispatcher:load-test")
    ap.add_argument("--per-route", type=int, default=16)
    ap.add_argument("--period", type=float, default=1.0, help="секунд между отметками вагона")
    ap.add_argument("--duration", type=float, default=60)
    ap.add_argument("--faults", action="store_true")
    ap.add_argument("--silent-after", type=float, default=10, help="через сколько секунд замолкают вагоны")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out")
    args = ap.parse_args()
    rnd = random.Random(args.seed)

    paths, boards = routes(), real_boards()
    fleet, taken = [], set()
    for n, (rid, ps) in enumerate(sorted(paths.items())):
        real = [b for b in boards.get(rid, []) if b not in taken]
        for i in range(args.per_route):
            board = real[i] if i < len(real) else f"9{n:02d}{i:03d}"
            taken.add(board)
            fleet.append(Vehicle(board, rid, rnd.choice(ps), rnd))
    # Каждый двадцатый вагон замолкает: терминал отказал или вагон ушёл в депо без связи.
    if args.faults:
        for v in rnd.sample(fleet, len(fleet) // 20):
            v.silent_from = args.silent_after

    url = urllib.parse.urlparse(args.base)
    conn = http.client.HTTPConnection(url.hostname, url.port, timeout=30)
    auth_d = "Basic " + base64.b64encode(args.user.encode()).decode()
    conn.request("GET", "/api/vehicles", headers={"Authorization": auth_d})
    before = json.loads(conn.getresponse().read())["received"]
    auth = "Basic " + base64.b64encode(args.ingest.encode()).decode()
    injected = Counter()
    sent = 0
    late_ticks = 0
    posts = []
    start = time.time()
    tick = 0
    prev_t = 0.0
    while True:
        due = start + tick * args.period
        now = time.time()
        if now - start >= args.duration:
            break
        if due > now:
            time.sleep(due - now)
        elif now - due > args.period:
            late_ticks += 1
        tick += 1
        t = time.time()
        dt = t - prev_t if prev_t else args.period
        prev_t = t
        elapsed = t - start
        lines = ["board;route;time;lat;lon;speed;course"]
        for v in fleet:
            if v.silent_from is not None and elapsed >= v.silent_from:
                injected["silent_points"] += 1
                continue
            if v.dwell > 0:
                v.dwell -= dt
                speed = 0.0
            else:
                speed = v.v * rnd.uniform(0.7, 1.3)
                v.s += speed / 3.6 * dt
                if rnd.random() < 0.02 * dt:
                    v.dwell = rnd.uniform(15, 40)  # остановка
            lat, lon, course = v.path.at(v.s)
            ms = int(t * 1000)
            kind = "accepted"
            if args.faults:
                r = rnd.random()
                if r < 0.002:
                    lat, lon, kind = 0.0, 0.0, "outside"
                elif r < 0.007 and v.last is not None:
                    lat, kind = lat + 0.03, "jump"
                elif r < 0.008:
                    ms, kind = ms + 600_000, "future"
            if kind == "accepted" and v.last is not None and args.faults:
                r = rnd.random()
                if r < 0.01:
                    lines.append(v.last)
                    injected["duplicate"] += 1
                elif r < 0.015 and v.prev is not None:
                    lines.append(v.prev)
                    injected["old"] += 1
            line = f"{v.board};{v.route};{ms};{lat:.6f};{lon:.6f};{speed:.1f};{course:.0f}"
            lines.append(line)
            injected[kind] += 1
            if kind == "accepted":
                v.prev, v.last = v.last, line
        body = ("\n".join(lines) + "\n").encode()
        t0 = time.time()
        try:
            conn.request("POST", "/api/telemetry", body=body,
                         headers={"Authorization": auth, "Content-Type": "text/csv"})
            resp = conn.getresponse()
            payload = json.loads(resp.read())
            if resp.status != 200:
                print("ответ", resp.status, payload, file=sys.stderr)
        except (OSError, http.client.HTTPException) as e:
            print("обрыв:", e, file=sys.stderr)
            conn.close()
            conn = http.client.HTTPConnection(url.hostname, url.port, timeout=30)
            continue
        posts.append((time.time() - t0) * 1000)
        sent += len(lines) - 1

    # Что увидит экран сразу после конца потока.
    conn.request("GET", "/api/vehicles", headers={"Authorization": auth_d})
    seen = json.loads(conn.getresponse().read())
    fleet_boards = {v.board for v in fleet}
    mine = [i for i in seen["items"] if i["board"] in fleet_boards]
    wall = time.time() - start
    ages = sorted(i["age"] for i in mine if not i["stale"])
    posts.sort()
    q = lambda xs, p: xs[min(len(xs) - 1, int(len(xs) * p))] if xs else 0
    silent_expected = sum(1 for v in fleet if v.silent_from is not None and wall - v.silent_from > seen["staleAfter"])
    summary = {
        "routes": len(paths),
        "vehicles": len(fleet),
        "period_s": args.period,
        "points": sent,
        "points_per_second": round(sent / wall),
        "late_ticks": late_ticks,
        "post_ms": {"med": round(q(posts, 0.5), 1), "p95": round(q(posts, 0.95), 1), "max": round(posts[-1] if posts else 0, 1)},
        "injected": dict(injected),
        "server": {k: v - before.get(k, 0) for k, v in seen["received"].items()},
        "screen": {"vehicles": len(mine), "online": sum(1 for i in mine if not i["stale"]),
                   "stale": sum(1 for i in mine if i["stale"]),
                   "stale_expected": silent_expected, "age_p95_s": q(ages, 0.95), "age_max_s": ages[-1] if ages else None},
    }
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    if args.out:
        Path(args.out).write_text(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
