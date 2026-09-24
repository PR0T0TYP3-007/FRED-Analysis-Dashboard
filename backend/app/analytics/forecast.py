"""Short-horizon projections, with the backtest that justifies showing them.

A forecast line on a dashboard is only honest if the reader can see how the
model has done historically. For every forecast series we therefore run a
walk-forward backtest against a seasonal-naive baseline and store MAPE, RMSE
and the resulting skill score alongside the projection. The UI shows the skill
number next to the chart; where skill is negative, the model is beaten by the
naive baseline and the frontend labels it as such rather than hiding it.

Model: Holt's linear exponential smoothing (damped), which suits the smooth,
trending, already-seasonally-adjusted monthly series in this panel.
"""

from __future__ import annotations

import logging
import warnings

import numpy as np
import pandas as pd

from statsmodels.tsa.holtwinters import ExponentialSmoothing

log = logging.getLogger(__name__)

HORIZON = 12
MIN_TRAIN = 60
BACKTEST_FOLDS = 8
BACKTEST_HORIZON = 6


def _fit(train: pd.Series):
    """Fit Holt's damped-trend model.

    statsmodels is handed the bare values rather than the dated Series: the
    backtest slices the history, which drops the index frequency and makes the
    library warn about an unusable index. We build the forecast index ourselves
    anyway, so the dates are never needed here.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = ExponentialSmoothing(
            np.asarray(train, dtype="float64"),
            trend="add",
            damped_trend=True,
            seasonal=None,
            initialization_method="estimated",
        )
        return model.fit(optimized=True)


def _mape(actual: np.ndarray, predicted: np.ndarray) -> float:
    mask = np.abs(actual) > 1e-9
    if not mask.any():
        return float("nan")
    return float(np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])) * 100.0)


def backtest(series: pd.Series, folds: int = BACKTEST_FOLDS) -> dict:
    """Expanding-window walk-forward evaluation against a seasonal-naive baseline."""
    errors: list[np.ndarray] = []
    naive_errors: list[np.ndarray] = []
    actuals: list[np.ndarray] = []

    total = len(series)
    for fold in range(folds, 0, -1):
        cut = total - fold * BACKTEST_HORIZON
        if cut < MIN_TRAIN:
            continue
        train = series.iloc[:cut]
        test = series.iloc[cut : cut + BACKTEST_HORIZON]
        if len(test) < BACKTEST_HORIZON:
            continue
        try:
            fitted = _fit(train)
            prediction = np.asarray(fitted.forecast(len(test)), dtype="float64")
        except Exception as exc:  # noqa: BLE001 - a failed fold must not kill the study
            log.debug("backtest fold failed: %s", exc)
            continue
        # Baseline: last observed value carried forward (random walk).
        naive = np.repeat(float(train.iloc[-1]), len(test))
        actual = test.to_numpy(dtype="float64")

        errors.append(actual - prediction)
        naive_errors.append(actual - naive)
        actuals.append(actual)

    if not errors:
        return {"mape": None, "rmse": None, "naive_mape": None, "skill": None, "folds": 0}

    err = np.concatenate(errors)
    naive_err = np.concatenate(naive_errors)
    act = np.concatenate(actuals)

    mape = _mape(act, act - err)
    naive_mape = _mape(act, act - naive_err)
    rmse = float(np.sqrt(np.mean(err**2)))
    skill = (
        None
        if not naive_mape or np.isnan(naive_mape) or np.isnan(mape)
        else float(1.0 - mape / naive_mape)
    )
    return {
        "mape": None if np.isnan(mape) else mape,
        "rmse": rmse,
        "naive_mape": None if np.isnan(naive_mape) else naive_mape,
        "skill": skill,
        "folds": len(errors),
    }


def forecast_series(series: pd.Series, horizon: int = HORIZON) -> tuple[pd.DataFrame, dict]:
    """Fit on the full history and project `horizon` periods with an 80% band.

    Returns the projection frame and the metadata row (model, errors, skill).
    """
    clean = series.dropna()
    monthly = clean.resample("MS").last().dropna()
    if len(monthly) < MIN_TRAIN:
        return pd.DataFrame(), {}

    stats = backtest(monthly)
    try:
        fitted = _fit(monthly)
        point = np.asarray(fitted.forecast(horizon), dtype="float64")
    except Exception as exc:  # noqa: BLE001
        log.warning("forecast fit failed: %s", exc)
        return pd.DataFrame(), {}

    # Interval from in-sample residual spread, widened with the square root of
    # the horizon -- the standard random-walk error growth assumption.
    residual_sd = float(np.nanstd(np.asarray(fitted.resid, dtype="float64")))
    steps = np.arange(1, horizon + 1, dtype="float64")
    band = 1.2816 * residual_sd * np.sqrt(steps)  # 80% two-sided

    index = pd.date_range(
        monthly.index[-1] + pd.offsets.MonthBegin(1), periods=horizon, freq="MS"
    )
    frame = pd.DataFrame(
        {"yhat": point, "lower": point - band, "upper": point + band}, index=index
    )

    meta = {
        "model": "Holt damped-trend exponential smoothing",
        "horizon": horizon,
        "mape": stats["mape"],
        "rmse": stats["rmse"],
        "naive_mape": stats["naive_mape"],
        "skill": stats["skill"],
        "train_start": monthly.index[0].date(),
        "train_end": monthly.index[-1].date(),
    }
    return frame, meta
