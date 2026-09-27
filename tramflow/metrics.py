import numpy as np


def wape_score(y, y_hat) -> float:
    y, y_hat = np.asarray(y, float), np.asarray(y_hat, float)
    if y.sum() == 0:
        # пустой срез: верен только нулевой прогноз
        return 1.0 if not np.abs(y_hat).sum() else 0.0
    return max(0.0, 1 - np.abs(y - y_hat).sum() / y.sum())
