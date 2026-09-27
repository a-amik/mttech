"""Трамвайная сеть Москвы для экрана: маршруты вне задания и их пересечение с маршрутами задания.

Вход — data/external/osm/network.geojson и network_stops.csv (build_network.py).
Выход — web/public/data/network.json. Пересечение — доля остановок маршрута задания,
лежащих в 120 м от остановок внешнего маршрута (так же считан Т1 в t1_overlap.csv)."""
import csv, json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OSM = ROOT / "data/external/osm"
OUT = ROOT / "web/public/data/network.json"
NEAR_M = 120
TOL = 0.00006  # упрощение трассы, ~5 м


def rdp(pts, tol):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    n = math.hypot(dx, dy) or 1e-12
    i, dmax = 0, 0.0
    for k in range(1, len(pts) - 1):
        d = abs(dy * pts[k][0] - dx * pts[k][1] + x2 * y1 - y2 * x1) / n
        if d > dmax:
            i, dmax = k, d
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return rdp(pts[: i + 1], tol)[:-1] + rdp(pts[i:], tol)


def dist_m(a, b):
    k = math.cos(math.radians(55.75))
    return math.hypot((a[0] - b[0]) * 111_320 * k, (a[1] - b[1]) * 111_320)


geo = json.loads((OSM / "network.geojson").read_text(encoding="utf-8"))
stops = {}
for r in csv.DictReader(open(OSM / "network_stops.csv", encoding="utf-8")):
    stops.setdefault(r["route"], []).append((float(r["lon"]), float(r["lat"]), r["stop_name"]))

routes = {}
for f in geo["features"]:
    p = f["properties"]
    g = f["geometry"]
    parts = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
    r = routes.setdefault(p["route"], {"id": p["route"], "task": p["task"], "name": f'{p["from"]} — {p["to"]}', "lines": []})
    if p["direction"] == 0 or not r["lines"]:  # одно направление: пути второго почти совпадают
        r["lines"] = [[[round(x, 5), round(y, 5)] for x, y in rdp(part, TOL)] for part in parts]

task = [k for k, v in routes.items() if v["task"]]
out = []
for rid, r in routes.items():
    if r["task"]:
        continue
    mine = stops.get(rid, [])
    overlap = {}
    for t in task:
        ts = stops.get(t, [])
        if not ts or not mine:
            continue
        near = sum(1 for s in ts if any(dist_m(s, m) <= NEAR_M for m in mine))
        if near:
            overlap[t] = round(near / len(ts), 3)
    names = {s[2] for s in mine}
    out.append({**r, "stops": len(names), "overlap": overlap})

def key(r):
    # номера по порядку, 1а рядом с 1; диаметры Т1, Т2 и «А» — в конце
    d = "".join(c for c in r["id"] if c.isdigit())
    return (1 if not r["id"][0].isdigit() else 0, int(d) if d else 0, r["id"])

out.sort(key=key)
# Путь вагона в живом показе — по остановкам направления «туда» в порядке следования:
# куски трасс OSM не всегда стыкуются, а остановки идут через 400—600 м и ложатся на пути.
seq = {}
for r in csv.DictReader(open(OSM / "network_stops.csv", encoding="utf-8")):
    if r["direction"] == "0":
        seq.setdefault(r["route"], []).append((int(r["seq"]), round(float(r["lon"]), 5), round(float(r["lat"]), 5)))
task_lines = {k: [[x, y] for _, x, y in sorted(v)] for k, v in seq.items() if routes.get(k, {}).get("task")}
task_tracks = {k: v["lines"] for k, v in routes.items() if v["task"]}
OUT.write_text(json.dumps({
    "source": "OpenStreetMap, © участники OpenStreetMap (ODbL); трассы на сентябрь 2026",
    "near_m": NEAR_M, "routes": out, "task": task_lines, "tracks": task_tracks}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(OUT, OUT.stat().st_size // 1024, "КБ, маршрутов", len(out))
for r in out:
    print(r["id"], r["name"], r["stops"], r["overlap"])
