"""Сводная таблица внешних признаков по дням 2025 года — features_daily_2025.csv.

Источники (все бесплатные, лежат в этой папке):
  isdayoff_2025.csv                       производственный календарь
  calendar_extra/school_holidays.csv      каникулы школ двух систем, сессии вузов
  open_meteo_2025_hourly_codes.csv        погода по часам с кодами WMO
  open_meteo_2025_daily.csv               восход, закат, световой день
  telegram/events_*.csv                   события из каналов Дептранса (extract_events.py)
  football/lokomotiv_home_2025.csv        домашние матчи на «РЖД Арене»
  kudago/kudago_msk_2025.jsonl            афиша KudaGo с координатами площадок
  route_changes/*.csv                     изменения работы наших маршрутов
  features_daily_2025-11_12.csv           ручные флаги окна (катки, ярмарки, концерты)

Запуск: python3 build_features.py — перезаписывает features_daily_2025.csv
и web/public/data/factors.json для стенда.
"""
import glob
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
OURS = [1, 5, 7, 11, 12, 17, 25, 26, 28, 50]
YEAR = "2025"
NEAR_M = 300          # площадка «у остановки» — не дальше этого от остановки наших маршрутов
SHORT_EVENT_DAYS = 3  # разовое событие; длиннее — каток, ярмарка, выставка

f = pd.DataFrame({"date": pd.date_range(f"{YEAR}-01-01", f"{YEAR}-12-31")})
f["dow"] = f.date.dt.dayofweek

# ── календарь ──────────────────────────────────────────────────────────────
cal = pd.read_csv(HERE / "isdayoff_2025.csv", parse_dates=["date"])
f = f.merge(cal, on="date", how="left")
f["code"] = f.code.fillna(0).astype(int)
f["day_type"] = np.select([f.code == 2, (f.code == 0) & (f.dow >= 5), f.code == 1],
                          ["short", "working_weekend", "dayoff"], "workday")
f["holiday_weekday"] = ((f.code == 1) & (f.dow < 5)).astype(int)
f = f.drop(columns="code")

sh = pd.read_csv(HERE / "calendar_extra" / "school_holidays.csv", parse_dates=["date_from", "date_to"])


def in_ranges(rows, start_col="date_from", end_col="date_to", end_default=f"{YEAR}-12-31"):
    m = pd.Series(False, index=f.index)
    for _, r in rows.iterrows():
        end = r[end_col] if pd.notna(r[end_col]) else pd.Timestamp(end_default)
        m |= (f.date >= r[start_col]) & (f.date <= end)
    return m.astype(int)


f["school_q_holiday"] = in_ranges(sh[(sh["mode"] == "quarters") & (sh.holiday != "summer")])
f["school_m_holiday"] = in_ranges(sh[sh["mode"] == "trimesters"])
f["school_summer"] = in_ranges(sh[sh.holiday == "summer"])
f["univ_session"] = in_ranges(sh[sh["mode"] == "universities"])
# Сессии вузов у наших маршрутов за весь год — сбор второго круга (recheck/universities_2025.csv)
uv = HERE / "recheck" / "universities_2025.csv"
if uv.exists():
    u = pd.read_csv(uv, parse_dates=["date_from", "date_to"])
    f["univ_exam"] = in_ranges(u[u.period_kind == "exam_session"])
    f["univ_holidays"] = in_ranges(u[u.period_kind == "holidays"])
    ex = u[(u.period_kind == "exam_session") & u.nearest_routes.notna()]
    f["univ_exam_routes"] = f.date.map(lambda d: "|".join(sorted({r for _, row in ex.iterrows() if row.date_from <= d <= (row.date_to if pd.notna(row.date_to) else d)
                                                                     for r in str(row.nearest_routes).split("|") if r.strip().isdigit()}, key=int)))
    f["univ_session"] = ((f.univ_session == 1) | (f.univ_exam == 1)).astype(int)

# ── погода ────────────────────────────────────────────────────────────────
w = pd.read_csv(HERE / "open_meteo_2025_hourly_codes.csv", parse_dates=["time"])
w["date"] = w.time.dt.normalize()
wd = w.groupby("date").agg(t_mean=("temperature_2m", "mean"), t_min=("temperature_2m", "min"),
                           t_max=("temperature_2m", "max"), precip_mm=("precipitation", "sum"),
                           rain_mm=("rain", "sum"), snow_cm=("snowfall", "sum"),
                           snow_depth_m=("snow_depth", "max"), wind_max=("wind_speed_10m", "max"),
                           gust_max=("wind_gusts_10m", "max"), humidity=("relative_humidity_2m", "mean")).reset_index()
