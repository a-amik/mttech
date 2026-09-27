"""Производственный календарь РФ с isdayoff.ru: 0 — рабочий, 1 — выходной, 2 — сокращённый."""
import pandas as pd
import requests

from .config import EXTERNAL

URL = "https://isdayoff.ru/api/getdata?year={year}&pre=1&cc=ru"


def load(year: int = 2025) -> pd.DataFrame:
    path = EXTERNAL / f"isdayoff_{year}.csv"
    if not path.exists():
        codes = requests.get(URL.format(year=year), timeout=30).text.strip()
        days = pd.date_range(f"{year}-01-01", f"{year}-12-31")
        EXTERNAL.mkdir(parents=True, exist_ok=True)
        pd.DataFrame({"date": days, "code": [int(c) for c in codes]}).to_csv(path, index=False)
    cal = pd.read_csv(path, parse_dates=["date"])
    dow = cal["date"].dt.dayofweek
    cal["day_off"] = cal["code"] == 1
    cal["short"] = cal["code"] == 2
    cal["holiday_weekday"] = cal["day_off"] & (dow < 5)
    cal["working_weekend"] = ~cal["day_off"] & (dow >= 5)
    cal["bridge"] = _bridge(cal, dow)
    return cal


def _bridge(cal: pd.DataFrame, dow: pd.Series) -> pd.Series:
    """Рабочий будний день между праздниками не дальше трёх дней с каждой стороны, как 5—7 мая.
    Часть людей берёт отпуск, и такие дни тише обычных. Будни перед длинными выходными
    (28—29 апреля, 9—10 июня) идут как обычные, поэтому праздник нужен с обеих сторон."""
    off = cal["day_off"].values
    hol = cal["holiday_weekday"].values
    work = ~off & ~cal["short"].values & (dow.values < 5)
    n = len(cal)

    def holiday_block(i, step):
        # пройти не больше трёх рабочих дней до ближайшего блока выходных и проверить, есть ли в нём праздник
        j, gap = i + step, 0
        while 0 <= j < n and not off[j]:
            gap += 1
            j += step
            if gap > 3:
                return False
        found = False
        while 0 <= j < n and off[j]:
            found |= bool(hol[j])
            j += step
        return found

    out = [bool(work[i]) and holiday_block(i, -1) and holiday_block(i, 1) for i in range(n)]
    return pd.Series(out, index=cal.index)
