# RSI, MACD and Bollinger Bands

**Pure Python** implementations of three indicators common in quant strategies, with no dependency on `pandas_ta`.

> **One math brain — and where it stops.** RSI and MACD are *in* the
> unified catalogue: `ti.rsi(closes, period)` and
> `ti.macd(closes, fast, slow, signal)` from
> [`tesstrade_indicators`](tesstrade-indicators.md) are the **parity-true**
> path — they call the **same `tesstrade_core` kernels the live chart
> renders with**, so what you compute equals what the chart draws (Wilder
> RSI; `pandas_ta`-style MACD). For per-bar strategies the matching
> streaming classes `ti.Rsi` / `ti.Macd` are *bit-for-bit identical* to
> those vectorised functions at `O(1)` per bar. ATR is also in the
> catalogue as `ti.atr(high, low, close, period)`.
>
> **Bollinger Bands is *not* in the 6-function catalogue**, so keep the
> reference implementation below for it. (ATR *as a full series* also has
> no vectorised list helper beyond `ti.atr`; the hand-rolled `atr_last`
> below stays useful for a single trailing value and for reading the math.)
> The pure-Python references on this page remain valuable for two reasons:
> to **read and extend** the math, and to cover indicators outside the
> catalogue. New to the file layout? Start with
> [Anatomy of a custom indicator](anatomy.md) — colors and params first,
> then the math.

## RSI -- Relative Strength Index

Oscillator between 0 and 100. Above 70 = overbought; below 30 = oversold.

### Formula

```
gain[i]  = max(close[i] - close[i-1], 0)
loss[i]  = max(close[i-1] - close[i], 0)

avg_gain[period] = mean(gains[1..period])
avg_loss[period] = mean(losses[1..period])

For i > period (Wilder smoothing):
  avg_gain[i] = (avg_gain[i-1] * (period-1) + gain[i]) / period
  avg_loss[i] = (avg_loss[i-1] * (period-1) + loss[i]) / period

rs = avg_gain / avg_loss
rsi = 100 - 100 / (1 + rs)
```

### The parity-true path (chart math)

If you just want RSI that matches the chart, reach for
[`tesstrade_indicators`](tesstrade-indicators.md) — it runs the same Wilder
kernel the chart renders with, so there is no drift between your series and
the drawn line:

```python
import tesstrade_indicators as ti

closes = df["close"].tolist()
rsi = ti.rsi(closes, 14)   # list, len(df), None during warm-up; latest = rsi[-1]
```

The reference implementations below reproduce that same Wilder math in pure
Python — keep them when you want to read, tweak, or fork the formula.

### Implementation -- series

```python
def rsi_series(closes, period=14):
    """Wilder RSI. Returns None for the first `period` points."""
    if len(closes) < period + 1:
        return [None] * len(closes)

    out = [None] * period
    gains = 0.0
    losses = 0.0

    # Seed: simple means of the first `period` deltas
    for i in range(1, period + 1):
        delta = closes[i] - closes[i - 1]
        if delta > 0:
            gains += delta
        else:
            losses += -delta
    avg_gain = gains / period
    avg_loss = losses / period
    if avg_loss == 0:
        out.append(100.0)
    else:
        rs = avg_gain / avg_loss
        out.append(100.0 - 100.0 / (1.0 + rs))

    # Wilder smoothing for the rest
    for i in range(period + 1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gain = delta if delta > 0 else 0.0
        loss = -delta if delta < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        if avg_loss == 0:
            out.append(100.0)
        else:
            rs = avg_gain / avg_loss
            out.append(100.0 - 100.0 / (1.0 + rs))

    return out
```

### Implementation -- last point (approximation)

```python
def rsi_last_approx(closes, period=14):
    """Simplified RSI: arithmetic mean of deltas over the last period.
    Less precise than Wilder, but O(period). Suitable for on_bar_strategy."""
    if len(closes) < period + 1:
        return None
    gains = 0.0
    losses = 0.0
    for i in range(len(closes) - period, len(closes)):
        delta = closes[i] - closes[i - 1]
        if delta > 0:
            gains += delta
        else:
            losses += -delta
    if losses == 0:
        return 100.0
    rs = (gains / period) / (losses / period)
    return 100.0 - 100.0 / (1.0 + rs)
```

**Practical difference:** Wilder is more precise for canonical RSI; the simplified version is off by ~1-3 points in most cases. To match the chart (and TradingView), use `rsi_series` and take `[-1]` — or, for the same Wilder kernel the chart renders with, call `ti.rsi(closes, 14)[-1]`.

### Incremental RSI with `sdk.state`

The most efficient approach: store `avg_gain` and `avg_loss` in state and update on every candle:

