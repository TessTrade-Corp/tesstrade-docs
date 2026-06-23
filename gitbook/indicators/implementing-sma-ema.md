# Implementing SMA and EMA

Moving averages are the foundation of a large portion of strategies. There
are two ways to get them, and they answer two different questions:

1. **"I just want the value the chart shows."** Import
   [`tesstrade_indicators`](tesstrade-indicators.md) and call `ti.sma`,
   `ti.ema` or `ti.wma`. These are the **parity-true, chart-identical**
   path: they call the same `tesstrade_core` kernels the live chart renders
   with, so what you compute equals what the chart draws — no drift, no
   "right in backtest, wrong on the chart". And for per-bar strategies the
   `ti.Sma` / `ti.Ema` / `ti.Wma` streaming classes keep state, so each
   update is **O(1)** instead of recomputing the whole series.
2. **"I need to read, modify, or extend the math"** — or I need a moving
   average that *isn't* in the catalogue (HMA below, and everything in
   [RSI, MACD and Bollinger Bands](rsi-macd-bands.md)). Then the
   hand-rolled reference implementations on this page are exactly what you
   want. They are exact, sandbox-safe, and meant to be read and changed.

> **Parity-true alternative.** If you only need the moving-average value,
> reach for [`tesstrade_indicators`](tesstrade-indicators.md) first:
> `import tesstrade_indicators as ti; ti.ema(closes, 20)` returns the same
> series the chart draws (and `ti.Ema(20).update(price)` is O(1) per bar).
> `ti.ema` matches `pandas_ta.ema` to floating-point precision — that is,
> the **strict, SMA-seeded** EMA described below, *not* the relaxed
> first-value seed. The hand-rolled versions on this page remain the right
> reference whenever you need to inspect or modify the math, or for moving
> averages outside the six-function catalogue.

For the canonical file layout — **colors → params → declaration → math →
dispatcher**, with `type:"color"` inputs correctly wired into plot colors —
see [Anatomy of a custom indicator](anatomy.md). Everything below is the
math you drop into that structure.

## SMA -- Simple moving average

The arithmetic mean of the last `period` closes.

> Want the chart's SMA in one line? `ti.sma(closes, period)` returns a
> list the same length as `closes`, `None` during warm-up — identical to
> the line the chart renders. The reference below is for when you want to
> own or tweak the math.

### "Full series" version (for plots)

```python
def sma_series(values, period):
    """Returns a list the same length as values; None during warmup."""
    out = []
    running_sum = 0.0
    for i, v in enumerate(values):
        running_sum += v
        if i + 1 < period:
            out.append(None)
            continue
        if i + 1 > period:
            running_sum -= values[i - period]
        out.append(running_sum / period)
    return out
```

**Complexity:** O(n). The naive version with `sum(values[i-p+1:i+1])` is O(n * p) and should be avoided on long series. The `running_sum` trick keeps it at O(n).

### "Last point" version (for on_bar_strategy)

```python
def sma_last(values, period):
    if len(values) < period:
        return None
    return sum(values[-period:]) / period
```

Performance is irrelevant here: typical `period` is less than 100 and `sum()` is trivial. (For a hot per-bar loop, `ti.Sma(period)` keeps a running window in O(1) and gives the chart-identical value.)

### Usage

```python
closes = [c["close"] for c in sdk.candles]
sma20 = sma_last(closes, 20)
if sma20 is None:
    return  # warmup

if sdk.candles[-1]["close"] > sma20:
    # price above the moving average
    ...
```

## EMA -- Exponential moving average

Weights exponentially: recent points carry more weight. Classic formula:

```
alpha = 2 / (period + 1)
ema[i] = alpha * values[i] + (1 - alpha) * ema[i-1]
ema[0] = values[0]   # seed: first value becomes the initial point
```

> The chart's EMA is `ti.ema(closes, period)`, which matches
> `pandas_ta.ema` — i.e. the **strict, SMA-seeded** variant
> (`ema_series_strict` below). The relaxed first-value seed
> (`ema_series`) is a fine, simpler approximation for learning and quick
> backtests, but it is **not** what the chart draws.

