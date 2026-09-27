from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
EXTERNAL = DATA / "external"
SUBMISSIONS = ROOT / "artifacts" / "submissions"

ROUTES = [1, 5, 7, 11, 12, 17, 25, 26, 28, 50]
HISTORY_START, HISTORY_END = "2025-01-01", "2025-10-31"
FORECAST_START, FORECAST_END = "2025-11-01", "2025-12-31"

# Маршрут 5 в эталоне появляется с даты версии в справочнике.
ROUTE_START = {5: "2025-12-16"}