peak = w[w.time.dt.hour.isin([7, 8, 9, 16, 17, 18, 19])].groupby("date").rain.sum().rename("rain_peak_mm").reset_index()
freezing = w[w.weather_code.isin([56, 57, 66, 67])].groupby("date").size().rename("freezing_hours").reset_index()
f = f.merge(wd, on="date", how="left").merge(peak, on="date", how="left").merge(freezing, on="date", how="left")
f[["rain_peak_mm", "freezing_hours"]] = f[["rain_peak_mm", "freezing_hours"]].fillna(0)
for c in ["t_mean", "t_min", "t_max", "precip_mm", "rain_mm", "snow_cm", "wind_max", "gust_max", "humidity"]:
    f[c] = f[c].round(1)
f["snow_depth_m"] = f.snow_depth_m.round(2)

d = pd.read_csv(HERE / "open_meteo_2025_daily.csv", parse_dates=["time"]).rename(columns={"time": "date"})
d["daylight_h"] = (d.daylight_duration / 3600).round(2)
d["sunset_h"] = pd.to_datetime(d.sunset).dt.hour + (pd.to_datetime(d.sunset).dt.minute / 60).round(2)
f = f.merge(d[["date", "daylight_h", "sunset_h", "precipitation_hours"]], on="date", how="left")

# ── каналы Дептранса ─────────────────────────────────────────────────────
ev_files = sorted(glob.glob(str(HERE / "telegram" / "events_*.csv")))
ev = pd.concat([pd.read_csv(p, parse_dates=["date"]) for p in ev_files], ignore_index=True) if ev_files else pd.DataFrame(
    columns=["date", "kind", "center", "our_routes"])
ev = ev[ev.date.dt.year == int(YEAR)]


def count(kind, mask=None):
    e = ev[ev.kind == kind]
    if mask is not None:
        e = e[mask(e)]
    return f.date.map(e.groupby("date").size()).fillna(0).astype(int)


f["ice_rain_post"] = (count("ice_rain") > 0).astype(int)
# Пост о ледяном дожде выходит накануне вечером или в тот же день: флаг на день поста и следующий.
f["ice_rain"] = ((f.ice_rain_post == 1) | (f.ice_rain_post.shift(1, fill_value=0) == 1)).astype(int)
f["ice_warning"] = (count("ice_warning") > 0).astype(int)
f["snow_event"] = ((count("snow") > 0) | (f.snow_cm >= 3)).astype(int)
f["weather_warning"] = (count("weather_warning") > 0).astype(int)
f["closures_n"] = count("closure")
f["center_closure"] = (count("closure", lambda e: e.center == 1) > 0).astype(int)
f["metro_outage"] = (count("metro_outage") > 0).astype(int)
f["free_ride"] = (count("free_ride") > 0).astype(int)
f["reinforced"] = (count("reinforced") > 0).astype(int)
f["tram_delay_our_n"] = count("tram_delay", lambda e: e.our_routes.notna())
f["tram_changed_our_n"] = count("tram_changed", lambda e: e.our_routes.notna())

# ── матчи на «РЖД Арене» (маршруты 7 и 11) ────────────────────────────────
fb = pd.read_csv(HERE / "football" / "lokomotiv_home_2025.csv", parse_dates=["date"])
fb["attendance"] = pd.to_numeric(fb.attendance, errors="coerce")
g = fb.groupby("date").agg(football_rzd_att=("attendance", "sum"), football_time=("time", "first")).reset_index()
f = f.merge(g, on="date", how="left")
f["football_rzd"] = f.football_time.notna().astype(int)
f["football_rzd_att"] = f.football_rzd_att.fillna(0).astype(int)

# ── афиша KudaGo у остановок наших маршрутов ─────────────────────────────
stops = pd.read_csv(HERE / "osm" / "stops.csv")
stops = stops[stops.route.astype(str).isin(map(str, OURS))]
lat0 = math.radians(55.75)
sx = np.radians(stops.lon.values) * math.cos(lat0) * 6371000
sy = np.radians(stops.lat.values) * 6371000
near_short = {}
near_long = {}
near_routes = {}
kg = HERE / "kudago" / f"kudago_msk_{YEAR}.jsonl"
if kg.exists():
    y0, y1 = pd.Timestamp(f"{YEAR}-01-01"), pd.Timestamp(f"{YEAR}-12-31")
    for line in open(kg, encoding="utf-8"):
        e = json.loads(line)
        c = e.get("coords") or {}
        if not c.get("lat"):
            continue
        ex = math.radians(c["lon"]) * math.cos(lat0) * 6371000
        ey = math.radians(c["lat"]) * 6371000
        dist = np.hypot(sx - ex, sy - ey)
        if dist.min() > NEAR_M:
            continue
        routes = set(stops.route[dist <= NEAR_M].astype(str))
        for dd in e.get("dates") or []:
            a = pd.Timestamp(dd["start"], unit="s").normalize()
            b = pd.Timestamp(dd["end"], unit="s").normalize() if dd.get("end") else a
            if b < y0 or a > y1 or (b - a).days > 120:
                continue
            a, b = max(a, y0), min(b, y1)
            short = (b - a).days < SHORT_EVENT_DAYS
            for day in pd.date_range(a, b):
                (near_short if short else near_long)[day] = (near_short if short else near_long).get(day, 0) + 1
                near_routes.setdefault(day, set()).update(routes)
