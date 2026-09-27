"""Остановочные пункты Москвы (портал открытых данных, набор 752) — для трасс,
которых нет в справочнике организаторов. Ключ берётся из MOS_API_KEY или .env.

Запуск: .venv/bin/python web/scripts/fetch_mos_stops.py
Пишет data/external/mos_busstops_752.json.
"""
import json
import os
import ssl
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "external" / "mos_busstops_752.json"
URL = "https://apidata.mos.ru/v1/datasets/752/rows"


def api_key() -> str:
    if os.environ.get("MOS_API_KEY"):
        return os.environ["MOS_API_KEY"]
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("MOS_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("нет MOS_API_KEY")


def main():
    # Сертификат портала выдан российским УЦ, которого нет в системном хранилище.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    key = api_key()
    rows, skip = [], 0
    while True:
        url = f"{URL}?$top=1000&$skip={skip}&api_key={key}"
        part = json.loads(urllib.request.urlopen(url, context=ctx, timeout=120).read())
        if not part:
            break
        for r in part:
            c = r["Cells"]
            if "Тм" in (c.get("RouteNumbers") or ""):
                rows.append({k: c.get(k) for k in ("ID", "StationName", "Direction", "RouteNumbers", "Latitude_WGS84", "Longitude_WGS84", "EntryState")})
        skip += len(part)
        print(skip, len(rows))
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=0))
    print("трамвайных остановок:", len(rows))


if __name__ == "__main__":
    main()