### "Full series" version

```python
def ema_series(values, period):
    """EMA aligned by candle. First point is the seed (=values[0])."""
    if not values:
        return []
    alpha = 2.0 / (period + 1.0)
    out = [float(values[0])]
    for v in values[1:]:
        out.append(alpha * v + (1.0 - alpha) * out[-1])
    return out
```

**Note on warmup:** unlike SMA, this relaxed EMA does not return `None`. It uses the first value itself as the seed. The first `period` points are less precise because the exponential weighting is still settling, but they are valid values.

If you want to match the chart, enforce strict warmup: return `None` for the first `period - 1` points and seed from the SMA of the first `period` values:

```python
def ema_series_strict(values, period):
    if len(values) < period:
        return [None] * len(values)
    alpha = 2.0 / (period + 1.0)
    # Seed = SMA of the first `period` values
    seed = sum(values[:period]) / period
    out = [None] * (period - 1) + [seed]
    for v in values[period:]:
        out.append(alpha * v + (1.0 - alpha) * out[-1])
    return out
```

This strict, SMA-seeded version is what `pandas_ta.ema` does — and therefore what `ti.ema` and the chart do. If you just want that value, call `ti.ema(values, period)` and skip the hand-roll; reach for `ema_series_strict` when you want to read or modify the warm-up/seed behaviour. The relaxed `ema_series` above is a learning-friendly approximation, not chart parity.

### Incremental "last point" version

EMA is **naturally incremental**: each step depends only on the previous one. It can be cached in `sdk.state`:

```python
def on_bar_strategy(sdk, params):
    period = int((params or {}).get("period", 20))
    alpha = 2.0 / (period + 1.0)

    if not isinstance(sdk.state, dict):
        sdk.state = {}
    if "ema" not in sdk.state:
        sdk.state["ema"] = None

    last_close = sdk.candles[-1]["close"]
    ema = sdk.state["ema"]
    if ema is None:
        sdk.state["ema"] = last_close  # seed
        return

    ema = alpha * last_close + (1 - alpha) * ema
    sdk.state["ema"] = ema

    # ... logic uses `ema`
```

**Gain:** O(1) per candle instead of O(n). For 5m strategies running over months, this makes a difference.

> If you want this O(1) win *and* exact chart parity, use the streaming
> class instead of hand-managing state: build `ti.Ema(period)` once at
> module scope, call `.update(last_close)` each bar, and read `.value()`
> (`None` until `.is_ready()`). The streaming class is **bit-for-bit
> identical** to the vectorised `ti.ema`, and both run the kernel the chart
> uses. See [`tesstrade_indicators`](tesstrade-indicators.md).

## WMA -- Weighted moving average

Linearly decreasing weight: the most recent point weighs the most.

```python
def wma_last(values, period):
    if len(values) < period:
        return None
    weights = list(range(1, period + 1))  # 1, 2, 3, ..., period
    window = values[-period:]
    total = sum(v * w for v, w in zip(window, weights))
    return total / sum(weights)
```

For the chart-identical full series there is `ti.wma(values, period)` (and `ti.Wma(period)` for O(1) per-bar). The reference above is for reading or extending the weighting.

## HMA -- Hull Moving Average

Smoother than EMA, less laggy than SMA. **HMA is not in the
`tesstrade_indicators` catalogue**, so this hand-rolled version (built from
the WMA above) is exactly the kind of thing this page exists for — own the
math, or reach for `pandas_ta`:

