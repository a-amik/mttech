"""Три модели на одинаковых входах: регрессия, статистическая модель и бустинг.

Прогноз строится от каждой даты по истории до неё. Короткие горизонты — день-цель через
1, 7, 14 и 28 дней, даты прогноза каждый день с 29 января — первой даты, когда у всех
трёх моделей есть четыре недели истории и хотя бы одна прошлая пара для обучения весов:
так в счёт входит и зима, и переход к весне, а не только уже освоенный сезон. Длинные — весь календарный месяц
через 3, 6 и 9 месяцев от конца месяца. Двенадцать месяцев проверить нечем: цели через год
после любой даты истории нет.

Входы у всех трёх одни: посадки до даты прогноза (уровень и форма последних четырёх недель),
маршрут, час, день недели, производственный календарь, каникулы, долгота дня. Погода дня
заранее неизвестна, поэтому режимов три: без неё, с фактической погодой, как при точном
прогнозе погоды, и с погодой и событиями — посты Дептранса о задержках и изменениях на наших
маршрутах, режим ремонта 7-го и 50-го, перекрытия центра, матчи, концерты, бесплатный проезд,
сбои метро. Событий статистическая модель не видит: учиться на них могут только регрессия,
бустинг и гибрид, поэтому счёт считается отдельно по дням с событием и без.

Четвёртый режим — синтетические события на той же истории: сбои на линии, концерты у линии
и грозы в выходные, вписанные в факт с заданной силой в случайные дни. Это проверка способности,
а не замер реальности: он показывает, со скольких повторов события модели, которые на событиях
учатся, начинают обгонять статистику, которая их не видит (кривая обучения, поле curve). Погода — это температура дня, её отклонение от прошлой недели и осадки.
Статистическая модель берёт её поправкой к дню, снятой по своим же прошлым ошибкам
до даты прогноза: в выходные тепло к прошлой неделе поднимает посадки, осадки опускают,
в будни работает только осадки.
Маршрут 5 в проверку не входит: истории у него нет.

    python -m tramflow.horizons           # таблица в консоль и web/public/data/horizons.json
"""
import json
import time

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

from . import backtest, calendar, external, model
from .config import ROOT, ROUTES
from .data import history
from .metrics import wape_score
from .protocol import core

MAIN = "v41_wratio_ramp05"
EVAL_ROUTES = [r for r in ROUTES if r != 5]
SHORT = (1, 2, 3, 7, 14, 28)
LONG = (3, 6, 9)
FIRST_ORIGIN, LAST_DAY = pd.Timestamp("2025-01-29"), pd.Timestamp("2025-10-31")
REFIT_DAYS = 7          # веса регрессии и бустинга обновляются раз в неделю, входы — каждый день
TRAIN_STEP = 7          # шаг дат прогноза, из которых собирается обучающая выборка
LEVEL_WEEKS = 4

# Погодная поправка статистической модели: лог-остаток дня по городу против отклонения температуры
# от прошлой недели и осадков, отдельно для будней и выходных. На всей истории февраль—октябрь выходит
# +1,5 % на градус и −1,4 % на мм в выходные, −0,5 % на мм в будни; здесь коэффициенты снимаются только
# с дней до даты прогноза. Проверка вперёд по месяцам даёт около нуля: связь в дне есть, но от сезона
# к сезону плавает.
WEATHER_FIT_MIN_DAYS, WEATHER_CAP = 40, 0.15

# Параметры бустинга зафиксированы до первого прогона, как в проверке 26 сентября.
LGB_PARAMS = dict(objective="regression_l1", n_estimators=250, num_leaves=15, learning_rate=0.04,
                  min_child_samples=100, reg_lambda=10.0, n_jobs=4, verbosity=-1, random_state=260927)
CAL_COLS = ["holiday_weekday", "short", "working_weekend", "bridge"]
KNOWN_COLS = ["school_q_holiday", "school_m_holiday", "school_summer", "univ_session", "daylight_h", "sunset_h"]
WEATHER_COLS = ["t_mean", "t_anom7", "precip_mm", "rain_mm", "snow_cm", "wind_max"]
EVENT_COLS = ["center_closure", "closures_n", "free_ride", "metro_outage", "football_rzd_att", "concerts_n",
              "events_near_n", "ice_warning"]
