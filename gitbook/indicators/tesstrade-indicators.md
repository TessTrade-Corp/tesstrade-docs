# `tesstrade_indicators` — the unified math brain

`tesstrade_indicators` is the library that gives the sandbox the **exact
indicator math the chart renders with**. The sandbox library *and* the
live chart (live-calc, WASM) both call into one shared math engine —
`tesstrade_core` — so the series you compute here and the line the chart
draws come from a **single code path**. There is no separate "chart math"
that can disagree with yours.

Concretely:

* `import tesstrade_indicators as ti` → `ti.rsi(...)`, `ti.ema(...)`, …
  call `tesstrade_core` kernels.
* The live chart's renderer (WASM/live-calc) calls the **same**
  `tesstrade_core` kernels.
* Same kernels → same numbers. What you backtest is what you see drawn.

It is **opt-in**: you import it explicitly with
`import tesstrade_indicators as ti`. Strategies that already use
`pandas_ta` or pure-Python implementations keep working unchanged. And
because it is compiled native code, recomputing the same indicator every
bar stays cheap as candle history grows.

> **New here?** Start with the
> [Anatomy of a custom indicator](anatomy.md) — it shows the canonical
> file structure (**params and colors first**) that every example on this
> page assumes.

## When to use it

Use `tesstrade_indicators` when:

* You want **chart-parity math** — the numbers you compute are the numbers
  the chart renders, by construction (same kernels).
* The strategy reads the **same indicator on every bar** (e.g.
  `rsi.iloc[-1]` inside `on_bar_strategy`). Every call to the
  pandas-style API recomputes the entire series — `O(n)` per bar,
  `O(n²)` over a backtest. The streaming classes here are `O(1)` per
  bar.
* You are running long backtests (5 000+ bars) or optimization with
  many candidate parameter sets.
* The strategy is hitting `TimeoutError` because indicator math
  dominates the per-bar budget.

Stick with `pandas_ta` / `pandas` / `numpy` when:

* The indicator is **not in the catalogue below** (Bollinger Bands,
  Stochastic, ADX, Ichimoku, …). For those, `pandas_ta` or a hand-rolled
  implementation is the way — see
  [Implementing SMA and EMA](implementing-sma-ema.md) and
  [RSI, MACD and Bollinger Bands](rsi-macd-bands.md).
* You only compute the indicator once at the end of the backtest
  rather than every bar (the cost is the same in either backend).
* You are most comfortable expressing the math with `Series.rolling`
  and `Series.ewm`. Optimisation is only useful where it matters.

## Two APIs per indicator

Every indicator in `tesstrade_indicators` ships in two flavours.

### Vectorised functions

Same shape as `pandas_ta`: pass a list, get a list back.

```python
import tesstrade_indicators as ti

closes = [c["close"] for c in sdk.candles]

sma  = ti.sma(closes, 20)              # list[Optional[float]]
ema  = ti.ema(closes, 20)              # list[Optional[float]]
wma  = ti.wma(closes, 20)              # list[Optional[float]]
rsi  = ti.rsi(closes, 14)              # list[Optional[float]]
macd, signal, hist = ti.macd(closes, fast=12, slow=26, signal=9)
```

For `atr` the inputs are three parallel lists:

```python
highs  = [c["high"]  for c in sdk.candles]
lows   = [c["low"]   for c in sdk.candles]
closes = [c["close"] for c in sdk.candles]
atr_series = ti.atr(highs, lows, closes, 14)
```

The output list is the same length as the input. Warm-up positions
(before the indicator has enough history) are `None`. Read the latest
value with `series[-1]`.

### Streaming classes

Build the indicator object **once at module scope** and `update()` it
with the latest price on every bar. State persists across calls so each
update is `O(1)`.

```python
import tesstrade_indicators as ti

# Module-scope state — survives between bars within the same run.
_rsi  = ti.Rsi(14)
_ema  = ti.Ema(20)
_atr  = ti.Atr(14)
_macd = ti.Macd(fast=12, slow=26, signal=9)


def on_bar_strategy(sdk, params):
    bar = sdk.candles[-1]

    _rsi.update(bar["close"])
    _ema.update(bar["close"])
    _atr.update(bar["high"], bar["low"], bar["close"])
    _macd.update(bar["close"])

    if not _rsi.is_ready():
        return  # warm-up

    if _rsi.value() < 30 and bar["close"] > _ema.value():
        sl = bar["close"] - 2 * _atr.value()
        sdk.buy(action="buy_to_open", qty=1, order_type="market",
                stop_loss=sl)
```

Common methods on every streaming class:

| Method | Returns | Description |
|---|---|---|
| `update(price)` | `None` | Consume one new sample |
| `update(high, low, close)` (`Atr` only) | `None` | Consume one OHLC bar |
| `value()` | `Optional[float]` (or tuple for `Macd`) | Latest output, `None` during warm-up |
| `is_ready()` | `bool` | True once the warm-up window is filled |
| `reset()` | `None` | Drop all state and start over |
| `period()` | `int` | Configured period (all classes except `Macd`, which uses `fast`/`slow`/`signal` instead of a single period) |

