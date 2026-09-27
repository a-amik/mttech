"""Сводка прогона run.sh: таблицы из итогов k6, docker stats и ответов приёма."""
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

run = Path(sys.argv[1])
out = []


def load(name):
    p = run / name
    return json.loads(p.read_text()) if p.exists() and p.stat().st_size else None


def ms(v):
    return f"{v:.0f}" if v >= 10 else f"{v:.1f}"


def pct(v):
    return f"{v * 100:.2f} %"


def metric(summary, name):
    return summary["metrics"].get(name, {})


def mem_mib(text):
    m = re.match(r"([\d.]+)\s*([KMG]i?B)", text)
    if not m:
        return 0.0
    return float(m.group(1)) * {"KiB": 1 / 1024, "MiB": 1, "GiB": 1024, "kB": 1 / 1000, "MB": 1, "GB": 1000}.get(m.group(2), 1)


def stats(name):
    p = run / name
    if not p.exists():
        return
    cpu, mem = defaultdict(list), defaultdict(list)
    with p.open() as f:
        for row in csv.DictReader(f, delimiter=";"):
            cpu[row["name"]].append(float(row["cpu"].rstrip("%") or 0))
            mem[row["name"]].append(mem_mib(row["mem"]))
    out.append(f"\nРесурсы ({name}), процессор в % одного ядра, лимит 200 %:\n")
    out.append("| Контейнер | Процессор, среднее | Процессор, пик | Память, пик |")
    out.append("|---|---|---|---|")
    for n in sorted(cpu):
        busy = [c for c in cpu[n] if c > 1] or [0]
        out.append(f"| {n} | {sum(busy) / len(busy):.0f} % | {max(cpu[n]):.0f} % | {max(mem[n]):.0f} МиБ |")


steps = load("steps.json")
if steps:
    out.append("| Ступень, запросов/с | Отвечено, запросов/с | Медиана, мс | p95, мс | p99, мс | Ошибок |")
    out.append("|---|---|---|---|---|---|")
    for key in sorted((k for k in steps["metrics"] if k.startswith("http_req_duration{scenario:")),
                      key=lambda k: int(re.search(r"rps(\d+)", k).group(1))):
        rps = int(re.search(r"rps(\d+)", key).group(1))
        d = steps["metrics"][key]
        reqs = metric(steps, f"http_reqs{{scenario:rps{rps}}}")
        failed = metric(steps, f"http_req_failed{{scenario:rps{rps}}}")
        hold = float(__import__('os').environ.get('HOLD', 40))
        out.append(f"| {rps} | {reqs.get('count', 0) / hold:.0f} | {ms(d['med'])} | {ms(d['p(95)'])} | "
                   f"{ms(d['p(99)'])} | {pct(failed.get('value', 0))} |")
    stats("stats.csv")

ingest = load("ingest.json")
steady = load("steady.json")
if steady:
    d, f, r = metric(steady, "http_req_duration"), metric(steady, "http_req_failed"), metric(steady, "http_reqs")
    out.append(f"\nЭкран диспетчеров: {r.get('count', 0)} запросов, {r.get('rate', 0):.0f} в секунду, "
               f"медиана {ms(d['med'])} мс, p95 {ms(d['p(95)'])} мс, p99 {ms(d['p(99)'])} мс, "
               f"ошибок {pct(f.get('value', 0))} ({f.get('passes', 0)} шт.)")
if ingest:
    out.append(f"\nПриём: строк {ingest['rows']:,}, посадок {ingest['accepted']:,}, не посадок {ingest['refused']:,}, "
               f"битых {ingest['rejected']}, вне прогноза {ingest.get('foreign', 0)}, за {ingest['seconds']} с — {ingest['rowsPerSecond']:,} строк в секунду"
               .replace(",", " "))
events = run / "events.txt"
if events.exists():
    out.append("\nСобытия: " + "; ".join(l.split(";")[1] for l in events.read_text().splitlines()))
if steady:
    stats("stats.csv")

cases = [("unprotected", "Без защиты"), ("distributed", "Атака с тысяч адресов: лимит bcrypt"),
         ("single-ip", "Атака с одного адреса: блокировка адреса")]
