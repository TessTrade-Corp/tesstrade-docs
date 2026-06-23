# Plots and `series`

For lines, histograms, or areas to appear on the chart, two things are required:

1. Declare the **visual shape** in `DECLARATION["plots"]` (name, type, color, pane).
2. Return the **numeric values** in `series` from the `df=` branch of `main()`.

The key in `series` must correspond to the `source` of the plot (they are matched after a case-insensitive normalization). Keep them identical to be safe; otherwise the frontend draws nothing.

This page is the full plotting contract. It assumes the canonical file
structure from [Anatomy of a custom indicator](./anatomy.md) — **params and
colors first**, math via the shared kernels, one `main()` dispatcher. If you
have not read the keystone yet, start there.

> **Where this is validated.** `DECLARATION` metadata — plot `type`, `color`,
> `pane`, `scale`, levels, input types — is validated and **normalized on the
> frontend** (the study-declaration validator). The Python side returns
> `series` **as-is** and does no shape-checking. That is *why* a malformed
> field (an unknown plot `type`, an 8-digit color, `lineWidth` instead of
> `width`) is silently dropped or defaulted instead of raising: Python never
> sees it as wrong, and the frontend simply discards what it cannot parse.

## Minimum contract

The example below mirrors the keystone's [params-and-colors-first
shape](./anatomy.md#the-params-and-colors-first-rule): the tunable color is a
declared `type:"color"` input, and it is **wired** into the plot via a
`_declaration(params)` helper. A color input does **not** auto-apply — the
script must read `params.get("...")` and inject it into the plot `color`.

```python
import tesstrade_indicators as ti   # same kernels the chart renders with

# 1) COLORS FIRST — one place to retheme the indicator.
COLOR_SMA = "#22D3EE"   # cyan

# 2) PARAM DEFAULT — the math reads this; never a magic number mid-function.
DEFAULT_PERIOD = 14

# 3) DECLARATION — params and colors are the first thing the engine sees.
DECLARATION = {
    "type": "indicator",
    "inputs": [
        {"name": "period", "type": "int", "default": DEFAULT_PERIOD,
         "min": 1, "max": 100, "step": 1},
        {"name": "sma_color", "label": "SMA color", "type": "color",
         "default": COLOR_SMA},
    ],
    "plots": [
        {
            "name": "sma",             # internal name
            "source": "sma",           # must match the key in series
            "type": "line",
            "color": COLOR_SMA,        # 6-digit hex (#RRGGBB), no alpha
            "width": 2,                # use "width", not "lineWidth"
        },
    ],
    "pane": "overlay",
}


def _resolve(params):
    p = params or {}
    return {
        "period": int(p.get("period", DEFAULT_PERIOD)),
        "sma_color": p.get("sma_color", COLOR_SMA),
    }


def _declaration(params):
    """DECLARATION with the user's chosen color wired into the plot.

    A type:"color" input does NOT auto-apply — read it and inject it here.
    """
    cfg = _resolve(params)
    plots = [dict(plot) for plot in DECLARATION["plots"]]  # copy, don't mutate
    plots[0]["color"] = cfg["sma_color"]
    return {**DECLARATION, "plots": plots}


def _build_chart(df, params):
    cfg = _resolve(params)
    closes = df["close"].tolist()
    return {
        **_declaration(params),
        "series": {
            "sma": ti.sma(closes, cfg["period"]),   # parity-true: chart math
        },
    }


def main(df=None, sdk=None, params={}):
    params = params or {}
    if df is not None:
        return _build_chart(df, params)   # chart: full series
    return _declaration(params)           # no args: metadata only
```

> **Why spread `**DECLARATION`?** It forwards every metadata field (`type`,
> `pane`, `scale`, `plots`, `levels`) along with `series`. The older form
> `{"plots": DECLARATION["plots"], "series": {...}}` works for overlay
> indicators, but quietly drops `pane` for oscillators — the line renders
> on the price pane and disappears under the price scale. Always spread the
> full declaration (here via `_declaration(params)`, which also carries the
> wired colors).

## Rules for `series`

### Length = number of candles

Each array in `series` must have **exactly the same length** as `df`. The frontend aligns by index. An array that is shorter or longer misaligns every point.

```python
closes = df["close"].tolist()
sma_array = ti.sma(closes, period)
assert len(sma_array) == len(closes)  # ti.* always returns len == input
```

### `None` during warmup

Before there is enough data to compute, use `None`. The frontend does not draw a point there.

```python
# An SMA of period 14 cannot be computed on the first 13 candles.
[None, None, ..., None, first_sma, ...]
```

**Never use `0` or `NaN` for warmup.** The frontend draws a point at 0 (visually distorted) or breaks on NaN. The kernels in `tesstrade_indicators` already return `None` during warm-up, so you get this for free.

### Accepted types

Each value must be `float` or `None`. Numpy conversions also work (`np.float64`), but **numpy arrays** do not -- convert them with `.tolist()`:

```python
# Wrong
closes_np = np.array(closes)
sma_np = pd.Series(closes_np).rolling(period).mean()
return {"series": {"sma": sma_np}}  # return value must be JSON-serializable

# Correct
return {"series": {"sma": sma_np.tolist()}}   # converts to list
# or
return {"series": {"sma": [float(x) if not pd.isna(x) else None for x in sma_np]}}
```

## Multiple plots

Declare multiple entries in `plots` and return multiple keys in `series`:

```python
DECLARATION = {
    "plots": [
        {"name": "ma_fast", "source": "ma_fast", "type": "line", "color": "#22D3EE", "width": 2},
        {"name": "ma_slow", "source": "ma_slow", "type": "line", "color": "#F59E0B", "width": 2},
        {"name": "volume",  "source": "volume",  "type": "histogram", "color": "#64748B"},
    ],
    "pane": "overlay",
}

def _build_chart(df, params):
    closes = df["close"].tolist()
    volumes = df["volume"].tolist()
    return {
        **DECLARATION,
        "series": {
            "ma_fast": ti.sma(closes, 9),    # parity-true
            "ma_slow": ti.sma(closes, 21),   # parity-true
            "volume":  volumes,              # already has 1 point per candle
        },
    }
```

## Plot types

The validator recognizes **ten** plot types:

`line`, `histogram`, `dots`, `area`, `arrows`, `circles`, `stepline`,
`columns`, `cross`, `priceprofile`.

An unknown `type` drops the **entire** plot (it returns nothing for that
entry), and a plot also needs a valid `name` — so a plot survives only if it
has both a valid `name` and a valid `type`. The common subset you will reach
for:

| `type` | Visual | Typical use |
|---|---|---|
| `"line"` | Continuous line | Moving averages, RSI, VWAP |
| `"stepline"` | Step line (holds level between points) | Bands, discrete levels |
| `"histogram"` | Vertical bars (positive/negative) | MACD hist, Volume |
| `"columns"` | Vertical columns | Volume-style bars |
| `"area"` | Area filled to a baseline | Volume, ATR, fills with alpha |
| `"dots"` | Discrete points | Buy/sell signals |
| `"circles"` | Circles | Pivots, extremes |
| `"arrows"` | Up/down arrows | Signal markers |
| `"cross"` | Cross marks | Sparse markers |
| `"priceprofile"` | Horizontal volume-by-price profile | VPVR / volume profile |

`priceprofile` also accepts the aliases `price_profile`, `volumeprofile`, and
`vpvr` (all normalize to `priceprofile`).

> **Color format.** Prefer **6-digit hex** (`#RRGGBB`) for every plot, level,
> and color input. **8-digit alpha hex (`#RRGGBBAA`) is rejected** and the
> color is dropped (it falls back to a default). For a translucent fill, use
> `"type": "area"` — the renderer applies the fill alpha for you; do not bake
> alpha into the hex. **Level colors are 6-hex only** (no CSS-name fallback).
> Use `"width"`, never `"lineWidth"`/`"line_width"` (those are silently
> ignored and you get the default thickness).

### Histograms with conditional colors

A histogram/`columns` plot can be colored in three ways. Pick **one**:

**1. `colorExpression` — a per-bar JS-like expression.** The string is
evaluated per bar with `value` bound to that bar's number. Best for the
classic green-positive / red-negative split:

```python
{
    "name": "hist",
    "source": "hist",
    "type": "histogram",
    "colorExpression": "value >= 0 ? '#22C55E' : '#EF4444'",
}
```

**2. `colorPositive` / `colorNegative` — a fixed two-color split by sign.**
Equivalent to the expression above but as plain fields. Accepted aliases:
`colorUp`/`colorRising` map to `colorPositive`, and
`colorDown`/`colorFalling` map to `colorNegative`:

```python
{
    "name": "hist",
    "source": "hist",
    "type": "histogram",
    "colorPositive": "#22C55E",   # alias: colorUp / colorRising
    "colorNegative": "#EF4444",   # alias: colorDown / colorFalling
}
```

**3. `colorSeries` — a fully data-driven per-bar array of colors.** When the
color is not a simple function of sign (e.g. MACD's four-state coloring, or a
heatmap), return one `#RRGGBB` per bar, the same length as the values series
(alias: `color_series`):

```python
def _build_chart(df, params):
    macd, signal, hist = ti.macd(df["close"].tolist())
    # Four-state MACD coloring: rising/falling above & below zero.
    colors = []
    prev = None
    for h in hist:
        if h is None:
            colors.append("#64748B")           # warm-up / neutral
        elif h >= 0:
            colors.append("#16A34A" if (prev is None or h >= prev) else "#86EFAC")
        else:
            colors.append("#DC2626" if (prev is None or h <= prev) else "#FCA5A5")
        prev = h
    return {
        **DECLARATION,
        "series": {"hist": hist},
        "plots": [{
            "name": "hist", "source": "hist", "type": "histogram",
            "colorSeries": colors,             # alias: color_series
        }],
    }
```

If you set none of these, leave a single `color` and the frontend paints every
bar that one color.

A histogram baseline can be moved with `base` (alias `histbase`); the first
declared `level` also defines the baseline for `"type": "area"` plots.

### Dots for visual signals

When you want to mark specific points (not a continuous series), fill only the relevant indices and leave the rest as `None`:

```python
closes = df["close"].tolist()
signals = [None] * len(closes)
for i in range(1, len(closes)):
    if closes[i] > closes[i-1] * 1.02:  # spike
        signals[i] = closes[i]

return {**DECLARATION, "series": {"spike_marker": signals}}
```

In the `DECLARATION`:
```python
{"name": "spike_marker", "source": "spike_marker", "type": "dots", "color": "#22C55E"}
```

## Reusing the same computation for plots and trading

Idiomatic pattern: the `df=` branch builds the entire series (for the chart)
via the **parity-true** kernels, and the `sdk=` branch computes just the latest
value per bar. For catalogue indicators, prefer `tesstrade_indicators` on both
sides — what you compute equals what the chart draws.

```python
import tesstrade_indicators as ti


def _build_chart(df, params):
    period = int((params or {}).get("period", 14))
    closes = df["close"].tolist()
    return {
        **DECLARATION,
        "series": {
            "sma": ti.sma(closes, period),   # full series, same kernel as chart
            "rsi": ti.rsi(closes, period),
        },
    }


def _last_sma(values, period):
    """Last point only — cheap helper for on_bar when you don't need a class."""
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def on_bar_strategy(sdk, params):
    period = int((params or {}).get("period", 14))
    closes = [c["close"] for c in sdk.candles]
    # Hand-rolled last point is fine for SMA; for EMA/RSI/ATR/MACD prefer the
    # streaming classes (ti.Ema/ti.Rsi/ti.Atr/ti.Macd) so the per-bar value is
    # bit-for-bit identical to the vectorised series above.
    sma = _last_sma(closes, period)
    if sma is None:
        return
    # ... trading logic
```

> **Parity, honestly.** `tesstrade_indicators` calls the **same
> `tesstrade_core` kernels the chart renders with**, so the series you return
> and the line the chart draws come from one code path. The streaming classes
> are **bit-for-bit identical** to the vectorised functions; the PyO3 study
> series agree with the subprocess path to **&lt; 1e-12**; and against
> `pandas_ta` the kernels match to floating-point precision under the
> project's golden-vector tests (per-indicator tolerances, not a blanket
> `1e-9`). For anything outside the six-function catalogue, hand-roll the math
> (see the references below) or use `pandas_ta`.