ROUTE_EVENT_COLS = ["ev_delay", "ev_notice", "rg", "rg_recent"]
MODES = ("known", "weather", "events")

# Синтетические события: вид → (сила, часы, на маршруте или по городу, только выходные, случаев в месяц).
SYN_SEED = 20250927
SYN_EVENTS = {
    "syn_fail": (0.4, "day", True, False, 3),        # сбой на линии: 2—3 часа днём, посадок 40 % от обычного
    "syn_concert": (1.4, (21, 23), True, False, 3),  # концерт у линии: вечер, +40 %
    "syn_storm": (0.75, (13, 18), False, True, 2),   # гроза в выходной: весь город, −25 %
}
SYN_COLS = list(SYN_EVENTS)
SYN_BUCKETS = ((1, 3), (4, 10), (11, 99))
MODELS = ("reg", "stat", "ml", "hyb")

# Гибрид: бустинг учится на отношении факта к прогнозу статистической модели на тех же прошлых
# парах «дата прогноза → день-цель» и поправляет её прогноз: берётся половина поправки, не больше ±15 %.
# Статистика остаётся основой, бустинг досказывает календарь, погоду и события. Размер поправки выбран
# по целям февраль—июнь из восьми вариантов (входы, регуляризация, потолок ±15/±50 %, доля 0,5/1);
# на июле—октябре, в выборе не участвовавших, гибрид лучше статистики: на завтра 0,8853 против 0,8825,
# на неделю 0,8773 против 0,8762, на 28 дней 0,8205 против 0,8180. Полная поправка там же проигрывает.
HYB_CAP = np.log(1.15)
HYB_SHRINK = 0.5
HYB_PARAMS = dict(LGB_PARAMS, n_estimators=200)

# Через час: прогноз модели на день-цель, уточнённый по факту уже прошедших часов этого дня
# тем же правилом, что в сервисе (/api/nowcast): отношение факта к прогнозу за прошедшие часы
# с прогнозом от 50 посадок, при сумме от 300 и хотя бы двух часах; час, где факт меньше пятой
# части прогноза, — провал данных; отношение в пределах 0,8—1,25 и сжато корнем.
NOW_HOUR_MIN, NOW_SUM_MIN, NOW_MIN_HOURS, NOW_GAP, NOW_LO, NOW_HI, NOW_TRUST = 50, 300, 2, 0.2, 0.8, 1.25, 0.5


