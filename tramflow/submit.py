"""Сборка и проверка submission.csv: route;date;hour;prediction, полная сетка 14 640 строк.

    python -m tramflow.submit v06_base2            # версия из реестра
    python -m tramflow.submit --all                 # все версии реестра
"""
import argparse
import json
from datetime import date

import pandas as pd

from . import backtest, calendar
from .config import FORECAST_END, FORECAST_START, HISTORY_END, RAW, SUBMISSIONS
from .data import history
from .versions import BASE, VERSIONS


def check(df: pd.DataFrame) -> None:
    ref = pd.read_csv(RAW / "test_submission.csv", sep=";")
    assert list(df.columns) == ["route", "date", "hour", "prediction"], df.columns
    assert len(df) == len(ref) == 14640, len(df)
    keys = ["route", "date", "hour"]
    assert df[keys].astype(str).equals(ref[keys].astype(str)), "ключи не совпадают с образцом"
    assert df["prediction"].notna().all() and (df["prediction"] >= 0).all()


def build(version: dict) -> pd.DataFrame:
    cal = calendar.load()
    hist = history("2025-01-01", HISTORY_END)
    params = {**BASE, **{k: v for k, v in version.items() if k in BASE}}
    pred = backtest.build(hist, cal, HISTORY_END, FORECAST_START, FORECAST_END,
                          adjustments=version.get("adjustments", ()), **params)
    pred["date"] = pred["date"].dt.strftime("%Y-%m-%d")
    pred["prediction"] = pred["prediction"].round().astype(int)
    ref = pd.read_csv(RAW / "test_submission.csv", sep=";")[["route", "date", "hour"]]
    return ref.merge(pred[["route", "date", "hour", "prediction"]], on=["route", "date", "hour"], how="left")


def register(name: str, note: str, bt: dict) -> None:
    log_path = SUBMISSIONS / "log.json"
    log = json.loads(log_path.read_text()) if log_path.exists() else []
    old = next((a for a in log if a["name"] == name), None)
    entry = {"name": name, "note": note, "backtest": bt, "score": old and old.get("score"),
             "comment": old and old.get("comment"), "created": date.today().isoformat()}
    log = [a for a in log if a["name"] != name] + [entry]
    log_path.write_text(json.dumps(log, ensure_ascii=False, indent=1))


def make(key: str, prefix: str) -> None:
    version = VERSIONS[key]
    name = f"{prefix}_{key}"
    df = build(version)
    check(df)
    SUBMISSIONS.mkdir(parents=True, exist_ok=True)
    df.to_csv(SUBMISSIONS / f"{name}.csv", sep=";", index=False)
    params = {k: v for k, v in version.items() if k in BASE}
    bt = backtest.summary(**{**BASE, **params, "level": 1.0})
    register(name, version["note"], bt)
    print(name, len(df), int(df["prediction"].sum()), bt)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("version", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--prefix", default=date.today().isoformat())
    a = ap.parse_args()
    for key in (VERSIONS if a.all else [a.version]):
        make(key, a.prefix)