`Macd.value()` returns a 3-tuple `(macd, signal, histogram)` once warm.

## Catalogue

The catalogue exposed to the sandbox is **exactly six** vectorised
functions and **exactly six** matching streaming classes — the canonical
core, in two flavours:

| Vectorised (whole series) | Streaming (`O(1)` per bar) | Inputs | Equivalent in `pandas_ta` |
|---|---|---|---|
| `ti.sma(prices, period)` | `ti.Sma(period)` | close-like list | `pandas_ta.sma` |
| `ti.ema(prices, period)` | `ti.Ema(period)` | close-like list | `pandas_ta.ema` (standard seed) |
| `ti.wma(prices, period)` | `ti.Wma(period)` | close-like list | `pandas_ta.wma` |
| `ti.rsi(prices, period)` | `ti.Rsi(period)` | close-like list | `pandas_ta.rsi` (Wilder) |
| `ti.atr(high, low, close, period)` | `ti.Atr(period)` | three parallel lists | `pandas_ta.atr` |
| `ti.macd(prices, fast, slow, signal)` | `ti.Macd(fast, slow, signal)` | close-like list | `pandas_ta.macd` |

That's the whole list. If a strategy needs an indicator that is **not**
on it (Bollinger Bands, Stochastic, ADX, Ichimoku, …), keep using
`pandas_ta` or a hand-rolled implementation — see
[Implementing SMA and EMA](implementing-sma-ema.md) and
[RSI, MACD and Bollinger Bands](rsi-macd-bands.md).

> The broader `tesstrade_core` engine implements many more indicators
> internally (HMA, VIDYA, KAMA, T3, ADX/DMI, Bollinger, Ichimoku, VWAP,
> Supertrend, and dozens more — the same kernels that draw those studies
> on the chart). Today only the six functions and six classes above are
> exposed to the sandbox via `tesstrade_indicators`; for anything else,
> reach for `pandas_ta` or hand-roll it.

## Math correctness — what "the same" actually guarantees

The guarantee here is **tiered and honest**, not a single blanket
tolerance. Four distinct properties hold:

| Layer | What is guaranteed | How it's verified |
|---|---|---|
| **Same kernels** | The sandbox `tesstrade_indicators` and the live chart (live-calc / WASM) call the **same `tesstrade_core` kernels** — one code path. What you compute *is* what the chart renders. | Architectural: there is no second chart-math implementation to drift. |
| **Streaming == vectorised** | Each streaming class is **bit-for-bit identical** to its vectorised function — same `f64` bits, not merely "close". | A stream gate compares `f64::to_bits()` across clean, NaN, leading-NaN, and flat series; equality is exact. |
| **Backend == chart series** | The PyO3 backend that runs your script and the subprocess that feeds the chart agree on the rendered series to **< 1e-12**. | `pyo3_parity` test over real study series. |
| **Kernels vs `pandas_ta`** | The kernels match `pandas_ta` to floating-point precision under a **200-candle golden reference**, with **per-indicator tolerances** (roughly `1e-1` to `1e-6`, varying by indicator — recursive/path-dependent ones like ATR/MACD are looser than SMA). | `golden_parity` golden-vector test. |

In plain terms: **streaming and vectorised give you the same bits; both
run the kernels the chart uses; and against `pandas_ta` the kernels match
to float precision under the golden gate.** There is no "1e-9 over 1000
bars for everything" — the tolerance depends on the indicator, and the
*chart-parity* property is even stronger than any single number because
it's the same code path, not two implementations being compared.

## Picking between `ti.rsi(...)` and `ti.Rsi(...)`

| Question | Answer |
|---|---|
| "I want the latest value once" | Either works — vectorised is slightly simpler |
| "I read the indicator on every bar of a backtest" | `Rsi(...)` streaming — `O(1)` per bar |
| "I need the entire series for a chart panel" | `ti.rsi(...)` vectorised |
| "I'm porting from `pandas_ta`" | Vectorised first, switch to streaming if performance matters |
| "I want determinism guarantees" | Both — same kernels, and bit-for-bit identical to each other |

