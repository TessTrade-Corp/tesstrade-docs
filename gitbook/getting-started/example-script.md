# Example script

A minimal, runnable first script. It buys when the price rises relative to
the previous bar **and** is above a moving average, then closes when either
condition fails. The moving average is drawn on the chart so you can *see*
the filter working. Uses:

* Confirm that the Code Editor is working.
* Observe a plotted indicator **and** trade signals on the chart.
* Understand the **params-and-colors-first** layout and the `main()`
  dispatcher in a real run.

This is not a profitable strategy — it is only a working skeleton. For the
canonical, field-by-field structure every indicator and strategy should
mirror, read [Anatomy of a custom indicator](../indicators/anatomy.md)
right after this page.

## 1. Open the Code Editor

In **Backtest** or **Chart Trading**, click **Editor**. A code window appears with a scaffold.

## 2. Erase the scaffold and paste the code below

Notice the order: **colors → param defaults → declaration → math →
dispatcher**. Everything the user can tune — the period **and** the line
color — is declared at the very top, before any math. The moving average is
computed with [`tesstrade_indicators`](../indicators/tesstrade-indicators.md),
so the line you plot is drawn from the *same kernels the chart renders
with* — no "looks right in backtest, wrong on the chart" drift.

```python
# ── Strategy: Rising-bar above SMA ────────────────────────────────────
# 1) COLORS FIRST — one place to retheme the indicator.
import tesstrade_indicators as ti   # the same math the chart renders with

COLOR_SMA = "#22D3EE"   # cyan

# 2) PARAM DEFAULTS — the math reads these; never a magic number mid-function.
DEFAULT_QTY = 1.0
DEFAULT_SMA = 20

# 3) DECLARATION — params and colors are the FIRST thing the engine sees.
DECLARATION = {
    "type": "strategy",
    "inputs": [
        {"name": "qty", "label": "Quantity", "type": "float",
         "default": DEFAULT_QTY, "min": 0.001, "max": 1000.0, "step": 0.001},
        {"name": "sma_period", "label": "SMA period", "type": "int",
         "default": DEFAULT_SMA, "min": 2, "max": 400, "step": 1},
        # The color input lives right next to the number it styles.
        {"name": "sma_color", "label": "SMA color", "type": "color",
         "default": COLOR_SMA},
    ],
    "plots": [
        {"name": "sma", "source": "sma", "type": "line",
         "color": COLOR_SMA, "width": 2},
    ],
    "pane": "overlay",   # SMA shares the price scale → draw on the price pane
    "scale": "none",
}


# 4) MATH — read every tunable value out of params, once, with safe defaults.
def _resolve(params):
    p = params or {}
    return {
        "qty": float(p.get("qty", DEFAULT_QTY)),
        "sma": int(p.get("sma_period", DEFAULT_SMA)),
        "sma_color": p.get("sma_color", COLOR_SMA),
    }


def _declaration(params):
    """DECLARATION with the user's chosen color wired into the plot.

    A type:"color" input does NOT auto-apply — we must read it from params
    and inject it into the plot's color here, or the line stays cyan no
    matter what the user picks.
    """
    cfg = _resolve(params)
    plots = [dict(plot) for plot in DECLARATION["plots"]]  # copy, don't mutate
    plots[0]["color"] = cfg["sma_color"]
    return {**DECLARATION, "plots": plots}


def on_bar_strategy(sdk, params):
    cfg = _resolve(params)

    # Needs enough candles to compare bars and warm up the SMA.
    if len(sdk.candles) < cfg["sma"] + 1:
        return

    closes = [c["close"] for c in sdk.candles]
    sma = ti.sma(closes, cfg["sma"])   # list, same length; None during warm-up

    last_close = closes[-1]
    prev_close = closes[-2]
    last_sma = sma[-1]
    if last_sma is None:               # still warming up — do nothing
        return

    went_up = last_close > prev_close
    above_sma = last_close > last_sma

    if sdk.position == 0 and went_up and above_sma:
        sdk.buy(action="buy_to_open", qty=cfg["qty"], order_type="market")
    elif sdk.position > 0 and not (went_up and above_sma):
        sdk.sell(action="sell_to_close", qty=abs(sdk.position), order_type="market")


# 5) DISPATCHER — one entry point, three contexts.
def main(df=None, sdk=None, params={}):
    params = params or {}
    if sdk is not None:                       # per-bar: trade
        return on_bar_strategy(sdk, params)
    if df is not None:                         # chart: full series for the plot
        closes = df["close"].tolist()
        cfg = _resolve(params)
        return {**_declaration(params),
                "series": {"sma": ti.sma(closes, cfg["sma"])}}
    return _declaration(params)               # no args: metadata only
```