class Inputs:
    """История, календарь и внешние признаки; уровень и форма на любую дату прогноза."""

    def __init__(self, synthetic: bool = False):
        self.cal = calendar.load()
        self.hist = history("2025-01-01", "2025-10-31")
        self.hist = self.hist[self.hist["route"].isin(EVAL_ROUTES)].reset_index(drop=True)
        self.syn = synthetic_events(self.hist) if synthetic else None
        if synthetic:
            k = self.syn["mult"].reindex(pd.MultiIndex.from_frame(self.hist[["route", "date", "hour"]])).fillna(1).to_numpy()
            self.hist["boardings"] = np.round(self.hist["boardings"] * k)
        self.feat = external.load()
        self.feat["t_anom7"] = self.feat["t_mean"] - self.feat["t_mean"].rolling(7).mean().shift(1)
        self.fact = self.hist.set_index(["route", "date", "hour"])["boardings"]
        self._recent = {}
        self._days = None
        self._stat = {}
        self.route_ev, self.regime = route_events(self.hist)

    def recent(self, origin: pd.Timestamp):
        """Медиана часа по маршруту и типу дня и медиана дневной суммы по дню недели за четыре недели."""
        if origin not in self._recent:
            known = self.hist[self.hist["date"] <= origin]
            days = model.clean_days(known, self.cal, origin - pd.Timedelta(weeks=LEVEL_WEEKS) + pd.Timedelta(days=1), origin)
            h = days.groupby(["route", "dt", "hour"])["boardings"].median().rename("rec_h")
            d = days.groupby(["route", "date", "dow"])["boardings"].sum().groupby(["route", "dow"]).median().rename("rec_d")
            self._recent[origin] = (h, d)
        return self._recent[origin]

    def frame(self, origin: pd.Timestamp, dates, mode: str) -> pd.DataFrame:
        """Строки «маршрут × день × час» для дней-целей с входами, известными на дату прогноза."""
        idx = pd.MultiIndex.from_product([EVAL_ROUTES, pd.DatetimeIndex(dates), range(24)], names=["route", "date", "hour"])
        g = idx.to_frame(index=False)
        c = self.cal.set_index("date").reindex(g["date"])
        dow = g["date"].dt.dayofweek.to_numpy()
        # праздник в будний день живёт как воскресенье, рабочая суббота — как пятница, как в модели
        dow_eff = np.where(c["holiday_weekday"].to_numpy(), 6, np.where(c["working_weekend"].to_numpy(), 4, dow))
        g["dow"] = dow_eff
        g["dt"] = np.where(dow_eff >= 4, dow_eff, 0)
        for k in CAL_COLS:
            g[k] = c[k].to_numpy().astype(int)
        f = self.feat.reindex(g["date"])
        rich = mode in ("events", "synthetic")
        for k in KNOWN_COLS + (WEATHER_COLS if mode != "known" else []) + (EVENT_COLS if rich else []):
            g[k] = f[k].to_numpy(dtype=float)
        if rich:
            key = pd.MultiIndex.from_frame(g[["route", "date", "hour"]])
            ev = self.route_ev.reindex(key)
            g["ev_delay"] = ev["ev_delay"].fillna(0).to_numpy()
            g["ev_notice"] = ev["ev_notice"].fillna(0).to_numpy()
            g["rg"] = self.regime.reindex(key).fillna(0).to_numpy()
            g["rg_recent"] = self.regime_recent(origin).reindex(
                pd.MultiIndex.from_arrays([g["route"], g["date"].dt.dayofweek >= 5, g["hour"]])).fillna(0).to_numpy()
        if mode == "synthetic":
            s = self.syn.reindex(pd.MultiIndex.from_frame(g[["route", "date", "hour"]]))
            for c in SYN_COLS:
                g[c] = s[c].fillna(0).to_numpy()
        h, d = self.recent(origin)
        g = g.join(h, on=["route", "dt", "hour"]).join(d, on=["route", "dow"])
        g["rec_h"] = np.log1p(g["rec_h"].fillna(0))
        g["rec_d"] = np.log1p(g["rec_d"].fillna(0))
        g["y"] = self.fact.reindex(pd.MultiIndex.from_frame(g[["route", "date", "hour"]])).to_numpy()
        return g

    def regime_recent(self, origin: pd.Timestamp) -> pd.Series:
        """Доля дней в режиме ремонта за четыре недели до даты прогноза — по маршруту, будни/выходные, час."""
        r = self.regime[(self.regime.index.get_level_values("date") > origin - pd.Timedelta(weeks=LEVEL_WEEKS))
                        & (self.regime.index.get_level_values("date") <= origin)]
        if r.empty:
            return pd.Series(dtype=float)
        d = r.reset_index()
        d["wkd"] = d["date"].dt.dayofweek >= 5
        n = self.hist[(self.hist["date"] > origin - pd.Timedelta(weeks=LEVEL_WEEKS)) & (self.hist["date"] <= origin)]["date"].drop_duplicates()
        days = pd.Series(n.dt.dayofweek >= 5).value_counts()
        s = d.groupby(["route", "wkd", "hour"])["rg"].sum()
        return s / days.reindex(s.index.get_level_values("wkd")).to_numpy()

    def train_set(self, until: pd.Timestamp, mode: str) -> pd.DataFrame:
        """Пары «дата прогноза → день-цель до 28 дней» с целью не позже `until`."""
        first = pd.Timestamp("2025-01-01") + pd.Timedelta(weeks=LEVEL_WEEKS) - pd.Timedelta(days=1)
        parts = []
        for o in pd.date_range(first, until - pd.Timedelta(days=1), freq=f"{TRAIN_STEP}D"):
            ds = pd.date_range(o + pd.Timedelta(days=1), min(o + pd.Timedelta(days=28), until))
            if len(ds):
                parts.append(self.frame(o, ds, mode).assign(origin=o))
        return pd.concat(parts, ignore_index=True)