A common pattern is to use the **streaming class for the trading
decision** and the **vectorised function only when rendering the
indicator in a chart pane**. Note the `df=` branch spreads
`**DECLARATION` so `type`/`pane`/`scale`/`plots` travel with `series`
(see [Anatomy](anatomy.md#the-series-contract-one-line-per-candle)):

```python
import tesstrade_indicators as ti

COLOR_RSI = "#A78BFA"   # colors first — see anatomy.md

DECLARATION = {
    "type": "strategy",
    "inputs": [
        {"name": "period", "label": "RSI period", "type": "int",
         "default": 14, "min": 2, "max": 200, "step": 1},
        {"name": "rsi_color", "label": "RSI color", "type": "color",
         "default": COLOR_RSI},
    ],
    "plots": [
        {"name": "rsi", "source": "rsi", "type": "line",
         "color": COLOR_RSI, "width": 2},
    ],
    "levels": [
        {"value": 70, "color": "#EF4444"},
        {"value": 30, "color": "#22C55E"},
    ],
    "pane": "new",      # RSI is 0–100 — never overlay on price
    "scale": "right",
}

_rsi = ti.Rsi(14)


def _declaration(params):
    """Wire the type:'color' input into the plot — colors don't auto-apply."""
    p = params or {}
    color = p.get("rsi_color", COLOR_RSI)
    plots = [dict(plot) for plot in DECLARATION["plots"]]
    plots[0]["color"] = color
    return {**DECLARATION, "plots": plots}


def on_bar_strategy(sdk, params):
    _rsi.update(sdk.candles[-1]["close"])
    if _rsi.is_ready() and _rsi.value() < 30:
        sdk.buy(action="buy_to_open", qty=1, order_type="market")


def main(df=None, sdk=None, params={}):
    params = params or {}
    if sdk is not None:
        return on_bar_strategy(sdk, params)
    if df is not None:
        # The chart pane needs the whole series — vectorised is right here.
        period = int(params.get("period", 14))
        closes = df["close"].tolist()
        return {**_declaration(params), "series": {"rsi": ti.rsi(closes, period)}}
    return _declaration(params)
```

## Migration tips

### From `pandas_ta` (last-point reads)

```python
# Before — pandas_ta recomputes the whole RSI every bar
import pandas_ta as ta

def on_bar_strategy(sdk, params):
    closes = pd.Series([c["close"] for c in sdk.candles])
    rsi = ta.rsi(closes, length=14).iloc[-1]
    if not pd.isna(rsi) and rsi < 30:
        sdk.buy(action="buy_to_open", qty=1, order_type="market")
```

```python
# After — streaming class, O(1) per bar, same kernels the chart draws with
import tesstrade_indicators as ti

_rsi = ti.Rsi(14)

def on_bar_strategy(sdk, params):
    _rsi.update(sdk.candles[-1]["close"])
    if _rsi.is_ready() and _rsi.value() < 30:
        sdk.buy(action="buy_to_open", qty=1, order_type="market")
```

### From a custom `sdk.state` cache

If you already cache an EMA in `sdk.state` (see
[implementing SMA/EMA](implementing-sma-ema.md#incremental-last-point-version)),
the streaming class is a drop-in replacement that avoids the manual
seeding logic:

```python
# Before
def on_bar_strategy(sdk, params):
    if not isinstance(sdk.state, dict):
        sdk.state = {}
    if "ema" not in sdk.state:
        sdk.state["ema"] = None
    last = sdk.candles[-1]["close"]
    ema = sdk.state["ema"]
    if ema is None:
        sdk.state["ema"] = last
        return
    alpha = 2.0 / (20 + 1.0)
    sdk.state["ema"] = alpha * last + (1 - alpha) * ema
```

```python
# After
import tesstrade_indicators as ti

_ema = ti.Ema(20)

def on_bar_strategy(sdk, params):
    _ema.update(sdk.candles[-1]["close"])
    if _ema.is_ready():
        # use _ema.value()
        ...
```

## FAQ

### Does this change how my existing scripts behave?

No. `tesstrade_indicators` is opt-in — you only see it after `import
tesstrade_indicators`. Strategies using `pandas`, `numpy`, `pandas_ta`,
or pure-Python helpers run exactly as before.

### Can I mix it with `pandas_ta`?

Yes. They coexist fine in the same script. Use `ti` for the six
catalogue indicators (chart-parity + speed) and `pandas_ta` for anything
outside it.

### What about indicators not on the catalogue?

Keep using `pandas_ta` or a manual implementation. The catalogue is
exactly the six functions / six classes above; everything else stays
available through `pandas_ta` or hand-rolled math.

### Will the chart show different numbers than my backtest?

No — that's the whole point of the unified math brain. The sandbox
library and the chart's renderer call the **same `tesstrade_core`
kernels**, so the computed series and the drawn line come from one code
path. (See [Math correctness](#math-correctness--what-the-same-actually-guarantees)
for the exact, tiered guarantees.)

### Do the streaming classes work in chart trading too?

Yes. Module-scope state persists for the duration of the live bot,
the same way `sdk.state` does — see
[live vs backtest](../chart-trading/live-vs-backtest.md) for the
specifics of how state is preserved across restarts.

## Next steps

* [Anatomy of a custom indicator](anatomy.md) — the canonical file
  structure (params and colors first).
* [Implementing SMA and EMA](implementing-sma-ema.md) — pure-Python
  reference implementations and when to prefer them.
* [RSI, MACD and Bollinger Bands](rsi-macd-bands.md) — formula
  derivations for the harder indicators.
* [Persistent state](../strategies/persistent-state.md) — how
  module-scope state interacts with the engine across runs.
