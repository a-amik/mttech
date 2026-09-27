"""Профиль посадок: форма часа по типу дня × уровень дня по дню недели.

Форма — доля часа в дневной сумме, снятая с пула дней одного типа
(понедельник—четверг, пятница, суббота, воскресенье). У одного дня недели
за четыре недели всего четыре наблюдения на час, у пула будней — шестнадцать,
и шум оценки падает вдвое. Уровень — медиана дневной суммы по дню недели.

Форму можно смешать с формой другого сезона: зимой светает позже, вечер
темнеет раньше, и распределение посадок по часам сдвигается. На проверке
по октябрю смесь сентябрьской и январско-февральской формы точнее любой
из них по отдельности.

Праздник в будний день считается по воскресной форме с воскресным уровнем,
рабочая суббота — по пятничной, сокращённый день — по своему дню недели,
будний день между праздниками — по своему дню недели, но тише.
Коэффициенты к уровню таких дней сняты с истории (`calendar_factors`).
"""
import numpy as np
import pandas as pd

from .data import full_grid

WEEKDAY = 0  # тип дня для понедельника—четверга


def day_type(dow: pd.Series) -> pd.Series:
    return dow.where(dow >= 4, WEEKDAY)


def clean_days(hist: pd.DataFrame, cal: pd.DataFrame, start, end) -> pd.DataFrame:
    """История без праздников, сокращённых дней и рабочих суббот."""
    h = hist[(hist["date"] >= start) & (hist["date"] <= end)].merge(cal, on="date")
    h = h[~h["holiday_weekday"] & ~h["short"] & ~h["working_weekend"]].copy()
    h["dow"] = h["date"].dt.dayofweek
    h["dt"] = day_type(h["dow"])
    return h


def fit_shape(days: pd.DataFrame) -> pd.DataFrame:
    """Доля часа в дневной сумме по маршруту и типу дня."""
    s = days.groupby(["route", "dt", "hour"])["boardings"].mean().rename("share").reset_index()
    tot = s.groupby(["route", "dt"])["share"].transform("sum")
    s["share"] = np.where(tot > 0, s["share"] / tot.replace(0, np.nan), 0)
    return s


def fit_level(days: pd.DataFrame) -> pd.DataFrame:
    """Медиана дневной суммы по маршруту и дню недели."""
    d = days.groupby(["route", "date", "dow"])["boardings"].sum().reset_index()
    return d.groupby(["route", "dow"])["boardings"].median().rename("level").reset_index()


def mix_shapes(a: pd.DataFrame, b: pd.DataFrame, weight_a: float) -> pd.DataFrame:
    m = a.merge(b, on=["route", "dt", "hour"], how="outer", suffixes=("_a", "_b")).fillna(0)
    m["share"] = weight_a * m["share_a"] + (1 - weight_a) * m["share_b"]
    return m[["route", "dt", "hour", "share"]]


def calendar_factors(hist: pd.DataFrame, cal: pd.DataFrame) -> dict:
    """Праздничный будний день к воскресенью того же месяца; сокращённый день к будню."""
    daily = hist.groupby("date")["boardings"].sum().rename("y").reset_index().merge(cal, on="date")
    daily["dow"] = daily["date"].dt.dayofweek
    daily["month"] = daily["date"].dt.month
    sun = daily[(daily["dow"] == 6) & daily["day_off"]].groupby("month")["y"].median()
    wk = daily[~daily["day_off"] & ~daily["short"] & (daily["dow"] < 5)].groupby("month")["y"].median()
    hol = daily[daily["holiday_weekday"] & (daily["date"] > "2025-01-08")]
    short = daily[daily["short"] & (daily["dow"] < 5)]
    bridge = daily[daily["bridge"]]
    norm = daily[~daily["day_off"] & ~daily["short"] & ~daily["bridge"] & (daily["dow"] < 5)]
    norm = norm.groupby(["month", "dow"])["y"].median()
    hol_ratio = hol["y"].values / sun.reindex(hol["month"]).values if len(hol) else np.array([])
    short_ratio = short["y"].values / wk.reindex(short["month"]).values if len(short) else np.array([])
    # у праздника в начале месяца может ещё не быть воскресенья для сравнения — такие отношения пустые
    hol_ratio, short_ratio = hol_ratio[np.isfinite(hol_ratio)], short_ratio[np.isfinite(short_ratio)]
    bridge_ratio = bridge["y"].values / norm.reindex(list(zip(bridge["month"], bridge["dow"]))).values
    bridge_ratio = bridge_ratio[np.isfinite(bridge_ratio)]
    return {
        "holiday_vs_sunday": float(np.median(hol_ratio)) if len(hol_ratio) else 0.98,
        "short_vs_weekday": float(np.median(short_ratio)) if len(short_ratio) else 1.04,
        "bridge_vs_weekday": float(np.median(bridge_ratio)) if len(bridge_ratio) else 1.0,
    }