def route_events(hist: pd.DataFrame):
    """События по маршрутам из постов Дептранса и реестра изменений (data/external/telegram, route_changes).
    ev_delay — задержка на маршруте в эти часы; ev_notice — пост об изменении работы маршрута в этот день
    и два следующих (дата поста не всегда дата события); rg — маршрут в этот час работает укороченно
    или не работает по реестру изменений."""
    ext = ROOT / "data" / "external"
    e = pd.concat([pd.read_csv(ext / "telegram" / f) for f in
                   ("events_DtOperativno_2025-01-01_2025-10-24.csv", "events_DtOperativno_2025-10-25_2026-01-05.csv")])
    e = e.dropna(subset=["our_routes"])
    rows = []
    for _, r in e.iterrows():
        date = pd.Timestamp(r["date"])
        for route in str(r["our_routes"]).split("|"):
            route = int(float(route))
            if r["kind"] in ("tram_delay",):
                h0 = int(str(r["time"])[:2])
                h1 = int(str(r["time_end"])[:2]) if isinstance(r["time_end"], str) else h0
                rows += [(route, date, h, 1.0, 0.0) for h in range(h0, max(h0, h1) + 1)]
            else:
                rows += [(route, date + pd.Timedelta(days=k), h, 0.0, 1.0) for k in range(3) for h in range(24)]
    ev = pd.DataFrame(rows, columns=["route", "date", "hour", "ev_delay", "ev_notice"])
    ev = ev.groupby(["route", "date", "hour"]).max()

    rc = pd.read_csv(ext / "route_changes" / "route_changes.csv")
    rc = rc[rc["kind"].isin(["shortened", "closure"])]
    rows = []
    for _, r in rc.iterrows():
        end = pd.Timestamp(r["date_to"]) if isinstance(r["date_to"], str) else pd.Timestamp("2026-01-05")
        hours = range(int(r["hour_from"]), int(r["hour_to"]) + 1) if pd.notna(r["hour_from"]) else range(24)
        for d in pd.date_range(r["date_from"], end):
            if r["day_scope"] == "weekend" and d.dayofweek < 5:
                continue
            rows += [(int(r["route"]), d, h) for h in hours]
    rg = pd.DataFrame(rows, columns=["route", "date", "hour"]).drop_duplicates().assign(rg=1.0)
    return ev, rg.set_index(["route", "date", "hour"])["rg"]


def synthetic_events(hist: pd.DataFrame) -> pd.DataFrame:
    """Случайные события с фиксированным зерном: флаг вида и множитель факта по маршруту, дню и часу."""
    rng = np.random.default_rng(SYN_SEED)
    days = pd.date_range("2025-01-06", "2025-10-31")
    rows = []
    for kind, (mult, hours, per_route, weekend, per_month) in SYN_EVENTS.items():
        pool = days[days.dayofweek >= 5] if weekend else days
        n = int(round(per_month * len(days) / 30.4))
        for d in sorted(rng.choice(pool, size=n, replace=False)):
            d = pd.Timestamp(d)
            routes = [int(rng.choice(EVAL_ROUTES))] if per_route else EVAL_ROUTES
            if hours == "day":
                h0 = int(rng.integers(7, 19))
                hs = range(h0, h0 + int(rng.integers(2, 4)))
            else:
                hs = range(hours[0], hours[1] + 1)
            rows += [(kind, r, d, h, mult) for r in routes for h in hs]
    s = pd.DataFrame(rows, columns=["kind", "route", "date", "hour", "mult"])
    s["n"] = s.groupby("kind")["date"].rank(method="dense").astype(int)  # номер повтора события своего вида
    flags = s.pivot_table(index=["route", "date", "hour"], columns="kind", values="mult", aggfunc="size", fill_value=0)
    flags = flags.reindex(columns=SYN_COLS, fill_value=0).clip(upper=1).astype(float)
    flags["mult"] = s.groupby(["route", "date", "hour"])["mult"].prod()
    flags.attrs["events"] = s
    return flags