f["kudago_near_n"] = f.date.map(near_short).fillna(0).astype(int)
f["kudago_near_long_n"] = f.date.map(near_long).fillna(0).astype(int)
f["kudago_routes"] = f.date.map(lambda x: "|".join(sorted(near_routes.get(x, set()), key=int)))

# ── ручные флаги окна: катки, ярмарки, концерты (сбор 25.09.2026) ─────────
# События января—октября у площадок (второй круг сбора): концерты и прочее, кроме футбола
ej = HERE / "recheck" / "events_2025_jan_oct.csv"
if ej.exists():
    e2 = pd.read_csv(ej, parse_dates=["date"])
    e2 = e2[e2.category.astype(str).str.lower().isin(["concert", "festival", "fair", "exhibition", "hockey", "other", "holiday"])]
    f["events_near_n"] = f.date.map(e2.groupby("date").size()).fillna(0).astype(int)
else:
    f["events_near_n"] = 0
old = HERE / "features_daily_2025-11_12.csv"
if old.exists():
    o = pd.read_csv(old, parse_dates=["date"])[["date", "vdnh_rink", "christmas_fest", "concerts_n"]]
    f = f.merge(o, on="date", how="left")
for c in ["vdnh_rink", "christmas_fest", "concerts_n"]:
    f[c] = f.get(c, 0)
    f[c] = f[c].fillna(0).astype(int)

# ── изменения работы маршрутов ───────────────────────────────────────────
rc = pd.concat([pd.read_csv(p, parse_dates=["date_from", "date_to"]) for p in glob.glob(str(HERE / "route_changes" / "*.csv"))])
rc["route"] = rc.route.astype(int)


def route_flag(route, kind, scope=None, hour=None):
    rows = rc[(rc.route == route) & (rc.kind == kind)]
    if scope:
        rows = rows[rows.day_scope == scope]
    if hour is not None:
        rows = rows[rows.hour_from == hour]
    m = in_ranges(rows)
    if scope == "weekend":
        m = (m.astype(bool) & (f.dow >= 5)).astype(int)
    return m


f["r50_weekend_cancelled"] = route_flag(50, "closure", "weekend")
f["r7_weekend_shortened"] = route_flag(7, "shortened", "weekend")
f["r7_r50_late_cut_22"] = route_flag(7, "shortened", "all", 22)
f["r7_r50_late_cut_23"] = ((route_flag(7, "shortened", "all", 23) == 1) & (f.r7_r50_late_cut_22 == 0)).astype(int)
f["r5_active"] = route_flag(5, "new_route")
f["t1_active"] = (f.date >= "2025-11-12").astype(int)   # диаметр Т1, строки «other» от 12.11 в реестре

f.to_csv(HERE / f"features_daily_{YEAR}.csv", index=False)
print(f"features_daily_{YEAR}.csv", len(f), "дней,", len(f.columns), "колонок; событий Дептранса:", len(ev))

# ── для стенда: флаги по дням без текста ────────────────────────────────
web = HERE.parent.parent / "web" / "public" / "data"
if web.exists():
    cols = ["day_type", "holiday_weekday", "school_q_holiday", "school_m_holiday", "univ_session", "t_mean", "rain_mm",
            "rain_peak_mm", "snow_cm", "snow_depth_m", "gust_max", "daylight_h", "ice_rain", "ice_warning", "snow_event",
            "weather_warning", "center_closure", "metro_outage", "free_ride", "football_rzd", "football_rzd_att",
            "football_time", "kudago_near_n", "kudago_near_long_n", "kudago_routes", "events_near_n", "vdnh_rink", "christmas_fest",
            "concerts_n", "r50_weekend_cancelled", "r7_weekend_shortened", "r7_r50_late_cut_22", "r7_r50_late_cut_23",
            "r5_active", "t1_active"]
    out = {r.date.strftime("%Y-%m-%d"): {c: (None if pd.isna(r[c]) else (r[c].item() if hasattr(r[c], "item") else r[c])) for c in cols}
           for _, r in f.iterrows()}
    (web / "factors.json").write_text(json.dumps(out, ensure_ascii=False))
    print("web/public/data/factors.json", len(out))
