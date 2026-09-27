import pandas as pd

from .config import RAW, ROUTES


def load_labels() -> pd.DataFrame:
    parts = [pd.read_csv(RAW / "labels" / f"labels_day_{s}.csv", sep=";", parse_dates=["date"])
             for s in ("train", "test")]
    return pd.concat(parts, ignore_index=True)


def full_grid(start: str, end: str, routes=ROUTES) -> pd.DataFrame:
    idx = pd.MultiIndex.from_product(
        [routes, pd.date_range(start, end), range(24)], names=["route", "date", "hour"])
    return idx.to_frame(index=False)


def history(start: str, end: str) -> pd.DataFrame:
    """Полная сетка «маршрут × дата × час» с нулями там, где валидаций не было."""
    grid = full_grid(start, end)
    out = grid.merge(load_labels(), how="left", on=["route", "date", "hour"])
    out["boardings"] = out["boardings"].fillna(0)
    return out