def curve(inp: Inputs, d: pd.DataFrame) -> dict:
    """Кривая обучения: ошибка моделей на часах синтетических событий по номеру повтора события,
    доля от факта без обрезки. Счёт 1 − ошибка тут не годится: при сбое факт падает до 40 %,
    ошибка того, кто события не знает, больше самого факта, и счёт упирается в ноль у всех."""
    s = inp.syn.attrs["events"]
    d = d.merge(s[["kind", "route", "date", "hour", "n"]], on=["route", "date", "hour"])
    err = lambda g: {m: round(float((g[m] - g["y"]).abs().sum() / max(1.0, g["y"].sum())), 4) for m in MODELS}
    out = {}
    for kind, g in d.groupby("kind"):
        out[kind] = {f"{lo}—{hi}" if hi < 99 else f"{lo}+": err(g[g["n"].between(lo, hi)])
                     for lo, hi in SYN_BUCKETS if g["n"].between(lo, hi).any()}
    return out


def columns(mode: str) -> list:
    rich = mode in ("events", "synthetic")
    return (["route", "hour", "dow", "dt", "rec_h", "rec_d"] + CAL_COLS + KNOWN_COLS
            + (WEATHER_COLS if mode != "known" else []) + (EVENT_COLS + ROUTE_EVENT_COLS if rich else [])
            + (SYN_COLS if mode == "synthetic" else []))


class Learners:
    """Регрессия, бустинг и гибрид, обученные на одной выборке."""

    def __init__(self, train: pd.DataFrame, mode: str, stat=None):
        self.cols = columns(mode)
        x = train[self.cols].fillna(0)
        self.ml = lgb.LGBMRegressor(**LGB_PARAMS).fit(x, train["y"], categorical_feature=["route"])
        # гибрид: цель — лог отношения факта к прогнозу статистики, входы — те же плюс сам прогноз и дальность
        self.hyb = None
        if stat is not None:
            h = self._hyb_x(train, stat)
            r = np.log((train["y"].to_numpy() + 1) / (stat + 1))
            self.hyb = lgb.LGBMRegressor(**HYB_PARAMS).fit(h, np.clip(r, -1, 1), categorical_feature=["route"])
        self.ridge_cols = None
        xr = self._ridge_x(train)
        self.reg = Ridge(alpha=1.0).fit(xr, np.log1p(train["y"]))

    def _ridge_x(self, g: pd.DataFrame) -> pd.DataFrame:
        # форма дня — через уровень часа rec_h; сверху сдвиги часа по типу дня и маршрута
        x = g[[c for c in self.cols if c not in ("route", "hour", "dow", "dt")]].fillna(0).copy()
        x = pd.concat([x, pd.get_dummies(g["route"].astype(str), prefix="r", dtype=float),
                       pd.get_dummies(g["hour"].astype(str) + "_" + g["dt"].astype(str), prefix="h", dtype=float)], axis=1)
        if self.ridge_cols is None:
            self.ridge_cols = list(x.columns)
        return x.reindex(columns=self.ridge_cols, fill_value=0.0)

    def _hyb_x(self, g: pd.DataFrame, stat) -> pd.DataFrame:
        x = g[self.cols].fillna(0).copy()
        x["stat_log"] = np.log1p(stat)
        x["ahead"] = np.minimum((g["date"] - g["origin"]).dt.days.to_numpy(), 28)
        return x

    def predict(self, g: pd.DataFrame) -> dict:
        return {"reg": np.clip(np.expm1(self.reg.predict(self._ridge_x(g))), 0, None),
                "ml": np.clip(self.ml.predict(g[self.cols].fillna(0)), 0, None)}

    def hybrid(self, g: pd.DataFrame, stat) -> np.ndarray:
        k = HYB_SHRINK * np.clip(self.hyb.predict(self._hyb_x(g, stat)), -HYB_CAP, HYB_CAP)
        return np.clip((stat + 1) * np.exp(k) - 1, 0, None)


