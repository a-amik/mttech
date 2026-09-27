"""Проверка внешних факторов на истории: повторяется ли эффект и сколько он даёт бэктесту.

Мера — день к медиане того же дня недели того же месяца среди «чистых» дней
(без праздников, переносов и сокращённых дней). Фактор состоятелен, если знак
эффекта совпадает во всех месяцах, где он встретился хотя бы дважды, и медиана
отходит от единицы дальше шума меры (около ±1 %). Важность — прибавка к WAPE-score
на проверочных месяцах, когда фактор подаётся блоком поправки с измеренным множителем.

Запуск: python -m tramflow.factors  → таблица в stdout и data/external/factor_check_2025.csv
"""
import numpy as np
import pandas as pd

from . import backtest, calendar, external
from .config import EXTERNAL, HISTORY_END, HISTORY_START
from .data import history
from .metrics import wape_score
from .versions import BASE

PEAK_PM = list(range(16, 21))

# ключ: (подпись, условие по таблице признаков, дни недели, маршруты, часы)
FACTORS = {
    "rain5": ("Дождь ≥ 5 мм, будни", lambda f: f.rain_mm >= 5, "weekday", None, None),
    "rain2_peak": ("Дождь ≥ 2 мм в часы пик, будни", lambda f: f.rain_peak_mm >= 2, "weekday", None, None),
    "rain5_weekend": ("Дождь ≥ 5 мм, выходные", lambda f: f.rain_mm >= 5, "weekend", None, None),
    "snow3": ("Снегопад ≥ 3 см", lambda f: f.snow_cm >= 3, "weekday", None, None),
    "snow_depth10": ("Снежный покров ≥ 10 см", lambda f: f.snow_depth_m >= 0.10, "weekday", None, None),
    "cold10": ("Мороз: средняя ≤ −10 °C", lambda f: f.t_mean <= -10, "weekday", None, None),
    "hot25": ("Жара: максимум ≥ 25 °C", lambda f: f.t_max >= 25, "weekday", None, None),
    "gust15": ("Порывы ветра ≥ 15 м/с", lambda f: f.gust_max >= 15, "weekday", None, None),
    "ice_rain": ("Ледяной дождь (посты Дептранса)", lambda f: f.ice_rain == 1, "weekday", None, None),
    "ice_warning": ("Предупреждение о гололедице", lambda f: f.ice_warning == 1, "weekday", None, None),
    "weather_warning": ("Штормовое предупреждение", lambda f: f.weather_warning == 1, "weekday", None, None),
    "school_q": ("Каникулы по четвертям, будни", lambda f: f.school_q_holiday == 1, "weekday", None, None),
    "school_m": ("Каникулы модульные, будни", lambda f: f.school_m_holiday == 1, "weekday", None, None),
    "univ": ("Сессия вузов", lambda f: f.univ_session == 1, "weekday", None, None),
    "univ_26": ("Сессия вузов: маршрут 26 (Университет, Ленинский)", lambda f: f.univ_session == 1, "weekday", [26], None),
    "univ_hol": ("Каникулы вузов, будни", lambda f: f.get("univ_holidays", 0) == 1, "weekday", None, None),
    "univ_hol_26": ("Каникулы вузов: маршрут 26", lambda f: f.get("univ_holidays", 0) == 1, "weekday", [26], None),
    "events_near": ("События у площадок (второй круг сбора)", lambda f: f.get("events_near_n", 0) >= 1, "all", None, None),
    "center_closure": ("Перекрытия центра, будни", lambda f: f.center_closure == 1, "weekday", [7, 50, 5], None),
    "center_closure_wk": ("Перекрытия центра, выходные", lambda f: f.center_closure == 1, "weekend", [7, 50, 5], None),
    "metro_outage": ("Сбой метро", lambda f: f.metro_outage == 1, "all", None, None),
    "free_ride": ("Бесплатный проезд", lambda f: f.free_ride == 1, "all", None, None),
    "football_7": ("Матч на «РЖД Арене»: маршрут 7, ±2 ч от начала", lambda f: f.football_rzd == 1, "all", [7], "kickoff"),
    "football_11": ("Матч на «РЖД Арене»: маршрут 11, ±2 ч от начала", lambda f: f.football_rzd == 1, "all", [11], "kickoff"),
    "kudago8": ("≥ 8 разовых событий у остановок (верхняя десятая часть дней)", lambda f: f.kudago_near_n >= 8, "all", None, None),
    "tram_delay": ("Задержки трамваев по Дептрансу", lambda f: f.tram_delay_our_n >= 1, "weekday", None, None),
}