def forecast(shape: pd.DataFrame, level: pd.DataFrame, factors: dict, cal: pd.DataFrame,
             start: str, end: str) -> pd.DataFrame:
    """Прогноз по часам на полной сетке маршрутов из `level`."""
    routes = sorted(level["route"].unique())
    g = full_grid(start, end, routes).merge(cal, on="date")
    g["dow"] = g["date"].dt.dayofweek
    g["level_dow"] = g["dow"]
    g.loc[g["holiday_weekday"], "level_dow"] = 6
    g.loc[g["working_weekend"], "level_dow"] = 4
    g["dt"] = day_type(g["level_dow"])
    g = g.merge(level.rename(columns={"dow": "level_dow"}), on=["route", "level_dow"], how="left")
    g = g.merge(shape, on=["route", "dt", "hour"], how="left")
    g["prediction"] = g["level"].fillna(0) * g["share"].fillna(0)
    g.loc[g["holiday_weekday"], "prediction"] *= factors["holiday_vs_sunday"]
    g.loc[g["short"], "prediction"] *= factors["short_vs_weekday"]
    g.loc[g["bridge"], "prediction"] *= factors["bridge_vs_weekday"]
    return g[["route", "date", "hour", "dow", "prediction"]]


def trend_slopes(days: pd.DataFrame, train_end, cap: float = 0.03) -> pd.DataFrame:
    """Слабый тренд уровня по маршруту: наклон отношения дня к медиане своего дня недели,
    взятого медианой по семидневным блокам от даты обучения (Тейл—Сен, ограничен ±cap за неделю)."""
    d = days.groupby(["route", "date", "dow"])["boardings"].sum().reset_index()
    med = d.groupby(["route", "dow"])["boardings"].median().rename("med").reset_index()
    d = d.merge(med, on=["route", "dow"])
    d = d[d["med"] > 0]
    d["r"] = d["boardings"] / d["med"]
    d["block"] = (pd.Timestamp(train_end) - d["date"]).dt.days // 7
    b = d.groupby(["route", "block"])["r"].median().reset_index()
    rows = []
    for route, g in b.groupby("route"):
        x, y = -g["block"].values.astype(float), g["r"].values
        pairs = [(y[j] - y[i]) / (x[j] - x[i]) for i in range(len(x)) for j in range(i + 1, len(x)) if x[j] != x[i]]
        rows.append((route, float(np.clip(np.median(pairs), -cap, cap)) if pairs else 0.0))
    return pd.DataFrame(rows, columns=["route", "slope"])


def fit_level_smooth(days8: pd.DataFrame, days4: pd.DataFrame) -> pd.DataFrame:
    """Уровень дня недели через общий уровень типа дня: отношение «день недели / свой тип дня»
    по восьми неделям × медиана типа дня по четырём. Сглаживает четыре понедельника."""
    d = days8.groupby(["route", "date", "dow", "dt"])["boardings"].sum().reset_index()
    d["week"] = d["date"].dt.isocalendar().week.astype(int)
    m = d.groupby(["route", "week", "dt"])["boardings"].transform("median")
    d["norm"] = d["boardings"] / m.replace(0, np.nan)
    ratio = d.groupby(["route", "dow"])["norm"].median().rename("ratio").reset_index()
    l4 = days4.groupby(["route", "date", "dt"])["boardings"].sum().reset_index()
    l4 = l4.groupby(["route", "dt"])["boardings"].median().rename("lvl_dt").reset_index()
    ratio["dt"] = day_type(ratio["dow"])
    out = ratio.merge(l4, on=["route", "dt"], how="left")
    out["level"] = out["ratio"] * out["lvl_dt"]
    return out[["route", "dow", "level"]]


def weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    order = np.argsort(values)
    v, w = values[order], weights[order]
    cum = np.cumsum(w)
    return float(v[np.searchsorted(cum, cum[-1] / 2)])


