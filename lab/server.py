"""Лаборатория: попытки, ряды посадок и проверка модели. Запуск: .venv/bin/python -m lab.server"""
import json
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pandas as pd

from tramflow import backtest
from tramflow.config import SUBMISSIONS
from tramflow.versions import BASE
from tramflow.data import history
from tramflow.metrics import wape_score

HERE = Path(__file__).parent
LOG = SUBMISSIONS / "log.json"
PORT = 8765


def read_log():
    return json.loads(LOG.read_text()) if LOG.exists() else []


@lru_cache(maxsize=1)
def hist():
    return history("2025-01-01", "2025-10-31")


@lru_cache(maxsize=32)
def forecast(name: str) -> pd.DataFrame:
    return pd.read_csv(SUBMISSIONS / f"{name}.csv", sep=";", parse_dates=["date"])


def daily(frame, col):
    d = frame.groupby(["route", "date"])[col].sum().reset_index()
    out = {"all": d.groupby("date")[col].sum()}
    for r, g in d.groupby("route"):
        out[str(r)] = g.set_index("date")[col]
    return {k: [[t.strftime("%Y-%m-%d"), round(float(v))] for t, v in s.items()] for k, s in out.items()}


@lru_cache(maxsize=1)
def check():
    d = backtest.detail(**{**BASE, "level": 1.0})
    routes = {str(r): round(wape_score(g["boardings"], g["prediction"]), 4) for r, g in d.groupby("route") if g["boardings"].sum() > 0}
    by_day = d.groupby("date")[["boardings", "prediction"]].sum()
    return {
        "total": round(wape_score(d["boardings"], d["prediction"]), 4),
        "routes": routes,
        "daily": [[t.strftime("%Y-%m-%d"), int(r.boardings), int(r.prediction)] for t, r in by_day.iterrows()],
        "hourly": d.groupby("hour")[["boardings", "prediction"]].mean().round(1).values.tolist(),
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    def log_message(self, *a):
        pass

    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/api/attempts":
            return self.send_json(read_log())
        if url.path == "/api/series":
            out = {"history": daily(hist(), "boardings"), "forecasts": {}}
            for a in read_log():
                if (SUBMISSIONS / f"{a['name']}.csv").exists():
                    out["forecasts"][a["name"]] = daily(forecast(a["name"]), "prediction")
            return self.send_json(out)
        if url.path == "/api/hourly":
            date, route = pd.Timestamp(q["date"]), q.get("route", "all")
            src = hist() if date <= pd.Timestamp("2025-10-31") else forecast(q["version"])
            col = "boardings" if "boardings" in src else "prediction"
            s = src[src["date"] == date]
            if route != "all":
                s = s[s["route"] == int(route)]
            return self.send_json(s.groupby("hour")[col].sum().reindex(range(24), fill_value=0).astype(int).tolist())
        if url.path.startswith("/files/"):
            path = SUBMISSIONS / Path(url.path).name
            if path.suffix == ".csv" and path.exists():
                body = path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                return self.wfile.write(body)
        if url.path == "/api/check":
            return self.send_json(check())
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path == "/api/score":
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            log = read_log()
            for a in log:
                if a["name"] == body["name"]:
                    a["score"] = body.get("score")
                    a["comment"] = body.get("comment", "")
            LOG.write_text(json.dumps(log, ensure_ascii=False, indent=1))
            return self.send_json({"ok": True})
        self.send_json({"error": "not found"}, 404)


if __name__ == "__main__":
    print(f"http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
