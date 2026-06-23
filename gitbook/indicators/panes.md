# Panes: overlay vs new pane

Each plot has a visual destination: it appears **over the price chart** (overlay) or in a **separate pane below** (new pane). The choice depends on the indicator's scale.

> This page is focused on *where* a plot lands. For the full canonical
> shape — **params and colors first**, the dispatcher, and the math —
> follow [Anatomy of a custom indicator](anatomy.md). Every declaration
> below mirrors that keystone.

## Rule of thumb

| Indicator type | Pane | Reason |
|---|---|---|
| Moving averages (SMA, EMA, VWAP) | `"overlay"` | Scale matches the price |
| Bollinger Bands | `"overlay"` | Same scale as price |
| Donchian channels, pivots | `"overlay"` | Price levels |
| RSI, Stochastic | `"new"` | 0-100 scale, incompatible with price |
| MACD, Histogram | `"new"` | Scale oscillates around zero |
| Volume | `"new"` | Completely different scale |
| ATR | `"new"` | Absolute volatility scale |

## Accepted values

`pane` has **exactly four** valid values — anything else is rejected by the validator:

```python
"pane": "overlay"   # over the price chart (default)
"pane": "price"     # synonym of "overlay"
"pane": "new"       # dedicated new pane below
"pane": "same"      # uses the active pane (useful in composed scripts)
```

There is no per-plot pane: `pane` lives at the **root** of the
`DECLARATION`, so every plot in one script shares one pane.

## Examples

Each declaration keeps **params and colors at the top**, the way the
[anatomy keystone](anatomy.md) prescribes. Remember the sharp edge a
`type:"color"` input does **not** auto-recolor a plot — you must read
`params.get("<name>")` and inject it into the plot's `color`.

### Overlay: moving averages over price

```python
import tesstrade_indicators as ti   # same kernels the chart renders with

COLOR_SMA = "#22D3EE"   # cyan
DEFAULT_PERIOD = 20

DECLARATION = {
    "type": "indicator",
    # PARAMS + COLORS FIRST — the whole tuning surface, before any math.
    "inputs": [
        {"name": "period", "type": "int", "default": DEFAULT_PERIOD,
         "min": 1, "max": 200, "step": 1},
        {"name": "line_color", "type": "color", "default": COLOR_SMA},
    ],
    "plots": [
        {"name": "sma", "source": "sma", "type": "line",
         "color": COLOR_SMA, "width": 2},
    ],
    "pane": "overlay",   # drawn together with the candles
    "scale": "none",     # inherit the price scale
}


def _declaration(params):
    # A color input is NOT auto-applied — read it and wire it into the plot.
    color = (params or {}).get("line_color", COLOR_SMA)
    plots = [dict(p) for p in DECLARATION["plots"]]
    plots[0]["color"] = color
    return {**DECLARATION, "plots": plots}


def main(df=None, sdk=None, params={}):
    params = params or {}
    if df is not None:
        period = int(params.get("period", DEFAULT_PERIOD))
        closes = df["close"].tolist()
        return {**_declaration(params), "series": {"sma": ti.sma(closes, period)}}
    return _declaration(params)
```

Result: a moving average over the price chart, in the user's chosen color
because `line_color` is wired into the plot.

### New pane: RSI in a dedicated pane

An oscillator on a 0-100 scale **must** use `"pane": "new"`. On a
high-priced asset (Bitcoin at 50000) an RSI left on the price pane
collapses onto y=0 — you get a legend chip but no visible line.

