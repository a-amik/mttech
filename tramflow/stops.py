"""Посадки по остановкам: привязка валидаций к остановке по времени, вагону и расписанию.

В валидации нет остановки, зато есть точное время, бортовой номер вагона и выход. Архив
расписания transport.mos.ru на прошедшие даты даёт время прохода каждой остановки каждым
рейсом. Октябрь 2025 есть и там, и там (13—31.10), и на нём строятся доли:

1. Рейсы вагона — валидации одного борта за день, разрезанные по стоянкам на конечных:
   пауза без посадок, когда вагон уже прошёл большую часть планового хода.
2. Направление — рейсы вагона чередуются, поэтому на вагон-день гипотез две. Выбор —
   по близости начала рейсов к плановым отправлениям с каждой конечной, затем уточнение
   сходством с общей картиной посадок по остановкам.
3. Остановка — момент валидации внутри рейса переводится в остановку по плановому
   времени хода этого часа. Посадки у конечной до отправления идут первой остановке.
4. Доли — посадки остановки к посадкам маршрута за час, по типу дня.

Прогноз по остановкам = прогноз «маршрут × час» × доля. Точность привязки ±1—2 остановки:
опоздание от графика сдвигает её. Эталона по остановкам нет, поэтому проверка — на
устойчивость долей между половинами месяца и на правдоподобие пересадочных узлов.

    python -m tramflow.stops dataset.zip   # выгрузить валидации октября и посчитать доли
    python -m tramflow.stops               # доли по уже выгруженным → data/stops/, отчёт о проверке
"""
import re

import numpy as np
import pandas as pd

from . import calendar
import json

from .config import DATA, EXTERNAL, FORECAST_END, FORECAST_START, ROOT

# Архив расписания transport.mos.ru скользящий: октябрь 2025 из него уже выпадает, поэтому
# нужные дни лежат в репозитории выборкой; полный архив — schedule/stop_times.csv, вне git.
SCHEDULE = EXTERNAL / "schedule_oct_2025.csv.gz"
VALIDATIONS = DATA / "stops" / "val_oct.csv"   # время;маршрут;борт;выход;карта, успешные, с 11.10
OUT = DATA / "stops"
WEB = ROOT / "web" / "public" / "data" / "stops.json"
FIRST, LAST = "2025-10-13", "2025-10-31"

GAP_MIN = 1.5    # мин без посадок — только по такой паузе рейс может кончиться
MAX_RUN = 1.7    # рейс не длиннее этой доли планового хода
FIT = 12.0       # вес отклонения длины рейса от планового хода против длины паузы
DWELL_MAX = 3.0  # мин посадки у конечной до отправления, не больше
EM_ROUNDS = 6


def day_type(dates: pd.Series, cal: pd.DataFrame) -> pd.Series:
    """Будни и выходные по производственному календарю: рабочая суббота — будни, праздник — выходной."""
    off = cal.set_index("date")["day_off"]
    return np.where(pd.to_datetime(dates).map(off).fillna(False).astype(bool), "weekend", "weekday")


def schedule_trips(st: pd.DataFrame):
    """Рейсы расписания по дням: минуты прохода остановок, строка — рейс.

    У полного рейса отправлений на каждой остановке поровну, n-е отправление с конечной —
    n-й рейс. Дни направления с укороченными рейсами пропускаются. Время после полуночи
    и до трёх часов — продолжение суток."""
    stops, trips = {}, []
    for (route, date, d), q in st.groupby(["route", "date", "direction"]):
        m = q.hour * 60 + q.minute
        q = q.assign(m=np.where(m < 180, m + 1440, m))
        by = [g.sort_values().to_numpy() for _, g in q.groupby("stop_seq")["m"]]
        if len({len(x) for x in by}) != 1:
            continue
        names = tuple(q.drop_duplicates("stop_seq").sort_values("stop_seq")["stop_name"])
        stops.setdefault((route, d), {}).setdefault(names, 0)
        stops[(route, d)][names] += 1
        M = np.stack(by, axis=1).astype(float)
        trips.append((route, date, d, names, M))
    # у маршрута и направления — самый частый состав остановок
    canon = {k: max(v, key=v.get) for k, v in stops.items()}
    return canon, [t for t in trips if canon[(t[0], t[2])] == t[3]]