```python
def hma_series(values, period):
    half = max(1, period // 2)
    sqrt_p = max(1, int(period ** 0.5))

    wma_half = [None] * len(values)
    wma_full = [None] * len(values)

    # Rolling WMA (see WMA implementation above, adapted to a series)
    for i in range(len(values)):
        if i + 1 >= half:
            w = list(range(1, half + 1))
            win = values[i - half + 1 : i + 1]
            wma_half[i] = sum(v * ww for v, ww in zip(win, w)) / sum(w)
        if i + 1 >= period:
            w = list(range(1, period + 1))
            win = values[i - period + 1 : i + 1]
            wma_full[i] = sum(v * ww for v, ww in zip(win, w)) / sum(w)

    # Raw = 2 * WMA_half - WMA_full, then WMA of raw with sqrt(period)
    raw = []
    for h, f in zip(wma_half, wma_full):
        raw.append(2 * h - f if h is not None and f is not None else None)

    # Final WMA on raw (ignores None during warmup)
    out = [None] * len(values)
    for i in range(len(values)):
        window = [r for r in raw[max(0, i - sqrt_p + 1) : i + 1] if r is not None]
        if len(window) == sqrt_p:
            w = list(range(1, sqrt_p + 1))
            out[i] = sum(v * ww for v, ww in zip(window, w)) / sum(w)

    return out
```

HMA is more complex to implement, but it is suitable for scripts that need a smooth average. For the "something better than SMA" case, EMA is usually enough — and for plain EMA you can use `ti.ema` for chart parity.

## With `numpy`

Using `np`, the implementation fits in a few lines:

```python
import numpy as np  # already available as the global `np`

def sma_last_np(values, period):
    if len(values) < period:
        return None
    return float(np.mean(values[-period:]))


def ema_series_np(values, period):
    alpha = 2.0 / (period + 1.0)
    arr = np.asarray(values, dtype=float)
    # numpy has no native EMA; emulating with `lfilter` would be ideal, but simpler:
    out = np.empty_like(arr)
    out[0] = arr[0]
    for i in range(1, len(arr)):
        out[i] = alpha * arr[i] + (1 - alpha) * out[i - 1]
    return out.tolist()
```

**Caveat:** even with numpy, the loop is still necessary for EMA, and this uses the *relaxed* first-value seed (not chart parity). `scipy` is **not available** in the sandbox. If you want the chart-true value, use `ti.ema`; if performance in a per-bar loop is critical, use `ti.Ema(period)` or cache in `sdk.state` as shown above.

## Using `pandas_ta`

A subset of popular functions is available:

```python
# Requires conversion to a pandas Series
close_series = pd.Series([c["close"] for c in sdk.candles])
sma = ta.sma(close_series, length=20)  # returns Series
if sma is not None and not pd.isna(sma.iloc[-1]):
    last_sma = float(sma.iloc[-1])
```

`pandas_ta` is the right tool for any indicator **outside** the six-function `ti` catalogue (its `ti` counterparts — `ti.sma`/`ti.ema`/`ti.wma` — already match `pandas_ta` to floating-point precision under the project's golden-vector tests, so for those, prefer `ti` to get the exact chart series for free).

## Summary table

| Indicator | Lag | Smoothing | Incremental complexity | Chart-true `ti` call |
|---|---|---|---|---|
| SMA | High | Low | O(1) with running sum | `ti.sma` / `ti.Sma` |
| EMA | Medium | High | O(1) native | `ti.ema` / `ti.Ema` |
| WMA | Low | Medium | O(period) | `ti.wma` / `ti.Wma` |
| HMA | Very low | Very high | O(period) | — (hand-roll or `pandas_ta`) |

## Next steps

* [Anatomy of a custom indicator](anatomy.md) -- the canonical file
  structure (colors → params → declaration → math → dispatcher) every
  example should mirror.
* [`tesstrade_indicators`](tesstrade-indicators.md) -- the parity-true math
  brain: the six vectorised functions, the six O(1) streaming classes, and
  exactly how they match the chart.
* [RSI, MACD and Bollinger Bands](rsi-macd-bands.md) -- composite indicators built on top of EMAs.
* [SMA Crossover](../strategies/sma-crossover.md) -- full template using SMA.
* [MACD Momentum](../strategies/macd-momentum.md) -- template using EMA and signal line.