def stat_days(inp: Inputs) -> pd.DataFrame:
    """Дневные ошибки статистической модели при прогнозе на месяц вперёд, февраль—октябрь:
    из них по дням до даты прогноза снимается погодная поправка."""
    if inp._days is None:
        parts = []
        for m in range(2, 11):
            s = pd.Timestamp(2025, m, 1)
            e, te = s + pd.offsets.MonthEnd(0), s - pd.Timedelta(days=1)
            pred = backtest.build(inp.hist, inp.cal, te.strftime("%F"), s.strftime("%F"), e.strftime("%F"), **core(MAIN))
            d = pred.groupby("date")["prediction"].sum().to_frame()
            d["y"] = inp.hist[(inp.hist["date"] >= s) & (inp.hist["date"] <= e)].groupby("date")["boardings"].sum()
            d["res"] = np.log(d["y"] / d["prediction"])
            d["res"] -= d["res"].median()  # уровень месяца снят: поправка отвечает только за колебания дней
            parts.append(d)
        d = pd.concat(parts).join(inp.feat[["t_anom7", "precip_mm"]]).join(inp.cal.set_index("date")[["short", "holiday_weekday"]])
        d = d[~d["short"] & ~d["holiday_weekday"]].dropna()
        d["wkd"] = d.index.dayofweek >= 5
        inp._days = d
    return inp._days


def weather_factor(inp: Inputs, origin, dates: pd.DatetimeIndex) -> np.ndarray:
    d = stat_days(inp)
    d = d[d.index < origin.to_period("M").start_time]  # только месяцы, закончившиеся до даты прогноза
    f = inp.feat.reindex(dates)
    wkd = dates.dayofweek >= 5
    eff = np.zeros(len(dates))
    for w in (False, True):
        y = d[d["wkd"] == w]
        if len(y) < WEATHER_FIT_MIN_DAYS:
            continue
        x = np.c_[y["t_anom7"], y["precip_mm"], np.ones(len(y))]
        c = np.linalg.lstsq(x, y["res"].to_numpy(), rcond=None)[0]
        if not w:
            c[0] = 0.0  # в будни температура поездок на работу не двигает
        m = wkd == w
        eff[m] = f["t_anom7"].to_numpy()[m] * c[0] + f["precip_mm"].to_numpy()[m] * c[1]
    return np.exp(np.clip(np.nan_to_num(eff), -WEATHER_CAP, WEATHER_CAP))


def stat_cached(inp: Inputs, origin, mode: str) -> pd.Series:
    """Прогноз статистической модели от даты на 28 дней вперёд — один раз на дату и режим.
    События она не берёт, поэтому в режиме с событиями её прогноз тот же, что с погодой."""
    weather = mode != "known"
    key = (origin, weather)
    if key not in inp._stat:
        inp._stat[key] = stat_forecast(inp, origin, origin + pd.Timedelta(days=1), origin + pd.Timedelta(days=28), weather)
    return inp._stat[key]


def stat_for_rows(inp: Inputs, g: pd.DataFrame, mode: str) -> np.ndarray:
    """Прогноз статистики для строк обучающей выборки: каждая строка — от своей даты прогноза."""
    out = np.zeros(len(g))
    for o, idx in g.groupby("origin").indices.items():
        part = g.iloc[idx]
        s = stat_cached(inp, pd.Timestamp(o), mode)
        out[idx] = s.reindex(pd.MultiIndex.from_frame(part[["route", "date", "hour"]])).fillna(0).to_numpy()
    return out


def fit(inp: Inputs, until, mode: str) -> Learners:
    train = inp.train_set(until, mode)
    return Learners(train, mode, stat_for_rows(inp, train, mode))


def within_day(d: pd.DataFrame, m: str) -> np.ndarray:
    """Прогноз на час вперёд: прогноз модели на день, поправленный по факту прошедших часов дня."""
    orig = d.index
    d = d.sort_values(["route", "date", "hour"])
    base, y = d[m].to_numpy(dtype=float), np.nan_to_num(d["y"].to_numpy(dtype=float))
    out = base.copy()
    for idx in d.groupby(["route", "date"]).indices.values():
        b, f = base[idx], y[idx]
        ok = (b >= NOW_HOUR_MIN) & (f >= NOW_GAP * b)
        cy, cb, cn = np.cumsum(np.where(ok, f, 0)), np.cumsum(np.where(ok, b, 0)), np.cumsum(ok)
        for j in range(1, len(idx)):
            # к часу j известен факт часов до j
            if cn[j - 1] >= NOW_MIN_HOURS and cb[j - 1] >= NOW_SUM_MIN:
                out[idx[j]] = b[j] * np.clip(cy[j - 1] / cb[j - 1], NOW_LO, NOW_HI) ** NOW_TRUST
    return pd.Series(out, index=d.index).reindex(orig).to_numpy()


