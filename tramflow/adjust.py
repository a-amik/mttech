"""Поправки к прогнозу по блокам: маршрут, даты, дни недели, часы.

Каждая поправка описывает событие, которого нет в истории или которое
в истории кончилось: запуск маршрута, возврат выходного движения после
ремонта, рабочая суббота, предновогодние дни. Блоки не пересекаются,
поэтому вклад каждой поправки в метрику измеряется отдельной попыткой.

Виды поправок:
  scale   — умножить блок на число;
  clone   — маршруту без истории дать профиль другого маршрута с даты запуска;
  weekend — вернуть маршруту выходное движение по образцу другого периода:
            форма и отношение «выходной / будни» берутся из периода-образца,
            уровень будней — текущий.
"""
import pandas as pd

from . import model


def _mask(f: pd.DataFrame, adj: dict) -> pd.Series:
    m = pd.Series(True, index=f.index)
    if "routes" in adj:
        m &= f["route"].isin(adj["routes"])
    if "start" in adj:
        m &= f["date"] >= pd.Timestamp(adj["start"])
    if "end" in adj:
        m &= f["date"] <= pd.Timestamp(adj["end"])
    if "dows" in adj:
        m &= f["dow"].isin(adj["dows"])
    if "hours" in adj:
        m &= f["hour"].isin(adj["hours"])
    return m


def apply(f: pd.DataFrame, adjustments: list, hist: pd.DataFrame, cal: pd.DataFrame) -> pd.DataFrame:
    f = f.copy()
    for adj in adjustments:
        kind = adj["kind"]
        if kind == "scale":
            f.loc[_mask(f, adj), "prediction"] *= adj["scale"]
        elif kind == "clone":
            src = f[f["route"] == adj["source"]].set_index(["date", "hour"])["prediction"]
            tgt = f["route"] == adj["route"]
            keys = pd.MultiIndex.from_frame(f.loc[tgt, ["date", "hour"]])
            f.loc[tgt, "prediction"] = src.reindex(keys).fillna(0).values * adj.get("scale", 1.0)
            f.loc[tgt & (f["date"] < pd.Timestamp(adj["start"])), "prediction"] = 0
        elif kind == "weekend":
            f = _restore_weekend(f, adj, hist, cal)
        else:
            raise ValueError(kind)
    return f


def _restore_weekend(f, adj, hist, cal):
    """Выходные блока — по образцу периода, когда маршрут ходил штатно."""
    src = model.clean_days(hist, cal, adj["source"][0], adj["source"][1])
    src = src[src["route"].isin(adj["routes"])]
    shape = model.fit_shape(src)
    level = model.fit_level(src)
    wk = level[level["dow"] < 4].groupby("route")["level"].mean().rename("src_weekday")
    cur = model.clean_days(hist, cal, adj["current"][0], adj["current"][1])
    cur = cur[cur["route"].isin(adj["routes"])]
    cur_wk = model.fit_level(cur)
    cur_wk = cur_wk[cur_wk["dow"] < 4].groupby("route")["level"].mean().rename("cur_weekday")
    lv = level[level["dow"] >= 5].merge(wk, on="route").merge(cur_wk, on="route")
    lv["level"] = lv["level"] / lv["src_weekday"] * lv["cur_weekday"]
    m = _mask(f, {**adj, "dows": [5, 6]})
    block = f[m].drop(columns="prediction")
    block["dt"] = block["dow"]
    block = block.merge(lv[["route", "dow", "level"]], on=["route", "dow"], how="left")
    block = block.merge(shape, on=["route", "dt", "hour"], how="left")
    f.loc[m, "prediction"] = (block["level"].fillna(0) * block["share"].fillna(0)).values * adj.get("scale", 1.0)
    return f
