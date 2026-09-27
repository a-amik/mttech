"""Внешние признаки по дням: сводная таблица data/external/features_daily_2025.csv.

Таблицу собирает data/external/build_features.py из погоды Open-Meteo, производственного
календаря, каникул, архива каналов Дептранса, матчей на «РЖД Арене», афиши KudaGo
и реестра изменений маршрутов. Здесь — только чтение и удобные выборки дней.
"""
from pathlib import Path

import pandas as pd

from .config import ROOT

FEATURES = ROOT / "data" / "external" / "features_daily_2025.csv"


def load(path: Path = FEATURES) -> pd.DataFrame:
    f = pd.read_csv(path, parse_dates=["date"])
    return f.set_index("date").sort_index()


def days(f: pd.DataFrame, cond: pd.Series, start: str | None = None, end: str | None = None) -> list:
    """Даты, где условие истинно, в границах [start, end]."""
    m = cond.reindex(f.index).fillna(False).astype(bool)
    if start:
        m &= f.index >= pd.Timestamp(start)
    if end:
        m &= f.index <= pd.Timestamp(end)
    return list(f.index[m])
