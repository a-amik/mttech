"""Почасовая погода в центре Москвы из архива Open-Meteo (ERA5), без ключа."""
import pandas as pd
import requests

from .config import EXTERNAL

URL = ("https://archive-api.open-meteo.com/v1/archive?latitude=55.75&longitude=37.62"
       "&start_date={start}&end_date={end}&timezone=Europe%2FMoscow"
       "&hourly=temperature_2m,apparent_temperature,precipitation,rain,snowfall,snow_depth,cloud_cover,wind_speed_10m")


def load(start: str = "2025-01-01", end: str = "2025-12-31") -> pd.DataFrame:
    path = EXTERNAL / f"open_meteo_{start}_{end}.csv"
    if not path.exists():
        data = requests.get(URL.format(start=start, end=end), timeout=60).json()["hourly"]
        df = pd.DataFrame(data)
        EXTERNAL.mkdir(parents=True, exist_ok=True)
        df.to_csv(path, index=False)
    df = pd.read_csv(path, parse_dates=["time"])
    df["date"] = df["time"].dt.normalize()
    df["hour"] = df["time"].dt.hour
    return df.drop(columns="time")
