"""Слой событий на истории: как посадки маршрута в день изменения его работы отличаются
от обычного такого же дня. События — из архива «Дептранс. Оперативно» за январь—октябрь
(data/external/telegram/events_*.csv, классы tram_changed, tram_delay, tram_restored).

Запуск: python -m tramflow.route_events → таблица по событиям и сводка по классам.
"""
import glob

import numpy as np
import pandas as pd

from . import calendar
from .config import EXTERNAL, HISTORY_END, HISTORY_START, ROUTES
from .data import history


def route_ratios(hist: pd.DataFrame, cal: pd.DataFrame) -> pd.DataFrame:
    """Отношение дня маршрута к медиане чистых дней того же дня недели и месяца."""
    d = hist.groupby(["route", "date"]).boardings.sum().rename("y").reset_index().merge(cal, on="date")
    d["dow"] = d.date.dt.dayofweek
    d["month"] = d.date.dt.month
    clean = ~d.holiday_weekday & ~d.short & ~d.working_weekend
    med = d[clean].groupby(["route", "month", "dow"]).y.median().rename("med").reset_index()
    d = d.merge(med, on=["route", "month", "dow"], how="left")
    d["ratio"] = d.y / d.med
    return d.set_index(["route", "date"])


def events() -> pd.DataFrame:
    files = sorted(glob.glob(str(EXTERNAL / "telegram" / "events_DtOperativno_2025-01-01*.csv")))
    e = pd.concat([pd.read_csv(p, parse_dates=["date"]) for p in files], ignore_index=True)
    e = e[e.kind.str.startswith("tram_") & e.our_routes.notna()]
    e = e[(e.date >= HISTORY_START) & (e.date <= HISTORY_END)]
    rows = []
    for _, r in e.iterrows():
        for route in str(r.our_routes).split("|"):
            if route.isdigit() and int(route) in ROUTES:
                rows.append(dict(date=r.date, route=int(route), kind=r.kind, time=r.time, url=r.url, text=str(r.text)[:90]))
    return pd.DataFrame(rows).drop_duplicates(["date", "route", "kind"])


def check() -> pd.DataFrame:
    cal = calendar.load()
    rr = route_ratios(history(HISTORY_START, HISTORY_END), cal)
    ev = events()
    ev["ratio"] = [rr.ratio.get((r.route, r.date), np.nan) for r in ev.itertuples()]
    ev["effect_pct"] = ((ev.ratio - 1) * 100).round(1)
    ev = ev.dropna(subset=["ratio"]).sort_values(["kind", "date"])
    ev.to_csv(EXTERNAL / "route_events_check_2025.csv", index=False)
    return ev


if __name__ == "__main__":
    pd.set_option("display.width", 220)
    ev = check()
    print(ev[["date", "route", "kind", "time", "effect_pct", "text"]].to_string(index=False))
    print()
    s = ev.groupby("kind").effect_pct.agg(n="size", median="median", q10=lambda x: x.quantile(0.1), q90=lambda x: x.quantile(0.9),
                                          big=lambda x: (x.abs() >= 10).mean() * 100).round(1)
    print(s.rename(columns={"big": "доля |эффект| ≥ 10 %"}).to_string())