## Common errors

* **Plot does not appear:** check `source` of the plot against the key in `series`. The two are matched after normalization (trimmed, lowercased, non-alphanumeric runs collapsed to `_`), so it is **not** case-sensitive — `source: "ma_fast"` matches a series key `ma_fast`, `MA Fast`, or `ma fast`. If two keys normalize to the same thing, the later one wins. Keep them identical to avoid surprises.
* **Whole plot vanished:** an **unknown `type`** drops the entire plot, and a plot also needs a valid `name`. Stick to the ten valid types above.
* **Legend chip shows but the line is invisible:** the indicator declares no `pane` (or `pane: "overlay"`) but its values live in a different scale than price (RSI 0–100, MACD around zero, Aroon -100..+100). On a high-priced asset, the line collapses against y=0. Add `"pane": "new"` and `"scale": "right"` to the DECLARATION.
* **Width or color silently ignored:** use `"width": 2` (not `"lineWidth"`) and `"#RRGGBB"` (not `"#RRGGBBAA"`). 8-digit hex with alpha is rejected by the validator. For translucency use `"type": "area"`; transparency is applied automatically.
* **Color picker does nothing:** a `type:"color"` input does not auto-apply. Read `params.get("<name>")` and inject it into the plot's `color` in your `_declaration(params)` helper (see the [keystone](./anatomy.md#colors-do-not-auto-apply--wire-them)).
* **Misaligned line:** the series array has a length different from `len(df)`. Use `None` for warmup instead of omitting.
* **All-gray histogram:** no per-bar coloring set. Add `colorExpression`, `colorPositive`/`colorNegative`, or `colorSeries`, or accept a single color.
* **Plot "jumping" between points:** `None` in the middle of the series (after warmup). The frontend interprets it as a break. For continuous lines, ensure a dense computation.
* **Reference levels (0, 70, 30) coded as constant series:** prefer the `"levels"` field of the DECLARATION. Levels keep their own scale-aware rendering, take 6-hex colors only, and the first level also defines the baseline for `"type": "area"` plots.

## Next steps

* [Anatomy of a custom indicator](./anatomy.md) — the canonical file structure (params and colors first).
* [Implementing SMA and EMA](implementing-sma-ema.md) -- implementations without pandas_ta.
* [RSI, MACD and Bollinger Bands](rsi-macd-bands.md) -- composite indicators.
* [Panes: overlay vs new pane](panes.md) -- where each plot appears.
* [`tesstrade_indicators`](tesstrade-indicators.md) -- the native library and its streaming classes.
