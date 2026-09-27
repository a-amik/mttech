"""Провалы данных: настоящий день валидаций проигрывается в сервис с поломками потока.

Берётся вторник 21 октября 2025 года из test.csv и переносится на вторники окна прогноза —
на каждый вид поломки свой день, чтобы они не смешивались. Факт по часам до полудня
отправляется выгрузками в /api/ingest, как его слал бы приёмник, а потом пересчёт остатка
дня по принятому факту сравнивается с эталоном: тем же пересчётом по чистому факту,
переданному прямо в запросе.

    python3 loadtest/replay.py [--base http://localhost:18080] [--out results/gaps.md]
"""
import argparse
import base64
import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ZIP = HERE.parent / "data/source/dataset.zip"
CACHE = HERE / "results/.cache"
SOURCE_DAY = "2025-10-21"
UNTIL = 12

# Поломки и дни, на которые переносится исходный вторник.
CASES = [
    ("clean", "2025-12-17", "Поток без сбоев"),
    ("duplicates", "2025-11-11", "Каждая пачка пришла дважды"),
    ("outage", "2025-11-18", "Маршрут 7: нет связи с валидаторами в 8 и 9 часов"),
    ("late", "2025-11-25", "Час 9 пришёл после часа 11"),
    ("burst", "2025-12-02", "Тишина с 7 часов, потом часы 7—11 одной пачкой"),
    ("silent", "2025-12-09", "Маршрут 17 молчит весь день"),
    ("spike", "2025-12-16", "Маршрут 26: посадки 8 часов удесятерены"),
    ("garbage", "2025-12-23", "В пачках тысяча битых строк"),
]


def source_rows():
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{SOURCE_DAY}.csv"
    if not path.exists():
        print(f"вырезаю {SOURCE_DAY} из test.csv…", file=sys.stderr)
        unzip = subprocess.Popen(["unzip", "-p", str(ZIP), "test.csv"], stdout=subprocess.PIPE)
        grep = subprocess.run(["grep", "-a", "-e", "^tran_no", "-e", f";{SOURCE_DAY} "],
                              stdin=unzip.stdout, capture_output=True, check=True)
        unzip.wait()
        lines = grep.stdout.decode("utf-8").splitlines()
        keep = [lines[0]] + [x for x in lines[1:] if x.split(";")[2].startswith(SOURCE_DAY)]
        path.write_text("\n".join(keep) + "\n", encoding="utf-8")
    lines = path.read_text(encoding="utf-8").splitlines()
    return lines[0], lines[1:]


def parse(line):
    p = line.split(";")
    digits = ""
    for ch in p[11]:
        if not ch.isdigit():
            break
        digits += ch
    return int(p[2][11:13]), (int(digits) if digits else None), p[6] == "1"


class Api:
    def __init__(self, base, dispatcher, ingest):
        self.base = base.rstrip("/")
        self.dispatcher = "Basic " + base64.b64encode(dispatcher.encode()).decode()
        self.ingest_auth = "Basic " + base64.b64encode(ingest.encode()).decode()

    def get(self, path, **params):
        url = f"{self.base}{path}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"Authorization": self.dispatcher})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)

    def ingest(self, header, lines, batch):
        body = ("\n".join([header] + lines) + "\n").encode("utf-8")
        req = urllib.request.Request(f"{self.base}/api/ingest", data=body, method="POST", headers={
            "Authorization": self.ingest_auth, "Content-Type": "text/csv", "X-Batch-Id": batch})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")