def run_profiles(canon, trips):
    """Плановое время хода от первой остановки: (маршрут, направление, час отправления) → минуты."""
    acc = {}
    for route, _, d, _, M in trips:
        off = M - M[:, :1]
        for i in range(len(M)):
            acc.setdefault((route, d, int(M[i, 0] // 60) % 24), []).append(off[i])
    prof = {k: np.median(np.stack(v), axis=0) for k, v in acc.items()}
    # час без рейсов берёт ближайший час с рейсами
    for (route, d) in canon:
        have = sorted(h for (r, dd, h) in prof if r == route and dd == d)
        for h in range(24):
            if (route, d, h) not in prof and have:
                near = min(have, key=lambda x: min(abs(x - h), 24 - abs(x - h)))
                prof[(route, d, h)] = prof[(route, d, near)]
    return prof


def departures(trips):
    """Плановые отправления с первой остановки: (маршрут, дата, направление) → минуты."""
    return {(r, date, d): np.sort(M[:, 0]) for r, date, d, _, M in trips}


def split_trips(t: np.ndarray, run: float) -> np.ndarray:
    """Номер рейса для каждой валидации вагона за день (t — минуты, по возрастанию).

    Разрезы ставятся только по паузам от GAP_MIN и подбираются динамикой: кусок должен быть
    близок к плановому ходу, а разрез выгоднее по длинной паузе — у конечной вагон стоит
    дольше, чем между остановками. Жадная резка по первой паузе дробит рейс: внутри хода
    тоже бывают перегоны без посадок."""
    n = len(t)
    cut = [0] + [i for i in range(1, n) if t[i] - t[i - 1] >= GAP_MIN] + [n]
    best = np.full(len(cut), np.inf)
    prev = np.zeros(len(cut), int)
    best[0] = 0.0
    for j in range(1, len(cut)):
        end = t[cut[j] - 1]
        bonus = -np.log(t[cut[j]] - t[cut[j] - 1]) if cut[j] < n else 0.0
        for i in range(j - 1, -1, -1):
            dur = end - t[cut[i]]
            if dur > MAX_RUN * run:
                break
            edge = cut[i] == 0 or cut[j] == n  # выход из депо и заход — рейс может быть неполным
            miss = min(0.0, (dur - run) / run) ** 2 if edge else ((dur - run) / run) ** 2
            c = best[i] + FIT * miss + bonus + 1.0
            if c < best[j]:
                best[j], prev[j] = c, i
    trip = np.zeros(n, int)
    j, bounds = len(cut) - 1, []
    while j > 0:
        bounds.append(cut[prev[j]])
        j = prev[j]
    for k, b in enumerate(sorted(bounds)):
        trip[b:] = k
    return trip


def place(t: np.ndarray, off: np.ndarray) -> np.ndarray:
    """Номер остановки (с нуля) для валидаций одного рейса по плановому ходу off.

    Посадка идёт до предпоследней остановки: на конечной выходят. Лишнее время рейса сверх
    планового до предпоследней — сперва стоянка с открытыми дверями у первой остановки
    (не больше DWELL_MAX), остальное — опоздание, растянутое по всему ходу."""
    last = len(off) - 2
    plan = off[last]
    a, b = t[0], t[-1]
    dwell = min(DWELL_MAX, max(0.0, (b - a) - plan))
    dep = a + dwell
    span = max(b - dep, 1e-6)
    frac = np.clip((t - dep) / span, 0, 1)
    norm = off[: last + 1] / max(plan, 1e-6)
    k = np.abs(frac[:, None] - norm[None, :]).argmin(axis=1)
    return np.where(t < dep, 0, k)


def assign(val: pd.DataFrame, canon, prof, deps) -> pd.DataFrame:
    """Рейс, две гипотезы направления и остановка при каждой из них для каждой валидации."""
    out = []
    for (route, date, garage), g in val.groupby(["route", "date", "garage"], sort=False):
        if (route, 0) not in canon or (route, 1) not in canon:
            continue
        t = g["m"].to_numpy()
        h0 = int(t[len(t) // 2] // 60) % 24
        run = 0.5 * (prof[(route, 0, h0)][-2] + prof[(route, 1, h0)][-2]) + 1
        trip = split_trips(t, run)
        stop = {0: np.zeros(len(t), int), 1: np.zeros(len(t), int)}
        score = 0.0  # > 0 — вагон начал день направлением 0
        for k in np.unique(trip):
            idx = np.where(trip == k)[0]
            tt = t[idx]
            h = int(tt[0] // 60) % 24
            for p in (0, 1):
                d = (p + k) % 2
                stop[p][idx] = place(tt, prof[(route, d, h)])
            dist = []
            for d in (0, 1):
                dd = deps.get((route, date, d))
                dist.append(np.abs(dd - tt[0]).min() if dd is not None and len(dd) else 30.0)
            # у нечётного рейса направления меняются местами
            score += (dist[1] - dist[0]) if k % 2 == 0 else (dist[0] - dist[1])
        out.append(pd.DataFrame({"route": route, "date": date, "garage": garage, "m": t, "trip": trip,
                                 "s0": stop[0], "s1": stop[1], "score": score, "card": g["card"].to_numpy()}))
    return pd.concat(out, ignore_index=True)


HUB = ("метро", "мцк", "мцд", "вокзал", "станция", "платформа")
TRANSFER = (1, 40)     # мин между поездками одной карты на двух наших маршрутах — пересадка
TRANSFER_MIN = 300     # пересадок на маршрут, чтобы якорь по ним считался
TRANSFER_GAP = 0.03    # и на столько доля попаданий должна отличаться от зеркала
DEPOT_SURE = 0.7       # утренний якорь: доля ранних вагонов, ушедших с конечной первого отправления


def norm(name: str) -> str:
    return re.sub(r'[«»"“”]', "", name).strip().lower()


def transfer_share(a: pd.DataFrame, canon, parity: pd.Series) -> pd.DataFrame:
    """Пересадки с другого нашего маршрута: доля посадок на остановках, общих с ним.

    Карта вошла в трамвай B через 1—40 минут после поездки на маршруте A — значит, села
    на остановке, которую обслуживают оба маршрута. При верном направлении B такие посадки
    падают на общие с A остановки, в зеркале — на противоположный конец линии."""
    names = {r: {norm(n) for (rr, _), ns in canon.items() if rr == r for n in ns} for r in a["route"].unique()}
    abs_m = pd.to_datetime(a["date"]).map(pd.Timestamp.toordinal).to_numpy() * 1440 + a["m"].to_numpy()
    o = np.lexsort((abs_m, a["card"].to_numpy()))
    card, rt, tm = a["card"].to_numpy()[o], a["route"].to_numpy()[o], abs_m[o]
    hit = np.zeros(len(a), bool)
    prev_route = np.zeros(len(a), int)
    same = (card[1:] == card[:-1]) & (rt[1:] != rt[:-1]) & (tm[1:] - tm[:-1] >= TRANSFER[0]) & (tm[1:] - tm[:-1] <= TRANSFER[1])
    rows = o[1:][same]
    prev_route[rows] = rt[:-1][same]
    hit[rows] = True
    p = a.set_index(["route", "date", "garage"]).index.map(parity).to_numpy()
    trip = a["trip"].to_numpy()
    out = {}
    for q, pp in (("direct", p), ("mirror", 1 - p)):
        d = (pp + trip) % 2
        s = np.where(pp == 0, a["s0"], a["s1"])
        on = np.array([norm(canon[(r, dd)][k]) in names[pr] if h else False
                       for r, dd, k, pr, h in zip(a["route"], d, s, prev_route, hit)])
        out[q] = pd.Series(on[hit]).groupby(a["route"].to_numpy()[hit]).mean()
    out["n"] = pd.Series(hit[hit]).groupby(a["route"].to_numpy()[hit]).size()
    return pd.DataFrame(out)


def hub_share(a: pd.DataFrame, canon, parity: pd.Series) -> pd.Series:
    """Доля посадок маршрута на пересадочных остановках при данном выборе направлений."""
    p = a.set_index(["route", "date", "garage"]).index.map(parity).to_numpy()
    d = (p + a["trip"].to_numpy()) % 2
    s = np.where(p == 0, a["s0"], a["s1"])
    hub = np.array([any(w in canon[(r, dd)][k].lower() for w in HUB) for r, dd, k in zip(a["route"], d, s)])
    return pd.Series(hub).groupby(a["route"].to_numpy()).mean()


def depot_share(a: pd.DataFrame, deps, parity: pd.Series) -> pd.Series:
    """Утренний выпуск: доля трёх первых вагонов дня, ушедших с конечной первого отправления.

    Вагон, чья первая посадка раньше первого отправления другой конечной, мог уйти только
    с этой. Считается при данном выборе направлений; у зеркала доля — дополнение до единицы."""
    p = a.set_index(["route", "date", "garage"]).index.map(parity).to_numpy()
    f = a.assign(d=(p + a["trip"].to_numpy()) % 2).groupby(["route", "date", "garage"]).agg(t0=("m", "first"), d=("d", "first"))
    hits = {}
    for (route, date), g in f.groupby(level=["route", "date"]):
        d0, d1 = deps.get((route, date, 0)), deps.get((route, date, 1))
        if d0 is None or d1 is None:
            continue
        first, other = (0, d1.min()) if d0.min() < d1.min() else (1, d0.min())
        early = g.nsmallest(3, "t0")
        hits.setdefault(route, []).extend((early["d"] == first)[early["t0"] < other - 2].tolist())
    return pd.Series({r: float(np.mean(v)) for r, v in hits.items() if v})


def resolve(a: pd.DataFrame, canon, deps) -> pd.DataFrame:
    """Направление рейсов вагон-дня.

    Рейсы вагона чередуются, поэтому на вагон-день две гипотезы. Итерации: доли «маршрут ×
    направление × остановка × час» считаются по текущему выбору, и каждый вагон-день берёт
    гипотезу, при которой его посадки правдоподобнее. Так вагоны согласуются между собой,
    но у маршрута остаются два зеркальных решения; из них берётся то, где больше посадок
    на пересадочных остановках — метро, МЦК, МЦД, вокзалы."""
    a = a.copy()
    a["h"] = (a["m"] // 60).astype(int) % 24
    keys = ["route", "date", "garage"]
    idx = a.set_index(keys).index
    parity = pd.Series(0, index=a.groupby(keys).size().index)
    trip = a["trip"].to_numpy()

    def loglik(parity):
        p = idx.map(parity).to_numpy()
        cur = pd.DataFrame({"route": a["route"], "d": (p + trip) % 2, "s": np.where(p == 0, a["s0"], a["s1"]), "h": a["h"]})
        share = cur.groupby(["route", "d", "s", "h"]).size()
        share = (share + 1) / (share.groupby(level=["route", "d", "h"]).transform("sum") + 30)
        ll = {}
        for q in (0, 1):
            key = pd.MultiIndex.from_arrays([a["route"], (q + trip) % 2, a["s0"] if q == 0 else a["s1"], a["h"]])
            ll[q] = np.log(share.reindex(key).fillna(1e-4).to_numpy())
        return ll[1] - ll[0]

    for _ in range(EM_ROUNDS):
        diff = pd.Series(loglik(parity)).groupby([a[k] for k in keys]).sum()
        new = (diff > 0).astype(int)
        changed = int((new != parity.reindex(new.index)).sum())
        parity = new
        if not changed:
            break
    # зеркало маршрута. Якорей два, оба привязаны к местности: пересадки с других наших
    # маршрутов (посадка на общей остановке) и утренний выпуск (ранние вагоны уходят с конечной
    # первого отправления). Совпали оба — направление подтверждено; есть один уверенный —
    # вероятно; спорят или слабы — не определено, и доли остановок маршрута не выдаются.
    direct, mirror = hub_share(a, canon, parity), hub_share(a, canon, 1 - parity)
    tr = transfer_share(a, canon, parity)
    dep = depot_share(a, deps, parity)
    flip, conf = set(), {}
    for r in direct.index:
        votes = []
        if r in tr.index and tr.loc[r, "n"] >= TRANSFER_MIN and abs(tr.loc[r, "direct"] - tr.loc[r, "mirror"]) >= TRANSFER_GAP:
            votes.append(tr.loc[r, "mirror"] > tr.loc[r, "direct"])
        if r in dep.index and (dep[r] >= DEPOT_SURE or dep[r] <= 1 - DEPOT_SURE):
            votes.append(dep[r] <= 1 - DEPOT_SURE)
        if len(votes) == 2 and votes[0] == votes[1]:
            conf[r] = "подтверждено"
        elif len(votes) == 1:
            conf[r] = "вероятно"
        else:
            conf[r] = "не определено"
        if votes and conf[r] != "не определено" and votes[0]:
            flip.add(r)
    parity = parity.where(~parity.index.get_level_values("route").isin(list(flip)), 1 - parity)
    a.attrs["confidence"] = conf
    p = idx.map(parity).to_numpy()
    a["dir"] = (p + trip) % 2
    a["stop_seq"] = np.where(p == 0, a["s0"], a["s1"]) + 1
    # надёжность: выбор по чётным рейсам вагон-дня против выбора по нечётным
    d = pd.Series(loglik(parity))
    even = d.where(trip % 2 == 0, 0).groupby([a[k] for k in keys]).sum()
    odd = d.where(trip % 2 == 1, 0).groupby([a[k] for k in keys]).sum()
    both = (even.abs() > 1) & (odd.abs() > 1)
    agree = (np.sign(even) == np.sign(odd))[both].groupby(level="route").mean()
    fl = direct.index.isin(list(flip))
    a.attrs["check"] = pd.DataFrame({
        "направление": pd.Series(conf),
        "утро": dep.where(~dep.index.isin(list(flip)), 1 - dep).reindex(direct.index).round(2),
        "пересадок": tr["n"].reindex(direct.index).fillna(0).astype(int),
        "на_общих": tr["direct"].where(~tr.index.isin(list(flip)), tr["mirror"]).reindex(direct.index).round(3),
        "на_общих_в_зеркале": tr["mirror"].where(~tr.index.isin(list(flip)), tr["direct"]).reindex(direct.index).round(3),
        "узлы": direct.where(~fl, mirror).round(3), "узлы_в_зеркале": mirror.where(~fl, direct).round(3),
        "чётные_и_нечётные": agree.round(3)})
    return a


def shares(a: pd.DataFrame, canon, cal) -> pd.DataFrame:
    """Доля остановки в посадках маршрута за час, по типу дня."""
    a = a.assign(day_type=day_type(a["date"], cal))
    n = a.groupby(["route", "day_type", "h", "dir", "stop_seq"]).size().rename("boardings").reset_index()
    tot = n.groupby(["route", "day_type", "h"])["boardings"].transform("sum")
    n["share"] = n["boardings"] / tot
    n["stop_name"] = [re.sub(r'"([^"]*)"', r"«\1»", canon[(r, d)][s - 1]).replace('"', "")
                      for r, d, s in zip(n["route"], n["dir"], n["stop_seq"])]
    n["from_hour"] = n["h"]
    # час без посадок в октябре (ночь выходного) берёт доли ближайшего часа того же типа дня:
    # иначе прогноз маршрута на этот час не разложится по остановкам и потеряется
    fill = []
    for (route, dt), g in n.groupby(["route", "day_type"]):
        have = sorted(g["h"].unique())
        for h in range(24):
            if h not in have:
                near = min(have, key=lambda x: (min(abs(x - h), 24 - abs(x - h)), x))
                fill.append(g[g["h"] == near].assign(h=h, from_hour=near))
    if fill:
        n = pd.concat([n] + fill, ignore_index=True)
    return n.rename(columns={"h": "hour", "dir": "direction"})


def stability(a: pd.DataFrame) -> pd.DataFrame:
    """Совпадение долей остановок между половинами месяца, по маршрутам (корреляция и L1)."""
    rows = []
    half = np.where(a["date"] <= "2025-10-21", 1, 2)
    for route, g in a.groupby("route"):
        x = g.assign(half=half[g.index]).groupby(["half", "dir", "stop_seq"]).size().unstack(["dir", "stop_seq"]).fillna(0)
        x = x.div(x.sum(axis=1), axis=0)
        if len(x) < 2:
            continue
        rows.append(dict(route=route, corr=round(float(np.corrcoef(x.iloc[0], x.iloc[1])[0, 1]), 3),
                         l1=round(float(np.abs(x.iloc[0] - x.iloc[1]).sum()), 3)))
    return pd.DataFrame(rows)


def extract(dataset_zip: str) -> None:
    """Успешные валидации с 11 октября из test.csv архива организаторов: время, маршрут, борт, выход, карта."""
    import csv
    import io
    import zipfile
    VALIDATIONS.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dataset_zip) as z, z.open("test.csv") as raw, open(VALIDATIONS, "w", newline="") as out:
        rows = csv.reader(io.TextIOWrapper(raw, encoding="utf-8", newline=""), delimiter=";")
        head = next(rows)
        col = {n: head.index(n) for n in ("tran_date_time", "validation_result", "ngpt_route", "garage_number", "bus_exit_no", "crd_hashcode")}
        w = csv.writer(out, delimiter=";", lineterminator="\n")
        for r in rows:
            if r[col["validation_result"]] != "1" or r[col["tran_date_time"]] < "2025-10-11":
                continue
            w.writerow([r[col["tran_date_time"]], r[col["ngpt_route"]].split(" ")[0], r[col["garage_number"]].strip(),
                        r[col["bus_exit_no"]].strip(), r[col["crd_hashcode"]]])


def load_validations() -> pd.DataFrame:
    v = pd.read_csv(VALIDATIONS, sep=";", names=["t", "route", "garage", "exit", "card"], dtype={"garage": str, "exit": str})
    v["t"] = pd.to_datetime(v["t"])
    v["date"] = v["t"].dt.strftime("%Y-%m-%d")
    # ночь до трёх часов — хвост предыдущих суток
    late = v["t"].dt.hour < 3
    v.loc[late, "date"] = (v.loc[late, "t"] - pd.Timedelta(days=1)).dt.strftime("%Y-%m-%d")
    v["m"] = (v["t"] - pd.to_datetime(v["date"])).dt.total_seconds() / 60
    v = v[(v["date"] >= FIRST) & (v["date"] <= LAST)]
    return v.sort_values(["route", "date", "garage", "m"]).reset_index(drop=True)


def window_day_types(cal) -> pd.DataFrame:
    days = pd.date_range(FORECAST_START, FORECAST_END)
    return pd.DataFrame({"date": days.strftime("%Y-%m-%d"), "day_type": day_type(pd.Series(days), cal)})


def build():
    cal = calendar.load()
    st = pd.read_csv(SCHEDULE)
    st = st[(st["date"] >= FIRST) & (st["date"] <= LAST)]
    canon, trips = schedule_trips(st)
    prof = run_profiles(canon, trips)
    deps = departures(trips)
    a = resolve(assign(load_validations(), canon, prof, deps), canon, deps)
    sh = shares(a, canon, cal)
    conf = a.attrs["confidence"]
    sh["confidence"] = sh["route"].map(conf)
    sh = sh[sh["confidence"] != "не определено"]
    OUT.mkdir(parents=True, exist_ok=True)
    cols = ["route", "day_type", "hour", "direction", "stop_seq", "stop_name", "share", "boardings", "confidence", "from_hour"]
    sh[cols].sort_values(cols[:5]).to_csv(OUT / "stop_shares.csv", sep=";", index=False)
    days = window_day_types(cal)
    days.to_csv(OUT / "day_types.csv", sep=";", index=False)
    web(sh, canon, conf, days)
    return a, sh, canon


def web(sh: pd.DataFrame, canon, conf, days: pd.DataFrame) -> None:
    """Доли для экрана: маршрут → имена остановок двух направлений и доли [час][направление][остановка]."""
    out = {"routes": {}, "days": dict(zip(days["date"], days["day_type"]))}
    for route in sorted(sh["route"].unique()):
        g = sh[sh["route"] == route]
        names = [[re.sub(r'"([^"]*)"', r"«\1»", n).replace('"', "") for n in canon[(route, d)]] for d in (0, 1)]
        table = {}
        for dt in ("weekday", "weekend"):
            m = [[[0.0] * len(names[d]) for d in (0, 1)] for _ in range(24)]
            for r in g[g["day_type"] == dt].itertuples():
                m[r.hour][r.direction][r.stop_seq - 1] = round(float(r.share), 5)
            table[dt] = m
        out["routes"][str(route)] = {"confidence": conf[route], "names": names, "shares": table}
    WEB.parent.mkdir(parents=True, exist_ok=True)
    WEB.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    import sys
    pd.set_option("display.width", 200)
    if len(sys.argv) > 1:
        extract(sys.argv[1])
    a, sh, canon = build()
    trips = a.groupby(["route", "date", "garage", "trip"]).size()
    print(f"валидаций {len(a):,}, вагон-дней {a.groupby(['route', 'date', 'garage']).ngroups:,}, рейсов {len(trips):,}")
    print("\nНаправление рейсов: доля посадок на пересадках при выбранном решении и в зеркале, согласие\n"
          "выбора по чётным и нечётным рейсам вагон-дня:\n", a.attrs["check"].to_string())
    print("\nУстойчивость долей между половинами месяца:\n", stability(a).to_string(index=False))
    for route in sorted(sh["route"].unique()):
        top = sh[sh["route"] == route].groupby("stop_name")["boardings"].sum().sort_values(ascending=False)
        print(f"\n{route}: {', '.join(f'{n} {v / top.sum():.0%}' for n, v in top.head(5).items())}")
