"""Проверка: связана ли загруженность коридора с формой часа посадок.

Форма часа маршрута сравнивается с сетевой: доля часа в дневной сумме
у маршрута делится на ту же долю по всей сети. Загруженность коридора
(индекс 2ГИС) так же нормируется на сетевую. Если коридоры, стоящие сильнее
среднего в этот час, собирают больше или меньше посадок, чем сеть в среднем,
между двумя отклонениями есть корреляция. Считается по маршрутам с историей,
отдельно для будня, субботы и воскресенья.

    python -m tramflow.traffic_effect
"""
import numpy as np
import pandas as pd

from . import calendar, model
from .config import EXTERNAL
from .data import history

DAY_OF = {"workday": [0, 1, 2, 3, 4], "saturday": [5], "sunday": [6]}


def hourly_share(start="2025-09-08", end="2025-10-31") -> pd.DataFrame:
    cal = calendar.load()
    days = model.clean_days(history("2025-01-01", end), cal, start, end)
    rows = []
    for day, dows in DAY_OF.items():
        d = days[days["dow"].isin(dows)]
        s = d.groupby(["route", "hour"])["boardings"].mean().reset_index()
        s["share"] = s["boardings"] / s.groupby("route")["boardings"].transform("sum")
        net = d.groupby("hour")["boardings"].sum()
        s["share_net"] = s["hour"].map(net / net.sum())
        s["day"] = day
        rows.append(s)
    return pd.concat(rows)


def main() -> None:
    cong = pd.read_csv(EXTERNAL / "2gis_congestion.csv")
    cong["cong_net"] = cong.groupby(["day", "hour"])["congestion"].transform("mean")
    df = hourly_share().merge(cong, on=["route", "day", "hour"])
    df = df[(df["share"] > 0) & (df["share_net"] > 0)]
    df["share_dev"] = np.log(df["share"] / df["share_net"])
    df["cong_dev"] = np.log(df["congestion"] / df["cong_net"])
    print("Отклонение формы часа маршрута от сетевой против отклонения загруженности коридора\n")
    for day, g in df.groupby("day"):
        r = g["share_dev"].corr(g["cong_dev"])
        rs = g["share_dev"].corr(g["cong_dev"], method="spearman")
        print(f"{day:9s} ячеек {len(g):3d}  Пирсон {r:+.3f}  Спирмен {rs:+.3f}")
    peak = df[(df["day"] == "workday") & df["hour"].isin([7, 8, 9, 17, 18, 19])]
    print(f"\nчасы пик будня: ячеек {len(peak)}, Пирсон {peak['share_dev'].corr(peak['cong_dev']):+.3f}")
    print("\nСетевой профиль будня: доля посадок и индекс загруженности по часам")
    net = df[df["day"] == "workday"].groupby("hour").agg(share=("share_net", "first"), cong=("cong_net", "first"))
    print((net.assign(share=net["share"] * 100).round(2)).T.to_string())
    print(f"\nкорреляция сетевых профилей по часам: {net['share'].corr(net['cong']):+.3f}")


if __name__ == "__main__":
    main()