```python
def rsi_incremental(sdk, period=14):
    if not isinstance(sdk.state, dict):
        sdk.state = {}

    closes = [c["close"] for c in sdk.candles]
    if len(closes) < period + 1:
        return None

    if "rsi_ag" not in sdk.state or "rsi_al" not in sdk.state:
        # Seed when `period + 1` candles are reached
        gains = losses = 0.0
        for i in range(1, period + 1):
            d = closes[i] - closes[i - 1]
            if d > 0: gains += d
            else: losses += -d
        sdk.state["rsi_ag"] = gains / period
        sdk.state["rsi_al"] = losses / period

    # Update with the delta from the last bar
    d = closes[-1] - closes[-2]
    gain = d if d > 0 else 0.0
    loss = -d if d < 0 else 0.0
    sdk.state["rsi_ag"] = (sdk.state["rsi_ag"] * (period - 1) + gain) / period
    sdk.state["rsi_al"] = (sdk.state["rsi_al"] * (period - 1) + loss) / period

    if sdk.state["rsi_al"] == 0:
        return 100.0
    rs = sdk.state["rsi_ag"] / sdk.state["rsi_al"]
    return 100.0 - 100.0 / (1.0 + rs)
```

> The hand-rolled incremental above is fine, but for a strategy you can
> skip the bookkeeping: build `ti.Rsi(14)` once at module scope and call
> `.update(close)` per bar — it is the same kernel, `O(1)`, and bit-for-bit
> identical to `ti.rsi`. See [`tesstrade_indicators`](tesstrade-indicators.md).

## MACD -- Moving Average Convergence Divergence

Three lines: MACD line, Signal line, and histogram.

### Formula

```
MACD line   = EMA(close, fast) - EMA(close, slow)     # typical: fast=12, slow=26
Signal line = EMA(MACD line, signal)                   # typical: signal=9
Histogram   = MACD line - Signal line
```

### The parity-true path (chart math)

`ti.macd` returns the three lines from the same kernel the chart draws
(`pandas_ta`-style MACD), so the histogram you cross on equals the
histogram on screen:

```python
import tesstrade_indicators as ti

closes = df["close"].tolist()
macd, signal, hist = ti.macd(closes, fast=12, slow=26, signal=9)  # three lists, len(df)
```

The pure-Python reference below reproduces the same formula when you want
to read or extend it.

### Implementation

```python
def ema_series(values, period):
    """Simple EMA (see SMA/EMA docs)."""
    if not values:
        return []
    alpha = 2.0 / (period + 1.0)
    out = [float(values[0])]
    for v in values[1:]:
        out.append(alpha * v + (1.0 - alpha) * out[-1])
    return out


def macd_series(closes, fast=12, slow=26, signal=9):
    """Returns (macd_line, signal_line, hist) -- all aligned with closes."""
    fast_ema = ema_series(closes, fast)
    slow_ema = ema_series(closes, slow)
    macd_line = [f - s for f, s in zip(fast_ema, slow_ema)]
    signal_line = ema_series(macd_line, signal)
    hist = [m - s for m, s in zip(macd_line, signal_line)]
    return macd_line, signal_line, hist
```

### Detecting a histogram cross

```python
def macd_hist_cross_up(closes, fast=12, slow=26, signal=9):
    _, _, hist = macd_series(closes, fast, slow, signal)
    if len(hist) < 2:
        return False
    return hist[-2] <= 0 and hist[-1] > 0
```

A complete MACD template is in the [MACD Momentum strategy](../strategies/macd-momentum.md).

### Incremental MACD

EMAs are naturally incremental. Cache each one in `sdk.state`:

```python
def macd_incremental(sdk, fast=12, slow=26, signal=9):
    if not isinstance(sdk.state, dict):
        sdk.state = {}

    close = sdk.candles[-1]["close"]
    alpha_fast = 2.0 / (fast + 1.0)
    alpha_slow = 2.0 / (slow + 1.0)
    alpha_sig = 2.0 / (signal + 1.0)

    # Seed
    if "ema_fast" not in sdk.state:
        sdk.state["ema_fast"] = close
        sdk.state["ema_slow"] = close
        sdk.state["signal"] = 0.0
        return None

    sdk.state["ema_fast"] = alpha_fast * close + (1 - alpha_fast) * sdk.state["ema_fast"]
    sdk.state["ema_slow"] = alpha_slow * close + (1 - alpha_slow) * sdk.state["ema_slow"]
    macd_value = sdk.state["ema_fast"] - sdk.state["ema_slow"]
    sdk.state["signal"] = alpha_sig * macd_value + (1 - alpha_sig) * sdk.state["signal"]
    hist = macd_value - sdk.state["signal"]

    return macd_value, sdk.state["signal"], hist
```

