"""Непрерывный поток валидаций: настоящий день идёт в /api/ingest в реальном темпе
или быстрее — как слал бы приёмник от валидаторов, пачкой раз в несколько секунд.

День — вторник 21 октября 2025 года (тот же, что у replay.py), перенесённый на день
окна прогноза. Часы потока идут от --start с ускорением --speed: при ×1 это обычные
сутки, при ×100 час данных проходит за 36 секунд. После каждой пачки сервис
спрашивается, какая последняя валидация уже видна, — это отставание экрана от потока.

    python3 loadtest/stream.py --speed 10 --duration 120 [--batch 5] [--out stream.json]
"""
import argparse
import base64
import bisect
import http.client
import json
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from replay import SOURCE_DAY, source_rows  # noqa: E402


def minute(line):
    ts = line.split(";")[2]
    return int(ts[11:13]) * 60 + int(ts[14:16]) + int(ts[17:19]) / 60


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:18080")
    ap.add_argument("--ingest", default="ingest:load-ingest")
    ap.add_argument("--user", default="dispatcher:load-test")
    ap.add_argument("--day", default="2025-12-10")
    ap.add_argument("--start", default="06:00", help="время дня, с которого идёт поток")
    ap.add_argument("--speed", type=float, default=1)
    ap.add_argument("--batch", type=float, default=5, help="секунд между пачками")
    ap.add_argument("--duration", type=float, default=120)
    ap.add_argument("--route", default="25", help="по какому маршруту мерить отставание")
    ap.add_argument("--out")
    args = ap.parse_args()

    header, rows = source_rows()
    rows = sorted(rows, key=minute)
    keys = [minute(x) for x in rows]
    h, m = map(int, args.start.split(":"))
    v0 = h * 60 + m
    url = urllib.parse.urlparse(args.base)
    conn = http.client.HTTPConnection(url.hostname, url.port, timeout=60)
    ingest = "Basic " + base64.b64encode(args.ingest.encode()).decode()
    user = "Basic " + base64.b64encode(args.user.encode()).decode()

    start = time.time()
    sent_to = v0
    batches, lags, posts, sent = 0, [], [], 0
    while time.time() - start < args.duration:
        time.sleep(max(0.0, start + (batches + 1) * args.batch - time.time()))
        now_v = v0 + (time.time() - start) * args.speed / 60
        if now_v >= 24 * 60:
            break
        lo, hi = bisect.bisect_right(keys, sent_to), bisect.bisect_right(keys, now_v)
        chunk = [x.replace(SOURCE_DAY, args.day) for x in rows[lo:hi]]
        body = ("\n".join([header] + chunk) + "\n").encode()
        t0 = time.time()
        conn.request("POST", "/api/ingest", body=body, headers={
            "Authorization": ingest, "Content-Type": "text/csv", "X-Batch-Id": f"stream-{args.day}-{sent_to:.3f}"})
        resp = conn.getresponse()
        resp.read()
        posts.append((time.time() - t0) * 1000)
        sent += len(chunk)
        sent_to = now_v
        batches += 1
        conn.request("GET", f"/api/fact?route={args.route}&date={args.day}", headers={"Authorization": user})
        fact = json.loads(conn.getresponse().read())
        if fact.get("lastValidation"):
            hh, mm = map(int, fact["lastValidation"].split(":"))
            # Отставание в минутах потока: насколько последняя видимая валидация старше часов потока.
            lags.append(now_v - (hh * 60 + mm))

    wall = time.time() - start
    q = lambda xs, p: sorted(xs)[min(len(xs) - 1, int(len(xs) * p))] if xs else None
    summary = {
        "speed": args.speed,
        "batch_s": args.batch,
        "stream_minutes": round((sent_to - v0), 1),
        "rows": sent,
        "rows_per_second": round(sent / wall, 1),
        "batches": batches,
        "post_ms": {"med": round(q(posts, 0.5), 1), "p95": round(q(posts, 0.95), 1), "max": round(max(posts), 1)},
        # Валидации маршрута идут не каждую секунду, поэтому в отставании есть и паузы между ними.
        "lag_stream_min": {"med": round(q(lags, 0.5), 2), "p95": round(q(lags, 0.95), 2)},
        "lag_wall_s": {"med": round(q(lags, 0.5) * 60 / args.speed, 1), "p95": round(q(lags, 0.95) * 60 / args.speed, 1)},
    }
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    if args.out:
        Path(args.out).write_text(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