def stat_forecast(inp: Inputs, origin, start, end, weather: bool) -> pd.Series:
    pred = backtest.build(inp.hist, inp.cal, origin.strftime("%F"), start.strftime("%F"), end.strftime("%F"), **core(MAIN))
    p = pred.set_index(["route", "date", "hour"])["prediction"]
    if weather:
        dates = pd.DatetimeIndex(p.index.get_level_values("date"))
        uniq = dates.unique()
        k = pd.Series(weather_factor(inp, origin, uniq), index=uniq)
        p = p * k.reindex(dates).to_numpy()
    return p


def run(mode: str, inp: Inputs, log=print) -> dict:
    """Все горизонты для одного режима входов: строки прогноза и счёт."""
    rows = {h: [] for h in SHORT}
    learners, fitted = None, None
    origins = pd.date_range(FIRST_ORIGIN, LAST_DAY - pd.Timedelta(days=1))
    t0 = time.time()
    for o in origins:
        if fitted is None or (o - fitted).days >= REFIT_DAYS:
            learners, fitted = fit(inp, o, mode), o
        targets = [o + pd.Timedelta(days=h) for h in SHORT if o + pd.Timedelta(days=h) <= LAST_DAY]
        g = inp.frame(o, targets, mode)
        g["origin"] = o
        pr = learners.predict(g)
        st = stat_cached(inp, o, mode)
        g["stat"] = st.reindex(pd.MultiIndex.from_frame(g[["route", "date", "hour"]])).fillna(0).to_numpy()
        g["reg"], g["ml"] = pr["reg"], pr["ml"]
        g["hyb"] = learners.hybrid(g, g["stat"].to_numpy())
        for h in SHORT:
            part = g[g["date"] == o + pd.Timedelta(days=h)]
            if len(part):
                rows[h].append(part[["route", "date", "hour", "origin", "y", *MODELS]])
        if o.day == 1:
            log(f"  {mode}: {o:%d.%m}, {time.time() - t0:.0f} с")
    short = {h: pd.concat(v, ignore_index=True) for h, v in rows.items()}
    # через час: те же дни, что «на завтра», дата прогноза — сам день
    hour = short[1].copy()
    for m in MODELS:
        hour[m] = within_day(hour, m)
    hour["origin"] = hour["date"]

    long = {}
    for k in LONG:
        parts = []
        for m in range(1, 11 - k):
            origin = pd.Timestamp(2025, m, 1) + pd.offsets.MonthEnd(0)
            start = pd.Timestamp(2025, m + k, 1)
            end = start + pd.offsets.MonthEnd(0)
            lr = fit(inp, origin, mode)
            g = inp.frame(origin, pd.date_range(start, end), mode)
            g["origin"] = origin
            pr = lr.predict(g)
            g["reg"], g["ml"] = pr["reg"], pr["ml"]
            st = stat_forecast(inp, origin, start, end, mode != "known")
            g["stat"] = st.reindex(pd.MultiIndex.from_frame(g[["route", "date", "hour"]])).fillna(0).to_numpy()
            g["hyb"] = lr.hybrid(g, g["stat"].to_numpy())
            parts.append(g[["route", "date", "hour", "origin", "y", *MODELS]])
        long[k] = pd.concat(parts, ignore_index=True)
    return {"hour": hour, "short": short, "long": long}


def score(d: pd.DataFrame) -> dict:
    return {m: round(wape_score(d["y"], d[m]), 4) for m in MODELS}