def shifted(lines, day):
    return [x.replace(SOURCE_DAY, day) for x in lines]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:18080")
    ap.add_argument("--user", default="dispatcher:load-test")
    ap.add_argument("--ingest", default="ingest:load-ingest")
    ap.add_argument("--out")
    args = ap.parse_args()
    api = Api(args.base, args.user, args.ingest)

    header, rows = source_rows()
    by_hour = defaultdict(list)
    fact = defaultdict(lambda: defaultdict(int))
    for line in rows:
        hour, route, ok = parse(line)
        by_hour[hour].append(line)
        if ok and route is not None:
            fact[route][hour] += 1
    routes = [r["route"] for r in api.get("/api/routes")]

    def reference(route, day):
        pairs = ",".join(f"{h}:{fact[route].get(h, 0)}" for h in range(UNTIL))
        return api.get("/api/nowcast", route=route, date=day, fact=pairs)

    def from_ingest(route, day):
        return api.get("/api/nowcast", route=route, date=day, until=UNTIL)

    def naive(route, day, hours):
        """Пересчёт, который считает провал нулём, — как было бы без распознавания провалов."""
        plain = {i["hour"]: i["prediction"] for i in api.get("/api/forecast", routes=route, **{"from": day, "to": day})["items"]}
        used = [h for h in range(UNTIL) if plain[h] >= 50]
        f, p = sum(hours.get(h, 0) for h in used), sum(plain[h] for h in used)
        if len(used) < 2 or p < 300:
            return 1.0
        return round(min(1.25, max(0.8, f / p)) ** 0.5, 4)

    def send(mode, day, hours, transform=lambda h, lines: lines, twice=False):
        results = []
        for h in hours:
            lines = transform(h, shifted(by_hour[h], day))
            batch = f"{mode}-{day}-{h:02d}"
            results.append(api.ingest(header, lines, batch))
            if twice:
                results.append(api.ingest(header, lines, batch))
        return results

    report = []

    def row(mode, day, what, route, verdict_fn, note=""):
        ref, got = reference(route, day), from_ingest(route, day)
        verdict = verdict_fn(ref, got)
        report.append((what, route, ref["factor"], got["factor"], got["applied"], got["gapHours"], note, verdict))
        return ref, got

    same = lambda ref, got: "совпадает" if ref["factor"] == got["factor"] else "РАСХОДИТСЯ"
    hours = list(range(UNTIL))

    for mode, day, what in CASES:
        if mode == "clean":
            send(mode, day, hours)
            for r in routes:
                row(mode, day, what, r, same)
        elif mode == "duplicates":
            res = send(mode, day, hours, twice=True)
            dup = sum(1 for _, b in res if b.get("duplicate"))
            for r in routes:
                row(mode, day, what, r, same, f"повторов отклонено: {dup}")
        elif mode == "outage":
            cut = lambda h, lines: [x for x in lines if not (h in (8, 9) and parse(x)[1] == 7)]
            send(mode, day, hours, cut)
            broken = {h: (0 if h in (8, 9) else c) for h, c in fact[7].items()}
            nv = naive(7, day, broken)
            row(mode, day, what, 7,
                lambda ref, got: f"провал найден, отклонение {abs(got['factor'] - ref['factor']):.4f}"
                if got["gapHours"] == [8, 9] else "провал НЕ найден",
                f"без распознавания было бы {nv}")
        elif mode == "late":
            send(mode, day, [h for h in hours if h != 9])
            before = from_ingest(7, day)
            send(mode, day, [9])
            row(mode, day, what, 7, same,
                f"до опоздавшего часа: множитель {before['factor']}, провалы {before['gapHours']}")
        elif mode == "burst":
            send(mode, day, range(7))
            lines = [x for h in range(7, UNTIL) for x in shifted(by_hour[h], day)]
            status, body = api.ingest(header, lines, f"{mode}-{day}-07-11")
            for r in routes:
                row(mode, day, what, r, same, f"пачка {body.get('rows')} строк за {body.get('seconds')} с")
        elif mode == "silent":
            send(mode, day, hours, lambda h, lines: [x for x in lines if parse(x)[1] != 17])
            row(mode, day, what, 17,
                lambda ref, got: "пересчёт не применён, остаток — обычный прогноз" if not got["applied"] else "ПРИМЕНЁН по пустому факту")
        elif mode == "spike":
            spike = lambda h, lines: lines + [x for x in lines if h == 8 and parse(x)[1] == 26] * 9
            send(mode, day, hours, spike)
            row(mode, day, what, 26,
                lambda ref, got: f"множитель в пределе {got['factor']} ≤ 1,118" if got["factor"] <= 1.1181 else "ПРЕДЕЛ ПРОБИТ")
        elif mode == "garbage":
            junk = ["мусор;без;полей", "1;2;2025-10-21 08:00:00;;;;1;52;;;;;;", "1;2;2025-13-45 99:99:00;x;x;x;1;52;1;x;x;7 трамвай;1;1"] * 334
            res = send(mode, day, hours, lambda h, lines: lines + junk[:1000] if h == 8 else lines)
            rejected = sum(b.get("rejected", 0) for _, b in res)
            codes = sorted({s for s, _ in res})
            for r in routes:
                row(mode, day, what, r, same, f"битых строк отклонено: {rejected}, ответы {codes}")

    lines = ["| Поломка | Маршрут | Эталон | По приёму | Применён | Провалы | Итог | Примечание |",
             "|---|---|---|---|---|---|---|---|"]
    for what, route, ref, got, applied, gaps, note, verdict in report:
        lines.append(f"| {what} | {route} | {ref} | {got} | {'да' if applied else 'нет'} | "
                     f"{', '.join(map(str, gaps)) or '—'} | {verdict} | {note} |")
    text = "\n".join(lines) + "\n"
    print(text)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    bad = [x for x in report if any(w in x[7] for w in ("РАСХОДИТСЯ", "НЕ найден", "ПРИМЕНЁН", "ПРОБИТ"))]
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
