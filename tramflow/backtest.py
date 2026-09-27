"""Проверка модели по времени: обучение до конца месяца, прогноз следующего."""
import numpy as np
import pandas as pd

from . import adjust, calendar, external, model
from .config import EXTERNAL
from .data import history
from .metrics import wape_score


def build(hist, cal, train_end: str, start: str, end: str, weeks=4, winter=None,
          winter_weight=0.5, level=1.0, adjustments=(), trend=0.0, smooth=0.0, l1=0.0,
          sunset=0.0, wratio=0.0, smooth_l1=0.0, winter_weight_end=None, wratio_end=None,
          trend_source="boardings", fleet_filter=0.0, trend_sat=4.0, shape_weeks=None, share_ramp=0.0) -> pd.DataFrame:
    """Прогноз на [start, end] по истории до train_end включительно.

    trend — коэффициент слабого тренда уровня (0 — выключен, 0,25 — как проверено);
    smooth — вес уровня, сглаженного через тип дня (0 — выключен, 0,5 — смесь пополам)."""
    if winter_weight_end is not None or wratio_end is not None:
        # веса растут к концу окна: декабрь ближе к зиме, чем ноябрь. Прогноз линеен по весу смеси,
        # поэтому два прогноза с крайними весами интерполируются по дате.
        kw = dict(weeks=weeks, winter=winter, level=level, adjustments=adjustments, trend=trend, smooth=smooth,
                  l1=l1, sunset=sunset, smooth_l1=smooth_l1, trend_source=trend_source, fleet_filter=fleet_filter,
                  trend_sat=trend_sat, shape_weeks=shape_weeks, share_ramp=share_ramp)
        f0 = build(hist, cal, train_end, start, end, winter_weight=winter_weight, wratio=wratio, **kw)
        f1 = build(hist, cal, train_end, start, end, winter_weight=winter_weight_end if winter_weight_end is not None else winter_weight,
                   wratio=wratio_end if wratio_end is not None else wratio, **kw)
        t = ((f0["date"] - pd.Timestamp(start)).dt.days / max(1, (pd.Timestamp(end) - pd.Timestamp(start)).days)).values
        f0["prediction"] = (1 - t) * f0["prediction"].values + t * f1["prediction"].values
        return f0
    train_end = pd.Timestamp(train_end)
    known = hist[hist["date"] <= train_end]
    if fleet_filter:
        # дни с выпавшими наблюдениями (мало вагонов с валидациями) в обучение не идут
        fleet = pd.read_csv(EXTERNAL / "cards" / "fleet_daily.csv", parse_dates=["date"])
        bad = model.suspicious_days(fleet[fleet["date"] <= train_end], fleet_filter)
        if bad:
            key = list(zip(known["route"], known["date"]))
            known = known[[k not in bad for k in key]]
    recent = model.clean_days(known, cal, train_end - pd.Timedelta(weeks=weeks) + pd.Timedelta(days=1), train_end)
    # форма часа может сниматься с более длинного окна, чем уровень: у малых маршрутов доля часа шумит
    shape_days = recent if not shape_weeks or shape_weeks == weeks else model.clean_days(
        known, cal, train_end - pd.Timedelta(weeks=shape_weeks) + pd.Timedelta(days=1), train_end)
    shape = model.fit_shape(shape_days)
    if winter:
        shape = model.mix_shapes(shape, model.fit_shape(model.clean_days(known, cal, *winter)), winter_weight)
    if sunset:
        # вечер сдвигается вслед за закатом: доля разницы закатов окна и последних четырёх недель
        f_ext = external.load()
        sun = f_ext["sunset_h"]
        fut = sun[(sun.index >= pd.Timestamp(start)) & (sun.index <= pd.Timestamp(end))].mean()
        past = sun[(sun.index > train_end - pd.Timedelta(days=28)) & (sun.index <= train_end)].mean()
        shape = model.shift_evening(shape, float(np.clip(sunset * (fut - past), -0.5, 0.5)))
    lvl = model.fit_level(recent)
    if smooth:
        eight = model.clean_days(known, cal, train_end - pd.Timedelta(weeks=8) + pd.Timedelta(days=1), train_end)
        sm = model.fit_level_smooth(eight, recent).rename(columns={"level": "level_sm"})
        lvl = lvl.merge(sm, on=["route", "dow"], how="left")
        lvl["level"] = (1 - smooth) * lvl["level"] + smooth * lvl["level_sm"].fillna(lvl["level"])
        lvl = lvl[["route", "dow", "level"]]
    if l1:
        # уровень под почасовой L1 при уже смешанной форме, в смеси с медианой дня
        l1lvl = model.fit_level_l1(recent, shape).rename(columns={"level": "level_l1"})
        lvl = lvl.merge(l1lvl, on=["route", "dow"], how="left")
        lvl["level"] = (1 - l1) * lvl["level"] + l1 * lvl["level_l1"].fillna(lvl["level"])
        lvl = lvl[["route", "dow", "level"]]
    if smooth_l1:
        # сглаживание понедельника—четверга поверх L1-уровня: L1 заменяет медиану целиком, и обычное smooth до него не доживает
        eight = model.clean_days(known, cal, train_end - pd.Timedelta(weeks=8) + pd.Timedelta(days=1), train_end)
        sm = model.fit_level_smooth(eight, recent).rename(columns={"level": "level_sm"})
        lvl = lvl.merge(sm, on=["route", "dow"], how="left")
        lvl["level"] = (1 - smooth_l1) * lvl["level"] + smooth_l1 * lvl["level_sm"].fillna(lvl["level"])
        lvl = lvl[["route", "dow", "level"]]
    if wratio and winter:
        # зимнее отношение выходных к будням × текущий будний уровень, в смеси с нынешним (после L1, иначе L1 её перекроет)
        wr = model.weekend_ratios(model.clean_days(known, cal, *winter))
        wkday = lvl[lvl["dow"] < 4].groupby("route")["level"].mean().rename("wk").reset_index()
        wr = wr.merge(wkday, on="route")
        wr["level_w"] = wr["ratio"] * wr["wk"]
        lvl = lvl.merge(wr[["route", "dow", "level_w"]], on=["route", "dow"], how="left")
        lvl["level"] = np.where(lvl["level_w"].notna(), (1 - wratio) * lvl["level"] + wratio * lvl["level_w"], lvl["level"])
        lvl = lvl[["route", "dow", "level"]]
    lvl["level"] *= level
    f = model.forecast(shape, lvl, model.calendar_factors(known, cal), cal, start, end)
    if trend:
        eight = model.clean_days(known, cal, train_end - pd.Timedelta(weeks=8) + pd.Timedelta(days=1), train_end)
        if trend_source == "boardings":
            slopes = model.trend_slopes(eight, train_end).set_index("route")["slope"]
        else:
            weekly = pd.read_csv(EXTERNAL / "cards" / "cards_weekly.csv", parse_dates=["week"])
            col = {"cards": "cards", "regular": "regular_cards", "pass": "boardings_pass", "single": "boardings_single"}[trend_source]
            slopes = model.trend_slopes_weekly(weekly, col, train_end).set_index("route")["slope"]
        horizon = (f["date"] - train_end).dt.days
        f["prediction"] *= 1 + trend * f["route"].map(slopes).fillna(0) * np.minimum((horizon + 14) / 7, trend_sat)
    if share_ramp and winter:
        # доли маршрутов в сети зимой отличаются от осенних (25-й и 26-й теряют, 11-й и 12-й прибавляют);
        # к концу окна уровень маршрута тянется к зимней доле: множитель (зима / сейчас) ^ (t × share_ramp)
        win_sh = model.weekday_shares(model.clean_days(known, cal, *winter))
        cur_sh = model.weekday_shares(recent)
        ratio = (win_sh / cur_sh).replace([np.inf, -np.inf], np.nan).fillna(1.0)
        t = ((f["date"] - pd.Timestamp(start)).dt.days / max(1, (pd.Timestamp(end) - pd.Timestamp(start)).days)).clip(0, 1)
        f["prediction"] *= np.power(f["route"].map(ratio).fillna(1.0).values, (t * share_ramp).values)
    return adjust.apply(f, list(adjustments), known, cal)