## 3. Click **Run** (or **Backtest**)

* In **Backtest**: choose the symbol, period, and click start. In 1-2 min the results panel appears.
* In **Chart Trading**: start a **paper trading bot** (see [paper bots](../chart-trading/paper-trading-bots.md)).

## 4. What to expect

A cyan SMA line on the price pane, plus trades that fire only when the bar
rises **and** sits above that line. Fewer trades than a pure coin-flip, but
still no edge — this is a noise generator with a filter, not a strategy.

Checkpoints:

* The parameter panel appeared with editable **Quantity**, **SMA period**,
  and **SMA color** fields.
* Changing **SMA color** in the panel actually recolors the line (because
  the script reads `sma_color` and injects it — see the dispatcher).
* The SMA line is drawn on the chart, and orders were emitted (markers).
* Equity evolved candle by candle, and the script compiled without error.

## 5. Variations

Modifications in order of difficulty:

### Only buy when it rises 2 bars in a row
```python
closes = [c["close"] for c in sdk.candles]
went_up_twice = closes[-1] > closes[-2] > closes[-3]
```

### Swap the SMA for an EMA (same parity-true library)
`tesstrade_indicators` exposes 6 vectorised functions — `sma`, `ema`,
`wma`, `rsi`, `atr`, `macd` — that all call the chart's kernels. Switching
is a one-line change:

```python
sma = ti.ema(closes, cfg["sma"])   # was ti.sma(...)
```

For indicators outside that catalogue (Bollinger, Stochastic, ADX, …) write
the math yourself or use `pandas_ta` — see
[`tesstrade_indicators`](../indicators/tesstrade-indicators.md).

### Add another plot or input

See [Anatomy of a custom indicator](../indicators/anatomy.md) for the
canonical structure, and [SMA Crossover](../strategies/sma-crossover.md) for
a full strategy template commented line by line.

### Store state between bars
```python
if not isinstance(sdk.state, dict):
    sdk.state = {}
sdk.state["trades_taken"] = sdk.state.get("trades_taken", 0) + 1
```

Details in [persistent state](../strategies/persistent-state.md).

## 6. Error handling

### "Strict Mode" error
The `main()` function was not defined at the root level. Check that it is not indented.

### "requires explicit action" error
`sdk.buy()` was called without `action=`. All calls require that argument - the [canonical actions](../sdk-reference/actions.md) documentation lists the 7.

### "Import not allowed"
Import outside the whitelist. See [sandbox limits](sandbox-limits.md). The
only import in this script is `tesstrade_indicators`, which is allowed; the
full whitelist is `numpy`, `pandas`, `pandas_ta`, `talib`, `math`, `json`,
`datetime`, `tesstrade_indicators`. (`np`, `pd`, `ta`, `talib`, `math`,
`json`, `datetime` are pre-injected, so `tesstrade_indicators` is the one
you usually `import` by hand. Note `re` is **not** allowed.)

### The SMA color picker shows but the line never changes
The `type:"color"` input is declared but never wired. A color input only
stores its value in `params`; it does **not** auto-apply to a plot. Read it
with `params.get("sma_color")` and inject it into the plot's `color` before
returning the declaration — see `_declaration()` above and
[Anatomy: colors do not auto-apply](../indicators/anatomy.md#colors-do-not-auto-apply-wire-them).

### 0 trades
For an event-driven script like this one, no trades usually means the entry logic never triggered (e.g. `sdk.position` / price comparison conditions were never met) or there were fewer candles than `sma_period + 1`. Check that `sdk.buy()` is actually reached. Note: declarative `entry_conditions` in the DECLARATION do **not** block `on_bar_strategy` from emitting trades - at runtime they are ignored (with a warning) unless you set `params['runtime_declarative_fallback'] = True` (details in [when to use declarative mode](../declarative-mode/when-to-use.md)).

### Empty parameter panel
`DECLARATION["inputs"]` is empty or `main()` does not return `DECLARATION` in the no-argument branch. Review the contract in [main dispatcher](../contract/dispatcher-main.md).

## Next steps

* [Anatomy of a custom indicator](../indicators/anatomy.md) - the canonical
  colors→params→declaration→math→dispatcher structure to mirror everywhere.
* [main dispatcher](../contract/dispatcher-main.md) - why this script has 3 branches.
* [DECLARATION](../contract/declaration.md) - how to add more inputs and plots.
* [`tesstrade_indicators`](../indicators/tesstrade-indicators.md) - the
  parity-true math library and its streaming classes.
* [SMA Crossover](../strategies/sma-crossover.md) - first utility template.
