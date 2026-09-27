"""Проверка вариантов модели по многим окнам, чтобы не переобучиться на октябрь и июнь.

Восемь месячных окон: обучение по конец февраля … сентября, прогноз следующего месяца.
Четыре двухмесячных: март—апрель, май—июнь, июль—август, сентябрь—октябрь, история
внутри окна не обновляется. Объединённый скор — 1 − сумма ошибок / сумма факта по всем
окнам, а не среднее скоров. Парный бутстрэп по целым неделям октября — для интервала прибавки.

    python -m tramflow.protocol                     # база против тренда и сглаживания
    python -m tramflow.protocol v41_wratio_ramp05   # ядро версии на всех окнах и разрез октября

Ядро версии — её параметры формы и уровня без датированных поправок ноября—декабря:
на окна истории такие поправки не переносятся. Уровень — без общего множителя, как в submit.
"""
import calendar as pycal

import numpy as np
import pandas as pd

from . import backtest, calendar
from .data import history
from .metrics import wape_score
from .versions import BASE, VERSIONS

VARIANTS = {
    "база": {},
    "тренд 0,25": {"trend": 0.25},
    "тренд + сглаживание": {"trend": 0.25, "smooth": 0.5},
    "сглаживание": {"smooth": 0.5},
}


def windows():
    out = []
    for m in range(3, 11):
        te = f"2025-{m - 1:02d}-{pycal.monthrange(2025, m - 1)[1]:02d}"
        out.append((f"{m:02d}", te, f"2025-{m:02d}-01", f"2025-{m:02d}-{pycal.monthrange(2025, m)[1]:02d}"))
    for m in (3, 5, 7, 9):
        te = f"2025-{m - 1:02d}-{pycal.monthrange(2025, m - 1)[1]:02d}"
        out.append((f"{m:02d}—{m + 1:02d}", te, f"2025-{m:02d}-01", f"2025-{m + 1:02d}-{pycal.monthrange(2025, m + 1)[1]:02d}"))
    return out


def run(variants=VARIANTS) -> pd.DataFrame:
    cal = calendar.load()
    hist = history("2025-01-01", "2025-10-31")
    rows = []
    detail = {}
    for name, te, s, e in windows():
        test = hist[(hist["date"] >= s) & (hist["date"] <= e)]
        for vname, kw in variants.items():
            pred = backtest.build(hist, cal, te, s, e, **{**BASE, **kw})
            d = test.merge(pred[["route", "date", "hour", "prediction"]], on=["route", "date", "hour"])
            detail[(vname, name)] = d
            rows.append(dict(window=name, variant=vname, score=wape_score(d["boardings"], d["prediction"]),
                             err=float(np.abs(d["boardings"] - d["prediction"]).sum()), fact=float(d["boardings"].sum())))
    r = pd.DataFrame(rows)
    monthly = r[~r.window.str.contains("—")]
    table = monthly.pivot(index="variant", columns="window", values="score").round(4)
    table["объединённый"] = (1 - monthly.groupby("variant").err.sum() / monthly.groupby("variant").fact.sum()).round(5)
    two = r[r.window.str.contains("—")].pivot(index="variant", columns="window", values="score").round(4)
    print("Месячные окна:\n", table.loc[list(variants)].to_string(), "\n\nДвухмесячные окна:\n", two.loc[list(variants)].to_string())
    # бутстрэп по неделям октября: прибавка варианта к базе
    first = list(variants)[0]
    base = detail[(first, "10")]
    for vname in list(variants)[1:]:
        d = base.merge(detail[(vname, "10")][["route", "date", "hour", "prediction"]], on=["route", "date", "hour"], suffixes=("", "_v"))
        d["week"] = d["date"].dt.isocalendar().week.astype(int)
        wk = d.groupby("week").apply(lambda g: pd.Series({"e0": np.abs(g.boardings - g.prediction).sum(),
                                                            "e1": np.abs(g.boardings - g.prediction_v).sum(), "y": g.boardings.sum()}))
        rng = np.random.default_rng(0)
        deltas = []
        for _ in range(2000):
            pick = wk.iloc[rng.integers(0, len(wk), len(wk))]
            deltas.append((pick.e0.sum() - pick.e1.sum()) / pick.y.sum())
        lo, hi = np.percentile(deltas, [2.5, 97.5])
        print(f"\nоктябрь, {vname}: прибавка {(wk.e0.sum() - wk.e1.sum()) / wk.y.sum():+.5f}, 95 % по неделям {lo:+.5f}…{hi:+.5f}")
    return r


def core(key: str) -> dict:
    """Параметры формы и уровня версии без поправок — то, что проверяется на истории."""
    return {**{k: v for k, v in VERSIONS[key].items() if k in BASE}, "level": 1.0}


def breakdown(key: str) -> pd.DataFrame:
    """Октябрь по маршрутам, утреннему и вечернему пику: WAPE-score и смещение суммы."""
    d = backtest.detail(**{**BASE, **core(key)})
    parts = {f"маршрут {r}": d[d.route == r] for r in sorted(d.route.unique()) if d[d.route == r].boardings.sum()}
    parts["утренний пик 7—10"] = d[d.hour.between(7, 9)]
    parts["вечерний пик 17—20"] = d[d.hour.between(17, 19)]
    parts["вся сетка"] = d
    return pd.DataFrame([dict(срез=k, score=round(wape_score(g.boardings, g.prediction), 4),
                              смещение_pct=round((g.prediction.sum() / g.boardings.sum() - 1) * 100, 1))
                         for k, g in parts.items()])


if __name__ == "__main__":
    import sys
    pd.set_option("display.width", 200)
    if len(sys.argv) > 1:
        key = sys.argv[1]
        run({"база": {"level": 1.0}, key: core(key)})
        print("\nОктябрь по срезам:\n", breakdown(key).to_string(index=False))
    else:
        run()