```python
import tesstrade_indicators as ti

COLOR_RSI = "#A78BFA"   # violet
DEFAULT_PERIOD = 14

DECLARATION = {
    "type": "indicator",
    # PARAMS + COLORS FIRST.
    "inputs": [
        {"name": "period", "type": "int", "default": DEFAULT_PERIOD,
         "min": 2, "max": 100, "step": 1},
        {"name": "line_color", "type": "color", "default": COLOR_RSI},
    ],
    "plots": [
        {"name": "rsi", "source": "rsi", "type": "line",
         "color": COLOR_RSI, "width": 2},
    ],
    "pane": "new",       # separate pane — required for a 0-100 oscillator
    "scale": "right",    # most oscillators read better on the right
    "levels": [
        {"name": "Overbought", "value": 70, "color": "#EF4444", "style": "dashed"},
        {"name": "Midline",    "value": 50, "color": "#64748B", "style": "dotted"},
        {"name": "Oversold",   "value": 30, "color": "#22C55E", "style": "dashed"},
    ],
}


def _declaration(params):
    # Wire the color input into the plot — it does not apply on its own.
    color = (params or {}).get("line_color", COLOR_RSI)
    plots = [dict(p) for p in DECLARATION["plots"]]
    plots[0]["color"] = color
    return {**DECLARATION, "plots": plots}


def main(df=None, sdk=None, params={}):
    params = params or {}
    if df is not None:
        period = int(params.get("period", DEFAULT_PERIOD))
        closes = df["close"].tolist()
        return {**_declaration(params), "series": {"rsi": ti.rsi(closes, period)}}
    return _declaration(params)
```

Result: a pane below the price chart, with the RSI line in the chosen
color and three fixed levels (70, 50, 30).

### New pane: MACD with three plots

MACD oscillates around zero, so it also lives in `"pane": "new"`. The
periods and colors are declared first; the full per-plot color wiring
follows the same pattern as above (see [anatomy](anatomy.md) for the
complete multi-color `_declaration` that injects each picked color).

```python
import tesstrade_indicators as ti

COLOR_MACD   = "#22D3EE"   # cyan
COLOR_SIGNAL = "#F59E0B"   # amber
COLOR_HIST   = "#94A3B8"   # slate

DECLARATION = {
    "type": "indicator",
    # PARAMS + COLORS FIRST — periods and the three line colors.
    "inputs": [
        {"name": "fast",   "type": "int", "default": 12, "min": 1, "max": 200, "step": 1},
        {"name": "slow",   "type": "int", "default": 26, "min": 2, "max": 400, "step": 1},
        {"name": "signal", "type": "int", "default": 9,  "min": 1, "max": 100, "step": 1},
        {"name": "macd_color",   "type": "color", "default": COLOR_MACD},
        {"name": "signal_color", "type": "color", "default": COLOR_SIGNAL},
    ],
    "plots": [
        {"name": "macd",        "source": "macd",        "type": "line",      "color": COLOR_MACD,   "width": 2},
        {"name": "signal_line", "source": "signal_line", "type": "line",      "color": COLOR_SIGNAL, "width": 2},
        {"name": "hist",        "source": "hist",        "type": "histogram", "color": COLOR_HIST},
    ],
    "pane": "new",       # oscillates around zero — own pane
    "scale": "right",
    "levels": [
        {"name": "Zero", "value": 0, "color": "#64748B", "style": "dotted"},
    ],
}


def _declaration(params):
    p = params or {}
    plots = [dict(plot) for plot in DECLARATION["plots"]]
    plots[0]["color"] = p.get("macd_color", COLOR_MACD)      # line colors are
    plots[1]["color"] = p.get("signal_color", COLOR_SIGNAL)  # read + injected,
    return {**DECLARATION, "plots": plots}                   # never auto-applied


def main(df=None, sdk=None, params={}):
    params = params or {}
    if df is not None:
        p = params
        macd, signal, hist = ti.macd(
            df["close"].tolist(),
            fast=int(p.get("fast", 12)),
            slow=int(p.get("slow", 26)),
            signal=int(p.get("signal", 9)),
        )
        return {**_declaration(params),
                "series": {"macd": macd, "signal_line": signal, "hist": hist}}
    return _declaration(params)
```

All three plots share the same new pane (because `pane` is at the root
level of the DECLARATION, not on each plot). `ti.macd` returns three
parallel lists — `(macd, signal, hist)` — straight from the kernels the
chart renders with.

