"""Вагоны на линии по сырым валидациям сентября—октября: для живого показа и телеметрии.

Читает test.csv прямо из dataset.zip кусками. На выход — web/public/data/live/<дата>.json:
по маршруту список вагонов (бортовой номер, выход, площадка, посадки по часам, первая
и последняя валидация в минутах от полуночи) и web/public/data/depots.json — какие
маршруты какая площадка выпускает. GPS в наборе нет: место вагона на трассе экран
восстанавливает сам, по времени от первой валидации.
"""
import json
import zipfile
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
ZIP = ROOT / "data/source/dataset.zip"
OUT = ROOT / "web/public/data/live"
COLS = ["tran_date_time", "validation_result", "place_id", "ngpt_route", "bus_exit_no", "garage_number"]

# (дата, маршрут, борт) → счётчики
hours: dict = defaultdict(lambda: [0] * 24)
first: dict = {}
last: dict = {}
exit_of: dict = {}
place_of: dict = defaultdict(lambda: defaultdict(int))
route_place: dict = defaultdict(lambda: defaultdict(int))

with zipfile.ZipFile(ZIP) as z, z.open("test.csv") as f:
    for part in pd.read_csv(f, sep=";", usecols=COLS, chunksize=2_000_000, dtype=str):
        part = part[part["validation_result"] == "1"].dropna(subset=["garage_number", "ngpt_route"])
        ts = pd.to_datetime(part["tran_date_time"], errors="coerce")
        part = part.assign(date=ts.dt.strftime("%Y-%m-%d"), hour=ts.dt.hour, minute=ts.dt.hour * 60 + ts.dt.minute,
                           route=part["ngpt_route"].str.extract(r"(\d+)")[0])
        part = part.dropna(subset=["date", "route"])
        g = part.groupby(["date", "route", "garage_number", "hour"]).size()
        for (d, r, b, h), n in g.items():
            hours[(d, r, b)][int(h)] += int(n)
        m = part.groupby(["date", "route", "garage_number"])["minute"].agg(["min", "max"])
        for key, row in m.iterrows():
            first[key] = min(first.get(key, 1440), int(row["min"]))
            last[key] = max(last.get(key, 0), int(row["max"]))
        for key, ex in part.groupby(["date", "route", "garage_number"])["bus_exit_no"].agg(lambda s: s.mode().iat[0]).items():
            exit_of.setdefault(key, ex)
        for (b, p), n in part.groupby(["garage_number", "place_id"]).size().items():
            place_of[b][p] += int(n)
        for (r, p), n in part.groupby(["route", "place_id"]).size().items():
            route_place[r][p] += int(n)
        print("кусок", len(part), flush=True)

OUT.mkdir(parents=True, exist_ok=True)
by_day: dict = defaultdict(lambda: defaultdict(list))
for (d, r, b), hs in hours.items():
    place = max(place_of[b].items(), key=lambda x: x[1])[0] if place_of[b] else None
    by_day[d][r].append({"board": b, "exit": exit_of.get((d, r, b)), "place": place, "hours": hs,
                         "first": first[(d, r, b)], "last": last[(d, r, b)]})
for d, routes in by_day.items():
    for r in routes:
        routes[r].sort(key=lambda t: t["first"])
    (OUT / f"{d}.json").write_text(json.dumps(routes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

depots = {r: sorted(((p, n) for p, n in ps.items()), key=lambda x: -x[1]) for r, ps in route_place.items()}
(ROOT / "web/public/data/depots.json").write_text(json.dumps(depots, ensure_ascii=False), encoding="utf-8")
print("дней", len(by_day), "вагонов-дней", len(hours))