def event_mask(inp: Inputs, d: pd.DataFrame) -> np.ndarray:
    """Маршрут-день с событием на самом маршруте: пост Дептранса о нём или режим ремонта. Городские
    события (перекрытия центра, матчи, концерты) идут почти через день и счёт по ним не отличается
    от обычных дней, поэтому в выборку не входят."""
    ev = inp.route_ev.reset_index()[["route", "date"]].drop_duplicates()
    rg = inp.regime.reset_index()[["route", "date"]].drop_duplicates()
    keys = set(map(tuple, pd.concat([ev, rg]).to_numpy()))
    return np.array([(r, t) in keys for r, t in zip(d["route"], d["date"])])


def split(inp: Inputs, d: pd.DataFrame) -> dict:
    m = event_mask(inp, d)
    return {"event": score(d[m]), "plain": score(d[~m]), "event_share": round(float(d["y"][m].sum() / d["y"].sum()), 3)}


def summary(res: dict, inp: Inputs) -> dict:
    out = {}
    d = res["hour"]
    out["1h"] = {"all": score(d), "n": int(d["origin"].nunique()), "split": split(inp, d),
                 "months": {f"{m:02d}": score(d[d["date"].dt.month == m]) for m in sorted(d["date"].dt.month.unique())}}
    for h, d in res["short"].items():
        months = {f"{m:02d}": score(d[d["date"].dt.month == m]) for m in sorted(d["date"].dt.month.unique())}
        out[f"{h}d"] = {"all": score(d), "n": int(d["origin"].nunique()), "split": split(inp, d), "months": months}
    for k, d in res["long"].items():
        wins = {f"{o:%m}→{t:%m}": score(g) for (o, t), g in d.groupby([d["origin"], d["date"].dt.to_period("M").dt.start_time])}
        out[f"{k}m"] = {"all": score(d), "n": int(d["origin"].nunique()), "split": split(inp, d), "windows": wins}
    return out


def replay(d: pd.DataFrame) -> dict:
    """Для прогона на экране: по каждой дате прогноза — день-цель, сумма сети по часам и ошибки по маршрутам."""
    out = {"dates": [], "fact": [], **{m: [] for m in MODELS}, "err": {m: [] for m in MODELS}, "sum": []}
    for (o, t), g in d.groupby(["origin", "date"]):
        net = g.groupby("hour")[["y", *MODELS]].sum()
        out["dates"].append([o.strftime("%F"), t.strftime("%F")])
        out["fact"].append(net["y"].round().astype(int).tolist())
        for m in MODELS:
            out[m].append(net[m].round().astype(int).tolist())
            e = (g[m] - g["y"]).abs().groupby(g["route"]).sum()
            out["err"][m].append([int(round(e.get(r, 0))) for r in EVAL_ROUTES])
        out["sum"].append([int(round(v)) for v in g.groupby("route")["y"].sum().reindex(EVAL_ROUTES, fill_value=0)])
    return out


def main():
    inp = Inputs()
    result, tables = {}, {}
    for key in MODES + ("synthetic",):
        if key == "synthetic":
            inp = Inputs(synthetic=True)
        res = run(key, inp)
        tables[key] = summary(res, inp)
        result[key] = {"table": tables[key], "replay": {"1h": replay(res["hour"]), **{f"{h}d": replay(res["short"][h]) for h in SHORT}}}
        if key == "synthetic":
            result[key]["curve"] = {"1h": curve(inp, res["hour"]), **{f"{h}d": curve(inp, res["short"][h]) for h in (1, 7)}}
        pd.to_pickle(res, ROOT / "artifacts" / f"horizons_{key}.pkl")
    for key, t in tables.items():
        print(f"\n{key}:")
        for hz, v in t.items():
            print(f"  {hz:>4}  n={v['n']:>3}  " + "  ".join(f"{m} {v['all'][m]:.4f}" for m in MODELS)
                  + "  | в дни событий " + "  ".join(f"{m} {v['split']['event'][m]:.4f}" for m in MODELS)
                  + f"  (доля {v['split']['event_share']})")
    out = ROOT / "web" / "public" / "data" / "horizons.json"
    out.write_text(json.dumps({"routes": [str(r) for r in EVAL_ROUTES], **result}, ensure_ascii=False, separators=(",", ":")))
    print(out, out.stat().st_size // 1024, "КБ")


if __name__ == "__main__":
    main()