def detail(train_end="2025-09-30", start="2025-10-01", end="2025-10-31", **kw) -> pd.DataFrame:
    """Факт и прогноз по часам на проверочном месяце."""
    cal = calendar.load()
    hist = history("2025-01-01", end)
    pred = build(hist, cal, train_end, start, end, **kw)
    test = hist[(hist["date"] >= start) & (hist["date"] <= end)]
    return test.merge(pred[["route", "date", "hour", "prediction"]], on=["route", "date", "hour"])


def run(train_end, start, end, **kw) -> float:
    d = detail(train_end, start, end, **kw)
    return wape_score(d["boardings"], d["prediction"])


MONTHS = {"oct": ("2025-09-30", "2025-10-01", "2025-10-31"),
          "jun": ("2025-05-31", "2025-06-01", "2025-06-30")}


def summary(**kw) -> dict:
    return {k: round(run(*m, **kw), 4) for k, m in MONTHS.items()}


if __name__ == "__main__":
    from .versions import WINTER
    print("медиана по дню недели, 4 недели     ", summary(winter=None))
    print("пул по типу дня, 4 недели           ", summary(winter=None, winter_weight=1.0))
    for w in (0.25, 0.5, 0.75):
        print(f"пул + зимняя форма, вес осени {w:<5}", summary(winter=WINTER, winter_weight=w))