## Customizing the scale

The `scale` key controls which side the Y axis of the pane appears on. It
has **exactly three** valid values:

| Value | Effect |
|---|---|
| `"right"` | Scale on the right side (default on the price chart) |
| `"left"` | Scale on the left side (useful when you already have something on the right) |
| `"none"` | No visible Y axis |

For an overlay over price, set `"scale": "none"` — the price scale is
already rendered.

```python
"pane": "overlay",
"scale": "none",   # moving averages inherit the price scale
```

## Levels: fixed horizontal lines

`levels` draws **fixed** horizontal lines that do not change with the data. Suitable for overbought/oversold, theoretical pivots, and global take-profits.

```python
"levels": [
    {"name": "TP 10%",    "value": 110.0, "color": "#22C55E", "style": "dashed"},
    {"name": "Break-Even","value": 100.0, "color": "#64748B", "style": "solid"},
    {"name": "Stop -5%",  "value": 95.0,  "color": "#EF4444", "style": "dashed"},
],
```

Level colors are **6-digit hex only** (`#RRGGBB`); CSS names and 8-digit
alpha are not honored on levels. In the context of an RSI, levels go in
the same pane as the plot (`pane: "new"`). In the context of overlay over
price, they are drawn on top of the candles.

## Plots in different panes (advanced)

Current support is **one pane per DECLARATION**. For plots in separate panes (for example, moving averages on the overlay and RSI in a new pane within the same script), create two scripts: one for the overlay indicator and another for the RSI.

For combined strategies (logic in a single script), keep all plots in the same pane and use `levels` to mark reference points.

## Combining plots: histogram and line

It is common to want a line **and** a histogram in the same pane. Classic example: MACD + signal line + histogram:

```python
"plots": [
    {"name": "macd",        "source": "macd",        "type": "line",      "color": "#22D3EE", "width": 2},
    {"name": "signal_line", "source": "signal_line", "type": "line",      "color": "#F59E0B", "width": 2},
    {"name": "hist",        "source": "hist",        "type": "histogram", "color": "#94A3B8"},
],
"pane": "new",
```

The frontend renders in declaration order: first the macd line (behind),
then signal line, then histogram (on top). To prevent the histogram from
hiding the lines, keep the histogram last. For a translucent fill use a
`"type": "area"` plot — the renderer applies the fill alpha for you
(8-digit `#RRGGBBAA` colors are dropped, so do not encode transparency in
the hex). Use `width` for line thickness; `lineWidth` is silently ignored.

## Value-driven colors (two-color histograms)

For green-positive and red-negative histograms without two series, use `colorExpression`:

```python
{
    "name": "hist",
    "source": "hist",
    "type": "histogram",
    "colorExpression": "value >= 0 ? '#22C55E' : '#EF4444'",
}
```

The expression is evaluated per value: each bar may have its own color.

## Common errors

* **Plot in the right pane but not appearing:** check the `source` (key in `series`) and the length of the series.
* **RSI in overlay over price:** price may be at 50000 (Bitcoin) and the RSI at 70. The RSI becomes a flat line glued to zero. Use `"pane": "new"`.
* **Color picker shows but the line never changes:** a `type:"color"` input is not auto-applied. Read `params.get("<name>")` and inject it into the plot's `color` (see the examples above and [anatomy](anatomy.md)).
* **Levels not appearing:** make sure `levels` is at the root of the DECLARATION, not inside a plot.
* **New pane without scale:** if `scale` is omitted, the frontend tries to pick one, with inconsistent results. Pass `"scale": "left"` or `"right"` explicitly for new panes.

## Next steps

* [Anatomy of a custom indicator](anatomy.md) -- the canonical params-and-colors-first shape every example here mirrors.
* [Plots and series](plots-and-series.md) -- the complete plotting contract.
* [Implementing indicators](implementing-sma-ema.md) -- code for the series.
* [DECLARATION](../contract/declaration.md) -- every field of the shape.