> Same shortcut as RSI: `ti.Macd(12, 26, 9)` built once at module scope and
> `.update(close)` per bar gives you `(macd, signal, hist)` from
> `.value()`, bit-for-bit identical to `ti.macd` — no manual EMA caching.

## Bollinger Bands

Moving average plus or minus N standard deviations. Measures volatility.

> **Not in the catalogue.** Bollinger Bands is *not* one of the six
> exposed `tesstrade_indicators` functions, so there is no `ti.bbands`.
> Use the reference implementation below (or `pandas_ta.bbands`). You can
> still source the **middle band** from the parity-true brain with
> `ti.sma(closes, period)` and add the standard-deviation envelope around
> it yourself.

### Formula

```
middle = SMA(close, period)            # typically period=20
std    = stdev(close[-period:])
upper  = middle + (std_mult * std)      # typically std_mult=2.0
lower  = middle - (std_mult * std)
```

### Implementation

```python
def bbands_series(closes, period=20, std_mult=2.0):
    """Returns (middle, upper, lower) -- all aligned with closes."""
    middle = []
    upper = []
    lower = []
    for i in range(len(closes)):
        if i + 1 < period:
            middle.append(None)
            upper.append(None)
            lower.append(None)
            continue
        window = closes[i - period + 1 : i + 1]
        mean = sum(window) / period
        var = sum((x - mean) ** 2 for x in window) / period
        std = var ** 0.5
        middle.append(mean)
        upper.append(mean + std_mult * std)
        lower.append(mean - std_mult * std)
    return middle, upper, lower
```

### Usage -- reversion when the band is touched

```python
def on_bar_strategy(sdk, params):
    period = int((params or {}).get("period", 20))
    std_mult = float((params or {}).get("std_mult", 2.0))

    closes = [c["close"] for c in sdk.candles]
    if len(closes) < period:
        return

    window = closes[-period:]
    mean = sum(window) / period
    var = sum((x - mean) ** 2 for x in window) / period
    std = var ** 0.5
    upper = mean + std_mult * std
    lower = mean - std_mult * std
    close = closes[-1]

    if sdk.position == 0:
        if close <= lower:
            sdk.buy(action="buy_to_open", qty=1, order_type="market")
        elif close >= upper:
            sdk.sell(action="sell_short_to_open", qty=1, order_type="market")
    elif sdk.position > 0 and close >= mean:
        sdk.sell(action="sell_to_close", qty=abs(sdk.position), order_type="market")
    elif sdk.position < 0 and close <= mean:
        sdk.buy(action="buy_to_cover", qty=abs(sdk.position), order_type="market")
```

Classic bollinger-reversion strategy: buys when the lower band is touched, sells when price returns to the mean.

## ATR -- Average True Range

A **volatility** indicator, useful for dynamic stops. True Range = maximum of:
* `high - low`
* `|high - previous_close|`
* `|low - previous_close|`

> **Parity-true path.** ATR *is* in the catalogue:
> `ti.atr(high, low, close, period)` (three parallel lists) returns the
> full ATR series from the same kernel the chart renders with — use it when
> you want a chart-matching ATR series. The hand-rolled `atr_last` below is
> still handy for a single trailing value and for reading/extending the
> math.

```python
import tesstrade_indicators as ti

highs = df["high"].tolist()
lows = df["low"].tolist()
closes = df["close"].tolist()
atr = ti.atr(highs, lows, closes, 14)   # list, len(df), None during warm-up
latest_atr = atr[-1]
```

```python
def atr_last(candles, period=14):
    """ATR of the last point. None if candles are insufficient."""
    if len(candles) < period + 1:
        return None
    trs = []
    for i in range(len(candles) - period, len(candles)):
        h = candles[i]["high"]
        l = candles[i]["low"]
        cp = candles[i - 1]["close"]
        trs.append(max(h - l, abs(h - cp), abs(l - cp)))
    return sum(trs) / period
```

Common usage: stop = `close - 2 * ATR`. (For a per-bar strategy, the
streaming `ti.Atr(14)` with `.update(high, low, close)` is the `O(1)`
parity-true equivalent.)

## Next steps

* [Anatomy of a custom indicator](anatomy.md) -- the canonical file shape: colors and params first, then math, then the dispatcher.
* [`tesstrade_indicators`](tesstrade-indicators.md) -- the unified math brain: the 6 vectorised functions (`rsi`/`macd`/`atr` among them) and their bit-for-bit streaming classes.
* [Implementing SMA/EMA](implementing-sma-ema.md) -- the foundation for the indicators above.
* [SMA Crossover](../strategies/sma-crossover.md), [RSI Mean Reversion](../strategies/rsi-mean-reversion.md), [MACD Momentum](../strategies/macd-momentum.md) -- templates using the indicators on this page.
