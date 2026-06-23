# Anatomy of a custom indicator

This page is the **canonical structure** for every custom indicator on
TessTrade. Follow it and your indicator is correct by construction: the
math matches the chart exactly, and every knob a user can turn —
**parameters and colors** — lives at the very top of the file, before any
computation.

Two ideas drive the whole page:

1. **One math brain.** The indicator math you ship is the *same* math the
   chart renders. Import [`tesstrade_indicators`](tesstrade-indicators.md)
   and you call the exact kernels the live chart uses — no drift, no
   "looks right in backtest, wrong on the chart". See
   [Math you can trust](#math-you-can-trust).
2. **Params and colors first.** The top of the file declares *what the
   user can tune*. The math reads those values; it never hard-codes them
   in the middle of a function. See
   [The "params and colors first" rule](#the-params-and-colors-first-rule).

## The shape in one screen

Every indicator is one Python file with a `DECLARATION` dictionary and a
`main()` function. Read the file top-to-bottom and the order is always the
same: **colors → params → declaration → math → dispatcher**.

```python
# ── Indicator: Dual SMA ───────────────────────────────────────────────
# 1) COLORS FIRST — one place to retheme the whole indicator.
import tesstrade_indicators as ti   # the same kernels the chart renders with

COLOR_FAST = "#22D3EE"   # cyan
COLOR_SLOW = "#F59E0B"   # amber

# 2) PARAM DEFAULTS — the math reads these; never a magic number mid-function.
DEFAULT_FAST = 9
DEFAULT_SLOW = 21

# 3) DECLARATION — params and colors are the FIRST thing the engine sees.
DECLARATION = {
    "type": "indicator",
    "inputs": [
        # Tunable numbers...
        {"name": "fast_period", "label": "Fast period", "type": "int",
         "default": DEFAULT_FAST, "min": 1, "max": 200, "step": 1},
        {"name": "slow_period", "label": "Slow period", "type": "int",
         "default": DEFAULT_SLOW, "min": 2, "max": 400, "step": 1},
        # ...and tunable colors, declared right next to them.
        {"name": "fast_color", "label": "Fast color", "type": "color",
         "default": COLOR_FAST},
        {"name": "slow_color", "label": "Slow color", "type": "color",
         "default": COLOR_SLOW},
    ],
    "plots": [
        {"name": "ma_fast", "source": "ma_fast", "type": "line",
         "color": COLOR_FAST, "width": 2},
        {"name": "ma_slow", "source": "ma_slow", "type": "line",
         "color": COLOR_SLOW, "width": 2},
    ],
    "pane": "overlay",
    "scale": "none",
}


# 4) MATH SECOND — computed from the params above, via the shared kernels.
def _resolve(params):
    """Pull every tunable value out of params, once, with safe defaults."""
    p = params or {}
    return {
        "fast": int(p.get("fast_period", DEFAULT_FAST)),
        "slow": int(p.get("slow_period", DEFAULT_SLOW)),
        "fast_color": p.get("fast_color", COLOR_FAST),
        "slow_color": p.get("slow_color", COLOR_SLOW),
    }


def _declaration(params):
    """DECLARATION with the user's chosen colors wired into the plots.

    A type:"color" input does NOT auto-apply to a plot — we must read it
    and inject it here. This is what keeps "colors first" honest from the
    input panel all the way to the rendered line.
    """
    cfg = _resolve(params)
    plots = [dict(plot) for plot in DECLARATION["plots"]]  # copy, don't mutate
    plots[0]["color"] = cfg["fast_color"]
    plots[1]["color"] = cfg["slow_color"]
    return {**DECLARATION, "plots": plots}


def _build_chart(df, params):
    cfg = _resolve(params)
    closes = df["close"].tolist()
    return {
        **_declaration(params),
        "series": {
            "ma_fast": ti.sma(closes, cfg["fast"]),
            "ma_slow": ti.sma(closes, cfg["slow"]),
        },
    }


# 5) DISPATCHER — one entry point, three contexts.
def main(df=None, sdk=None, params={}):
    params = params or {}
    if df is not None:
        return _build_chart(df, params)   # chart: full series
    return _declaration(params)           # no args: metadata only
```

Paste that into the [Live editor](../chart-trading/live-editor.md), and you
get two moving averages on the price pane whose periods *and* colors are
editable from the settings panel.

## The "params and colors first" rule

The settings panel is built **entirely** from `DECLARATION["inputs"]`. So
the single most important habit is: **declare everything tunable at the
top, before any math, and read it back from `params` — never hard-code a
value inside a calculation.**

Concretely:

* **Numbers** (periods, multipliers, thresholds) → one `int`/`float` input
  each, with `default`, `min`, `max`, `step`.
* **Colors** → a `type: "color"` input each, declared right beside the
  number they style. Mirror each default into a top-of-file
  `COLOR_*` constant so the plot declaration and the input default never
  drift apart.
* **Modes / toggles** → `select` (with `options`) or `bool`.

### Why first, and why it matters

* **Discoverability.** A reader (human or AI) sees the entire tuning
  surface in the first 20 lines, without parsing the math.
* **Re-theming is one edit.** Change `COLOR_FAST` once and the default
  plot color, the input default, and the wired runtime color all move
  together.
* **It is the only thing that actually reaches the UI.** Every value you
  read at runtime **must** be declared in `inputs`. If you read
  `params.get("fast_period")` but never declared a `fast_period` input,
  the UI has no control for it and your `default` is the only value that
  ever runs. Declaring inputs first makes "did I expose this?" obvious.

### Colors do not auto-apply — wire them

This is the one sharp edge. A `type: "color"` input **only renders a color
picker and stores the value in `params`**. It does **not** automatically
recolor any plot. You must read it and assign it to the plot's `color`:

```python
# WRONG — the picker shows, but the line stays cyan no matter what the user picks.
DECLARATION = {
    "inputs": [{"name": "fast_color", "type": "color", "default": "#22D3EE"}],
    "plots":  [{"name": "ma_fast", "source": "ma_fast", "type": "line",
                "color": "#22D3EE"}],   # hard-coded; ignores fast_color
}
```

```python
# RIGHT — read the input and inject it into the plot before returning.
def _declaration(params):
    color = (params or {}).get("fast_color", "#22D3EE")
    plots = [dict(p) for p in DECLARATION["plots"]]
    plots[0]["color"] = color
    return {**DECLARATION, "plots": plots}
```

There is no name-matching magic — an input named `fast_color` is *not*
auto-bound to a plot named `ma_fast`. The wiring in `_declaration()` is
what connects them. (If you only need a fixed palette and no end-user
recoloring, skip the color inputs and just point the plot `color` at your
top-of-file `COLOR_*` constant — that already satisfies "colors first".)

> **Color format.** Use **6-digit hex** (`#RRGGBB`). 8-digit alpha hex
> (`#RRGGBBAA`) is rejected by the validator and the color is dropped. For
> a translucent fill, use `"type": "area"` — the renderer applies the fill
> alpha for you. (See [Plots and `series`](plots-and-series.md).)

## Math you can trust

`import tesstrade_indicators as ti` gives you the **same kernels the chart
renders with**. The sandbox library and the live chart both call into one
shared math engine (`tesstrade_core`), so the series you return and the
line the chart draws come from the same code path — there is no separate
"chart math" that can disagree with yours.

```python
import tesstrade_indicators as ti

closes = df["close"].tolist()
rsi = ti.rsi(closes, 14)        # list, same length as df, None during warm-up
ema = ti.ema(closes, 20)
macd, signal, hist = ti.macd(closes, fast=12, slow=26, signal=9)
```

The catalogue exposed to the sandbox is intentionally the canonical core:

| Vectorised (whole series) | Streaming (`O(1)` per bar) | Inputs |
|---|---|---|
| `ti.sma(prices, period)` | `ti.Sma(period)` | close-like list |
| `ti.ema(prices, period)` | `ti.Ema(period)` | close-like list |
| `ti.wma(prices, period)` | `ti.Wma(period)` | close-like list |
| `ti.rsi(prices, period)` | `ti.Rsi(period)` | close-like list |
| `ti.atr(high, low, close, period)` | `ti.Atr(period)` | three parallel lists |
| `ti.macd(prices, fast, slow, signal)` | `ti.Macd(fast, slow, signal)` | close-like list |

For an indicator **not** on that list (Bollinger Bands, Stochastic, ADX,
Ichimoku, …) write the math yourself — the references in
[Implementing SMA and EMA](implementing-sma-ema.md) and
[RSI, MACD and Bollinger Bands](rsi-macd-bands.md) are exact and
sandbox-safe — or use `pandas_ta`. Full details, including the streaming
classes for per-bar strategies, are in
[`tesstrade_indicators`](tesstrade-indicators.md).

> **How close is "the same"?** The streaming classes are *bit-for-bit*
> identical to the vectorised functions, and both run the kernels the
> chart uses. Against `pandas_ta`, the kernels match to floating-point
> precision under the project's golden-vector tests. Practically: compute
> with `ti` and the chart will not disagree with you.

## The `DECLARATION`, field by field

Only what you need for an indicator is shown here; the full reference
(including strategy-only fields like `entry_conditions`) is in
[The `DECLARATION` shape](../contract/declaration.md).

| Field | Purpose | Notes |
|---|---|---|
| `type` | `"indicator"` (draws plots, no orders) | Use `"strategy"` only if you trade. |
| `inputs` | The tuning surface (params **and** colors) | Declared first. Every runtime-read value must be here. |
| `plots` | Lines/marks to draw | Each needs `name`, `type`, and a `source` key matching `series`. |
| `pane` | Where it draws | `"overlay"`/`"price"` on price; `"new"` for a sub-pane; `"same"` for the active pane. |
| `scale` | Y-axis side | `"left"`/`"right"`/`"none"`. Use `"none"` for overlays, `"right"` for new panes. |
| `levels` | Fixed horizontal lines | e.g. RSI 70/30. `value` required; level colors are 6-hex only. |

### `inputs[]` types

`int`, `float`, `bool`, `color`, `select`, `string` — plus `session`,
`timeframe`, and `symbol` for context-aware controls. (`integer`→`int`,
`number`/`decimal`→`float`, `boolean`→`bool`, `text`→`string` are accepted
aliases.) A `select` needs `options: [{"label": ..., "value": ...}, ...]`.

```python
"inputs": [
    {"name": "period",  "type": "int",    "default": 14, "min": 2, "max": 200, "step": 1},
    {"name": "mult",    "type": "float",  "default": 2.0, "min": 0.1, "max": 5.0, "step": 0.1},
    {"name": "smooth",  "type": "bool",   "default": True},
    {"name": "line_color", "type": "color", "default": "#22D3EE"},
    {"name": "mode",    "type": "select", "default": "fast",
     "options": [{"label": "Fast", "value": "fast"}, {"label": "Slow", "value": "slow"}]},
]
```

Read them back with an explicit cast (the value can arrive as a string):

```python
period = int((params or {}).get("period", 14))
mult   = float((params or {}).get("mult", 2.0))
smooth = bool((params or {}).get("smooth", True))
```

## Overlay vs new pane (decide before you draw)

If the indicator's values share the **price scale** (moving averages,
bands, VWAP), use `"pane": "overlay"`. If they live on their **own scale**
(RSI 0–100, MACD around zero, ATR in absolute price units), use
`"pane": "new"` — otherwise the line collapses onto y=0 on a high-priced
asset and you see a legend chip but no line. Full guidance in
[Panes](panes.md).

## The `series` contract (one line per candle)

The `df=` branch returns `series`, a dict whose keys match each plot's
`source`. Each array must be **exactly `len(df)`**, with `None` (never `0`
or `NaN`) during warm-up. Keys are matched case- and
punctuation-insensitively, but keep `source` and the `series` key
**identical** to avoid surprises. Full rules — types, multi-plot,
histograms, value-driven colors — in
[Plots and `series`](plots-and-series.md).

## Indicator vs strategy

* **Indicator** (`"type": "indicator"`): implements the `df=` branch
  (series for the chart) and the no-arg branch (metadata). It does not
  need an `sdk=` branch.
* **Strategy** (`"type": "strategy"`): also implements the `sdk=` branch
  to place orders per bar. The same "params and colors first" structure
  applies — see [Ready-to-use strategies](../strategies/sma-crossover.md).

## Checklist

* [ ] Colors and param defaults are top-of-file constants.
* [ ] Every tunable value (numbers **and** colors) is a declared `input`.
* [ ] Each `type:"color"` input is **read from `params` and injected**
      into its plot's `color` (colors don't auto-apply).
* [ ] Plot colors are `#RRGGBB` (no 8-digit alpha); `width` (not
      `lineWidth`).
* [ ] Math uses `tesstrade_indicators` where available; otherwise an exact
      reference implementation.
* [ ] Every `series` array is `len(df)` long, `None` during warm-up.
* [ ] `pane`/`scale` match the indicator's value range.
* [ ] The `df=` branch returns `{**DECLARATION (with colors), "series": …}`.

## Next steps

* [Plots and `series`](plots-and-series.md) — the full plotting contract.
* [Panes: overlay vs new pane](panes.md) — where each plot lands.
* [`tesstrade_indicators`](tesstrade-indicators.md) — the native library
  and its streaming classes.
* [Implementing SMA and EMA](implementing-sma-ema.md) /
  [RSI, MACD and Bollinger Bands](rsi-macd-bands.md) — exact math for
  indicators outside the catalogue.