if load("unprotected-dispatchers.json") or load("single-ip-dispatchers.json"):
    out.append("| Случай | Диспетчеры: медиана / p95, мс | Ошибок у диспетчеров | Атака: запросов | 401 | 429 |")
    out.append("|---|---|---|---|---|---|")
    for key, title in cases:
        disp, flood = load(f"{key}-dispatchers.json"), load(f"{key}-flood.json")
        if not disp:
            continue
        d, f = metric(disp, "http_req_duration"), metric(disp, "http_req_failed")
        fl = flood["metrics"] if flood else {}
        out.append(f"| {title} | {ms(d['med'])} / {ms(d['p(95)'])} | {pct(f.get('value', 0))} | "
                   f"{fl.get('http_reqs', {}).get('count', 0)} | {fl.get('flood_401', {}).get('count', 0)} | "
                   f"{fl.get('flood_429', {}).get('count', 0)} |")
    for key, _ in cases:
        stats(f"{key}-stats.csv")

for rate in ("600", "6000"):
    g = load(f"glonass-{rate}.json")
    if not g:
        continue
    inj, srv, scr = g["injected"], g["server"], g["screen"]
    out.append(f"\nГЛОНАСС, {g['vehicles']} вагонов на {g['routes']} маршрутах, отметка раз в {g['period_s']} с: "
               f"{g['points']} отметок, {g['points_per_second']} в секунду, пачка отвечена за "
               f"{g['post_ms']['med']} мс (p95 {g['post_ms']['p95']}), опоздавших тактов {g['late_ticks']}")
    out.append(f"На экране: вагонов {scr['vehicles']}, на связи {scr['online']}, без связи {scr['stale']} "
               f"(ожидалось {scr['stale_expected']}), давность отметки p95 {scr['age_p95_s']} с\n")
    out.append("| Сбой | Подмешано | Сервис отбросил |")
    out.append("|---|---|---|")
    for k, title in (("outside", "Нули вместо координат"), ("jump", "Скачок на 3 км"), ("future", "Время из будущего"),
                     ("duplicate", "Повтор отметки"), ("old", "Опоздавшая отметка")):
        out.append(f"| {title} | {inj.get(k, 0)} | {srv.get(k, 0)} |")

streams = [(r, load(f"stream-{r}.json")) for r in ("1", "10", "100", "1000")]
if any(x for _, x in streams):
    out.append("\n| Темп потока | Минут суток прошло | Строк | Строк в секунду | Пачка, мс: медиана / p95 | Отставание экрана, с: медиана / p95 |")
    out.append("|---|---|---|---|---|---|")
    for r, x in streams:
        if x:
            out.append(f"| ×{r} | {x['stream_minutes']:.0f} | {x['rows']} | {x['rows_per_second']} | "
                       f"{x['post_ms']['med']} / {x['post_ms']['p95']} | {x['lag_wall_s']['med']} / {x['lag_wall_s']['p95']} |")

chunks = sorted(run.glob("soak-[0-9][0-9].json"))
if chunks:
    out.append("\n| Полчаса | Запросов | Медиана, мс | p95, мс | p99, мс | Ошибок |")
    out.append("|---|---|---|---|---|---|")
    for c in chunks:
        x = json.loads(c.read_text())
        d, f, r = metric(x, "http_req_duration"), metric(x, "http_req_failed"), metric(x, "http_reqs")
        out.append(f"| {c.stem[5:]} | {r.get('count', 0)} | {ms(d['med'])} | {ms(d['p(95)'])} | {ms(d['p(99)'])} | {pct(f.get('value', 0))} |")
    p = run / "stats.csv"
    if p.exists():
        rows = list(csv.DictReader(p.open(), delimiter=";"))
        if rows:
            t0 = int(rows[0]["time"])
            hours = defaultdict(list)
            for row in rows:
                hours[(int(row["time"]) - t0) // 3600].append(mem_mib(row["mem"]))
            out.append("\nПамять по часам, МиБ (среднее / пик): " + "; ".join(
                f"{h + 1}-й {sum(v) / len(v):.0f} / {max(v):.0f}" for h, v in sorted(hours.items())))
    for name in ("soak-glonass.json", "soak-stream.json"):
        x = load(name)
        if x:
            out.append(f"\n{name}: " + json.dumps(x, ensure_ascii=False))

for name in ("stops.md",):
    if (run / name).exists():
        out.append("\n" + (run / name).read_text())

abuse = run / "abuse.md"
if abuse.exists():
    out.append("\n" + abuse.read_text())

gaps = run / "gaps.md"
if gaps.exists():
    out.append(gaps.read_text())

print("\n".join(out))
