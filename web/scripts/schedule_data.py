"""Плановые рейсы и выполнение выпуска для экрана.

Источник рейсов — архив расписания transport.mos.ru на даты 14.10—31.12.2025
(data/external/schedule, качалка fetch_schedule.py). Вагоны на линии — по сырым
валидациям (data/external/cards/fleet_daily.csv).

Запуск: .venv/bin/python web/scripts/schedule_data.py
Пишет web/public/data/schedule.json.
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
EXT = ROOT / "data" / "external"
OUT = ROOT / "web" / "public" / "data" / "schedule.json"
START, FACT_END, END = "2025-09-01", "2025-10-31", "2025-12-31"
# Окно, где есть и расписание на дату, и вагоны по валидациям: по нему меряется «вагонов на рейс».
REF = ("2025-10-14", "2025-10-31")


def day_type(dates: pd.Series, off: pd.Series) -> pd.Series:
    dow = dates.dt.dayofweek
    return pd.Series(["w" if not o else "sat" if d == 5 else "sun" for d, o in zip(dow, off)], index=dates.index)


def main():
    cal = pd.read_csv(EXT / "isdayoff_2025.csv", parse_dates=["date"])
    cal["off"] = cal["code"] == 1
    s = pd.read_csv(EXT / "schedule" / "route_hour.csv", parse_dates=["date"])
    s = s[s["date"] >= REF[0]]
    days = pd.date_range(REF[0], END)
    routes = sorted(s["route"].unique())
    full = pd.MultiIndex.from_product([routes, days, range(24)], names=["route", "date", "hour"])
    # рейсы от первой остановки обоих направлений → рейсов в час в каждую сторону
    trips = s.set_index(["route", "date", "hour"])["trips"].reindex(full, fill_value=0) / 2
    trips = trips.reset_index().merge(cal[["date", "off"]], on="date")
    trips["typ"] = day_type(trips["date"], trips["off"])

    ref = trips[trips["date"] <= REF[1]]
    typ = ref.groupby(["route", "typ", "hour"])["trips"].median()

    by_date, templates = {}, {}
    for r in routes:
        t = trips[trips["route"] == r]
        by_date[str(r)] = {d.strftime("%Y-%m-%d"): g.sort_values("hour")["trips"].round(1).tolist()
                           for d, g in t.groupby("date")}
        templates[str(r)] = {k: typ.loc[(r, k)].round(1).tolist() for k in ("w", "sat", "sun")}

    # Выпуск: вагонов с валидациями на плановый рейс в будни окна REF — норма маршрута.
    # В выходные вагонов на рейс больше (меньше рейсов, смены те же): поправка — медиана по сети.
    fleet = pd.read_csv(EXT / "cards" / "fleet_daily.csv", parse_dates=["date"])
    fleet = fleet[(fleet["date"] >= START) & (fleet["date"] <= FACT_END)].merge(cal[["date", "off"]], on="date")
    fleet["typ"] = day_type(fleet["date"], fleet["off"])
    daily_typ = typ.groupby(["route", "typ"]).sum()
    daily = trips.groupby(["route", "date"])["trips"].sum() * 2
    fleet["plan"] = [daily.get((r, d), daily_typ.get((r, k), 0) * 2) if d >= pd.Timestamp(REF[0]) else daily_typ.get((r, k), 0) * 2
                     for r, d, k in zip(fleet["route"], fleet["date"], fleet["typ"])]
    fleet = fleet[fleet["plan"] > 0]
    fleet["k"] = fleet["trams"] / fleet["plan"]
    in_ref = (fleet["date"] >= REF[0]) & (fleet["date"] <= REF[1])
    kw = fleet[in_ref & (fleet["typ"] == "w")].groupby("route")["k"].median()
    wk = fleet[in_ref].groupby(["route", fleet["typ"] != "w"])["k"].median().unstack()
    # маршруты с ремонтом по выходным (7, 50) поправку не задают: берётся медиана по сети
    weekend = float((wk[True] / wk[False]).median())
    fleet["expected"] = fleet["route"].map(kw) * fleet["plan"] * fleet["typ"].map(lambda k: 1 if k == "w" else weekend)
    out_fleet = {}
    for r, g in fleet.groupby("route"):
        out_fleet[str(r)] = {d.strftime("%Y-%m-%d"): [int(t), int(p), round(float(e), 1)]
                             for d, t, p, e in zip(g["date"], g["trams"], g["plan"], g["expected"])}

    OUT.write_text(json.dumps({
        "source": "transport.mos.ru, расписание на дату; архив с 14.10.2025",
        "from": REF[0],
        "weekend_factor": round(weekend, 3),
        "trips": by_date,
        "typical": templates,
        "fleet": out_fleet,
    }, ensure_ascii=False, separators=(",", ":")))
    print(OUT, OUT.stat().st_size, "байт; вагонов на рейс в выходные ×", round(weekend, 3))


if __name__ == "__main__":
    main()