def fit_level_l1(days: pd.DataFrame, shape: pd.DataFrame) -> pd.DataFrame:
    """Уровень дня, минимизирующий почасовую абсолютную ошибку при заданной форме:
    взвешенная медиана отношений «факт часа / доля часа» с весами долей, по маршруту и дню недели."""
    d = days.merge(shape, on=["route", "dt", "hour"], how="left")
    d = d[d["share"] > 0]
    rows = []
    for (route, dow), g in d.groupby(["route", "dow"]):
        rows.append((route, dow, weighted_median((g["boardings"] / g["share"]).values, g["share"].values)))
    return pd.DataFrame(rows, columns=["route", "dow", "level"])


def shift_evening(shape: pd.DataFrame, delta_h: float, start_hour: int = 12) -> pd.DataFrame:
    """Сдвиг вечерней части формы на delta_h часов (плюс — позже) с сохранением суммы часов
    от start_hour до 23: доли интерполируются по сдвинутой сетке."""
    if not delta_h:
        return shape
    out = []
    for (route, dt), g in shape.groupby(["route", "dt"]):
        g = g.sort_values("hour")
        share = g.set_index("hour")["share"].reindex(range(24)).fillna(0).values
        ev = np.arange(start_hour, 24)
        src = np.interp(ev - delta_h, np.arange(24), share)
        total = share[start_hour:].sum()
        if src.sum() > 0:
            src *= total / src.sum()
        new = share.copy()
        new[start_hour:] = src
        out.append(pd.DataFrame({"route": route, "dt": dt, "hour": range(24), "share": new}))
    return pd.concat(out, ignore_index=True)


def weekend_ratios(days: pd.DataFrame) -> pd.DataFrame:
    """Отношение уровня субботы и воскресенья к понедельнику—четвергу по маршруту (из зимних недель)."""
    d = days.groupby(["route", "date", "dow"])["boardings"].sum().reset_index()
    wk = d[d["dow"] < 4].groupby("route")["boardings"].median().rename("wk")
    rows = []
    for dow in (5, 6):
        m = d[d["dow"] == dow].groupby("route")["boardings"].median().rename("we")
        r = pd.concat([m, wk], axis=1)
        for route, row in r.iterrows():
            rows.append((route, dow, row["we"] / row["wk"] if row["wk"] > 0 else np.nan))
    return pd.DataFrame(rows, columns=["route", "dow", "ratio"])


def trend_slopes_weekly(weekly: pd.DataFrame, value: str, train_end, weeks: int = 8, cap: float = 0.03) -> pd.DataFrame:
    """Тот же слабый тренд, но по недельному ряду из сырых валидаций (карты, регулярные карты, проездные):
    отношение недели к медиане последних недель, наклон Тейла—Сена за неделю, ограничен ±cap."""
    train_end = pd.Timestamp(train_end)
    w = weekly[(weekly["week"] + pd.Timedelta(days=6) <= train_end) & (weekly["week"] > train_end - pd.Timedelta(weeks=weeks + 1))]
    rows = []
    for route, g in w.groupby("route"):
        g = g.sort_values("week")
        med = g[value].median()
        if med <= 0 or len(g) < 3:
            rows.append((route, 0.0)); continue
        x = ((g["week"] - train_end).dt.days / 7).values.astype(float)
        y = (g[value] / med).values
        pairs = [(y[j] - y[i]) / (x[j] - x[i]) for i in range(len(x)) for j in range(i + 1, len(x)) if x[j] != x[i]]
        rows.append((route, float(np.clip(np.median(pairs), -cap, cap)) if pairs else 0.0))
    return pd.DataFrame(rows, columns=["route", "slope"])


def suspicious_days(fleet: pd.DataFrame, threshold: float) -> set:
    """Дни маршрута, где вагонов с валидациями меньше threshold от медианы того же дня недели
    за восемь недель вокруг: похоже на выпадение наблюдений, а не на спад спроса."""
    f = fleet.copy()
    f["dow"] = f["date"].dt.dayofweek
    out = set()
    for route, g in f.groupby("route"):
        g = g.sort_values("date").set_index("date")
        for dow, gg in g.groupby("dow"):
            med = gg["trams"].rolling(9, center=True, min_periods=4).median()
            bad = gg[gg["trams"] < threshold * med]
            out.update((route, d) for d in bad.index)
    return out


def weekday_shares(days: pd.DataFrame) -> pd.Series:
    """Доля маршрута в сети по будням понедельник—четверг."""
    d = days[days["dow"] < 4].groupby("route")["boardings"].sum()
    return d / d.sum()