def kickoff_hours(feats: pd.DataFrame, day) -> list:
    """Часы вокруг начала матча: два до и два после; без времени — вечер 17—22."""
    t = feats.loc[day, "football_time"] if day in feats.index else None
    if isinstance(t, str) and ":" in t:
        h = int(t.split(":")[0])
        return list(range(max(0, h - 2), min(24, h + 3)))
    return list(range(17, 23))


def daily_series(hist: pd.DataFrame, routes=None, hours=None, feats=None) -> pd.Series:
    h = hist
    if routes:
        h = h[h.route.isin(routes)]
    if hours == "kickoff":
        # у каждого дня свои часы: берём их по дате, остальные дни — вечер
        hh = h.date.map(lambda d: set(kickoff_hours(feats, d)))
        h = h[[x in s for x, s in zip(h.hour, hh)]]
    elif hours:
        h = h[h.hour.isin(hours)]
    return h.groupby("date").boardings.sum()


def ratios(y: pd.Series, cal: pd.DataFrame, scope: str) -> pd.DataFrame:
    """Отношение дня к медиане чистых дней того же дня недели и месяца."""
    d = y.rename("y").reset_index().merge(cal, on="date")
    d["dow"] = d.date.dt.dayofweek
    d["month"] = d.date.dt.month
    clean = ~d.holiday_weekday & ~d.short & ~d.working_weekend
    if scope == "weekday":
        clean &= d.dow < 5
    elif scope == "weekend":
        clean &= d.dow >= 5
    med = d[clean].groupby(["month", "dow"]).y.median().rename("med").reset_index()
    d = d.merge(med, on=["month", "dow"], how="left")
    d["ratio"] = d.y / d.med
    d.loc[~clean, "ratio"] = np.nan
    return d.set_index("date")


def check(train_end=HISTORY_END) -> pd.DataFrame:
    cal = calendar.load()
    feats = external.load()
    hist = history(HISTORY_START, train_end)
    rows = []
    for key, (label, cond, scope, routes, hours) in FACTORS.items():
        y = daily_series(hist, routes, hours, feats)
        r = ratios(y, cal, scope)
        days = [d for d in external.days(feats, cond(feats), HISTORY_START, train_end) if d in r.index]
        rr = r.loc[days].dropna(subset=["ratio"])
        n = len(rr)
        if n == 0:
            rows.append(dict(key=key, factor=label, n=0, verdict="в истории нет"))
            continue
        med = float(rr.ratio.median())
        by_month = rr.groupby("month").ratio.median()
        counts = rr.groupby("month").size()
        months = by_month[counts >= 2]
        # месяц с отклонением до половины процента — нейтральный, он знак не опровергает
        against = int((((months - 1) * (med - 1) < 0) & ((months - 1).abs() > 0.005)).sum())
        same_sign = len(months) - against
        z = float(np.log(rr.ratio).mean() / (np.log(rr.ratio).std(ddof=1) / np.sqrt(n))) if n > 2 else np.nan
        consistent = n >= 5 and abs(med - 1) > 0.01 and against == 0 and abs(z) >= 2
        # важность: сколько даёт на проверочном месяце множитель med на днях фактора
        deltas = {}
        for name, (te, s, e) in backtest.MONTHS.items():
            test_days = [d for d in external.days(feats, cond(feats), s, e)]
            if scope == "weekday":
                test_days = [d for d in test_days if d.dayofweek < 5]
            elif scope == "weekend":
                test_days = [d for d in test_days if d.dayofweek >= 5]
            if not test_days:
                deltas[name] = None
                continue
            adj = [dict(kind="scale", start=str(d.date()), end=str(d.date()), scale=med,
                        **({"routes": routes} if routes else {}),
                        **({"hours": kickoff_hours(feats, d) if hours == "kickoff" else hours} if hours else {})) for d in test_days]
            base = backtest.run(te, s, e, **BASE)
            with_f = backtest.run(te, s, e, **{**BASE, "adjustments": adj})
            deltas[name] = round(with_f - base, 4)
        rows.append(dict(key=key, factor=label, n=n, ratio_median=round(med, 3), effect_pct=round((med - 1) * 100, 1),
                         months=len(months), months_same_sign=same_sign, z=round(z, 1) if z == z else None,
                         days_oct=sum(1 for d in external.days(feats, cond(feats), *backtest.MONTHS["oct"][1:])),
                         delta_oct=deltas.get("oct"), delta_jun=deltas.get("jun"),
                         verdict="состоятелен" if consistent else ("мало дней" if n < 5 else "не состоятелен")))
    out = pd.DataFrame(rows)
    out.to_csv(EXTERNAL / "factor_check_2025.csv", index=False)
    return out


if __name__ == "__main__":
    pd.set_option("display.width", 200)
    print(check().to_string(index=False))
