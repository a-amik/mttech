"""Загруженность коридора маршрута по часам — Distance Matrix API 2ГИС.

Источник: https://docs.2gis.com/ru/api/navigation/distance-matrix/overview
Режим `statistics` отдаёт типичное время в пути между концами маршрута
на заданный час и тип дня. Индекс загруженности коридора — отношение этого
времени к самому свободному часу того же коридора (ночному минимуму):
1,0 — свободно, 1,2 — на пятую часть дольше. Режим `shortest` за базу
не годится: он строит кратчайший по расстоянию путь, а не самый быстрый.

Единица тарификации — пара «откуда → куда», поэтому каждая просьба
содержит ровно одну пару. Ключ лежит вне репозитория: переменная DGIS_API_KEY
или файл ~/.bee-ltzp/2gis.json ({"keys": [{"key": ...}, ...]}). Сырые ответы
пишутся в ~/.bee-ltzp/traffic-2gis-tram/ и повторно не запрашиваются;
в репозиторий уходит только сводный индекс.

    python -m tramflow.traffic plan     # сколько единиц потребует съёмка
    python -m tramflow.traffic sweep    # снять недостающее
    python -m tramflow.traffic index    # собрать data/external/2gis_congestion.csv
"""
import argparse
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

from .config import EXTERNAL

ENDPOINT = "https://routing.api.2gis.com/get_dist_matrix"
STORE = Path.home() / ".bee-ltzp" / "traffic-2gis-tram"
KEY_FILE = Path.home() / ".bee-ltzp" / "2gis.json"
MSK = timezone(timedelta(hours=3))

# Типичная неделя, по которой спрашивается статистика: дата любая,
# 2ГИС смотрит только на день недели и час.
DAY_TYPES = {"workday": "2026-10-07", "saturday": "2026-10-10", "sunday": "2026-10-11"}
HOURS = {"workday": list(range(6, 24)), "saturday": [9, 12, 15, 18, 21], "sunday": [9, 12, 15, 18, 21]}

ENDPOINTS_FILE = EXTERNAL / "route_endpoints.json"


def keys() -> list[str]:
    if os.environ.get("DGIS_API_KEY"):
        return [os.environ["DGIS_API_KEY"]]
    conf = json.loads(KEY_FILE.read_text())
    ks = [k["key"] for k in conf.get("keys", []) if k.get("key")]
    return ks or [conf["key"]]


def endpoints() -> dict:
    return json.loads(ENDPOINTS_FILE.read_text())


def tasks() -> list[dict]:
    out = []
    for route, ends in endpoints().items():
        for direction, (a, b) in enumerate([(ends["a"], ends["b"]), (ends["b"], ends["a"])]):
            out.append(dict(route=int(route), direction=direction, mode="shortest", day="", hour=-1, a=a, b=b))
            for day, hours in HOURS.items():
                for h in hours:
                    out.append(dict(route=int(route), direction=direction, mode="statistics", day=day, hour=h, a=a, b=b))
    return out


def task_id(t: dict) -> str:
    return f"{t['route']}:{t['direction']}:{t['mode']}:{t['day']}:{t['hour']}"


def ask(t: dict, key: str) -> dict:
    body = {"points": [{"lat": t["a"][0], "lon": t["a"][1]}, {"lat": t["b"][0], "lon": t["b"][1]}],
            "sources": [0], "targets": [1], "transport": "driving", "type": t["mode"]}
    if t["mode"] == "statistics":
        start = datetime.fromisoformat(DAY_TYPES[t["day"]]).replace(hour=t["hour"], tzinfo=MSK)
        body["start_time"] = start.isoformat()
    r = requests.post(ENDPOINT, params={"key": key, "version": "2.0"}, json=body, timeout=60)
    r.raise_for_status()
    route = (r.json().get("routes") or [{}])[0]
    return {"status": route.get("status", "FAIL"), "duration_s": route.get("duration"),
            "distance_m": route.get("distance")}


def done_ids() -> set:
    f = STORE / "raw.jsonl"
    if not f.exists():
        return set()
    return {json.loads(l)["id"] for l in f.read_text().splitlines() if l.strip()}


def sweep(limit: int | None) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    seen = done_ids()
    todo = [t for t in tasks() if task_id(t) not in seen]
    if limit:
        todo = todo[:limit]
    print(f"к съёмке {len(todo)} пар, снято ранее {len(seen)}")
    ks = keys()
    ki = 0
    with (STORE / "raw.jsonl").open("a") as f:
        for i, t in enumerate(todo, 1):
            pause, refused = 2.0, 0
            while True:
                try:
                    res = ask(t, ks[ki])
                    break
                except requests.HTTPError as e:
                    code = e.response.status_code
                    if code == 429:              # частота: у каждого ключа свой лимит, сперва меняем ключ
                        ki = (ki + 1) % len(ks)
                        refused += 1
                        if refused % len(ks) == 0:
                            print(f"429 на всех ключах, пауза {pause:.0f} с")
                            time.sleep(pause)
                            pause = min(pause * 2, 60)
                        continue
                    if code in (402, 403):       # ключ исчерпан: убираем его из оборота
                        ks.pop(ki)
                        if not ks:
                            raise RuntimeError("бюджет всех ключей исчерпан") from None
                        ki %= len(ks)
                        continue
                    raise RuntimeError(f"2ГИС ответил {code} на {task_id(t)}") from None
            ki = (ki + 1) % len(ks)              # чередуем ключи и в штатном ходу
            rec = {"id": task_id(t), **{k: v for k, v in t.items() if k not in ("a", "b")},
                   **res, "asked_at": datetime.now(MSK).isoformat(timespec="seconds")}
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            f.flush()
            if i % 20 == 0:
                print(i, rec["id"], rec["status"], rec["duration_s"])
            time.sleep(0.6)


def index() -> pd.DataFrame:
    rows = [json.loads(l) for l in (STORE / "raw.jsonl").read_text().splitlines() if l.strip()]
    df = pd.DataFrame(rows)
    df = df[df["status"] == "OK"]
    st = df[df["mode"] == "statistics"].copy()
    st["free_s"] = st.groupby(["route", "direction"])["duration_s"].transform("min")
    st["congestion"] = st["duration_s"] / st["free_s"]
    out = st.groupby(["route", "day", "hour"]).agg(congestion=("congestion", "mean"),
                                                   travel_s=("duration_s", "mean"),
                                                   free_s=("free_s", "mean")).round(3).reset_index()
    EXTERNAL.mkdir(parents=True, exist_ok=True)
    out.to_csv(EXTERNAL / "2gis_congestion.csv", index=False)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["plan", "sweep", "index"])
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    if a.cmd == "plan":
        t = tasks()
        print(f"пар всего {len(t)}, снято {len(done_ids())}, маршрутов {len(endpoints())}")
    elif a.cmd == "sweep":
        sweep(a.limit)
    else:
        print(index().pivot_table(index="hour", columns=["day", "route"], values="congestion").round(2).to_string())
