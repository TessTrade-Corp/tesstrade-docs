# The `DECLARATION` shape

`DECLARATION` is the **metadata dictionary** that describes your strategy to the engine and to the UI:

* Which parameters the user can edit.
* Which lines appear on the chart (and on which pane).
* Which canonical entry and exit conditions apply (if you use declarative mode).

It is a constant at the root level of your script:

```python
DECLARATION = {
    "type": "strategy",
    "inputs": [...],
    "plots": [...],
    "pane": "overlay",
    "scale": "none",
}
```

And it is returned by `main()` when the engine calls it with no arguments:

```python
def main(df=None, sdk=None, params={}):
    # ...
    return DECLARATION
```

> **Authoring an indicator?** This page is the *field-by-field reference*. The
> **canonical structure** every indicator should mirror — colors and params at
> the top, math reading them back, colors explicitly wired into plots — lives in
> [Anatomy of a custom indicator](../indicators/anatomy.md). Read that first; use
> this page to look up exact field names, types, and aliases.

---

## Where the contract is validated

`DECLARATION` metadata is validated and **normalized on the frontend** (the
study-declaration validator), not in Python. The practical consequences:

* **Unknown fields, unknown `type` values, and malformed colors are silently
  dropped.** An invalid color becomes `undefined`; an unknown `plot.type` drops
  the *whole* plot; an unknown `input.type` is discarded. Nothing raises — your
  control or line just doesn't appear.
* **Series keys are matched *after* normalization.** The Python backend returns
  `series` as-is (case-sensitive); the frontend normalizes both the `series`
  keys and each `plot.source` (lowercase, diacritics stripped, punctuation →
  `_`) and matches the normalized forms. `"MACD_Line"`, `"RSI 14"` and
  `"fast-EMA"` normalize to `macd_line`, `rsi_14`, `fast_ema`. Keep the
  `series` key and the plot `source` **identical** to avoid surprises, and note
  that if two keys normalize to the same string the later one overwrites the
  earlier.

---

## Root-level fields

| Field | Required | Values | Description |
|---|---|---|---|
| `type` | Recommended | `"strategy"` \| `"indicator"` | `"strategy"` emits orders; `"indicator"` only draws plots. If omitted, the engine infers it from the presence of `entry_conditions`. |
| `inputs` | Yes | `list[dict]` | Editable parameters. |
| `plots` | No | `list[dict]` | Lines / marks to draw. Only required if the script returns `series` on the `df=` branch. |
| `pane` | No | `"overlay"` \| `"new"` \| `"price"` \| `"same"` | Where the plot appears. Default: `"overlay"` (on top of price). |
| `scale` | No | `"left"` \| `"right"` \| `"none"` | Which side the Y axis is drawn on. Default when omitted: `"right"`. Set `"none"` on overlays so the plot inherits the price scale. |
| `levels` | No | `list[dict]` | Fixed horizontal lines (for example, 70/30 on RSI). |
| `alerts` | No | `list[dict]` | User-configurable alerts. |
| `entry_conditions` | No | `list[dict]` | Entry conditions for declarative mode (opt-in runtime fallback — see [Exclusivity rule](#exclusivity-rule) below). |
| `exit_conditions` | No | `list[dict]` | Exit conditions for declarative mode. |

Accepted aliases: `entryConditions` / `entry_conditions`, `exitConditions` / `exit_conditions`, `study_type` / `type`.

---

## `inputs[]` - editable parameters

Each entry describes a control that appears in the configuration panel:

```python
{
    "name": "fast_period",          # REQUIRED - key in sdk.params
    "label": "Fast MA",             # optional - title shown in the UI
    "description": "Short period",  # optional - tooltip
    "type": "int",                  # REQUIRED - see "Supported types" below
    "default": 9,                   # initial value
    "min": 1,                       # minimum (int, float)
    "max": 100,                     # maximum (int, float)
    "step": 1,                      # stepper increment
}
```

### Supported types

The validated input types are: `int`, `float`, `bool`, `color`, `select`,
`string`, **`session`**, **`timeframe`**, and **`symbol`** (the last three for
context-aware controls).

| `type` | Example |
|---|---|
| `"int"` | `{"name": "period", "type": "int", "default": 14, "min": 1, "max": 200, "step": 1}` |
| `"float"` | `{"name": "risk", "type": "float", "default": 0.02, "min": 0.0, "max": 1.0, "step": 0.01}` |
| `"bool"` | `{"name": "use_volume", "type": "bool", "default": True}` |
| `"color"` | `{"name": "line_color", "type": "color", "default": "#22D3EE"}` |
| `"string"` | `{"name": "note", "type": "string", "default": "demo"}` |
| `"select"` | `{"name": "mode", "type": "select", "default": "fast", "options": [{"label": "Fast", "value": "fast"}, {"label": "Slow", "value": "slow"}]}` |
| `"session"` | `{"name": "rth", "type": "session", "default": "0930-1600"}` |
| `"timeframe"` | `{"name": "htf", "type": "timeframe", "default": "1h"}` |
| `"symbol"` | `{"name": "compare", "type": "symbol", "default": "SPY"}` |

A `"select"` requires `options: [{"label": ..., "value": ...}, ...]`.

**Accepted type aliases** (normalized for you): `integer` → `int`,
`number`/`decimal` → `float`, `boolean` → `bool`, `text` → `string`.

> **Reserved, not yet rendered:** `source`, `price`, and `time` are declared in
> the contract but are **not yet validated or rendered**. Do **not** use them —
> they are silently dropped today.

### Access from Python

The values typed in the UI arrive in `sdk.params` (tick by tick) or in the `params` argument of `main()`. Convert them explicitly to the expected type - the engine may deliver a string depending on the input.

```python
fast = int((params or {}).get("fast_period", 9))
risk = float((params or {}).get("risk", 0.02))
use_volume = bool((params or {}).get("use_volume", True))
```

**Critical rule:** every parameter you read must be listed in `inputs`. If it is not, the value edited in the UI **does not reach the runtime** - the script falls back to the hard-coded default.

### Color inputs do NOT auto-apply — you must wire them

> **CRITICAL.** A `type:"color"` input only renders a color picker and stores
> the picked value in `params` under its `name`. It does **not** automatically
> recolor any plot. There is **no name-matching magic** — an input named
> `fast_color` is *not* auto-bound to a plot named `ma_fast`. To honor the
> user's choice you must **read `params.get("<name>")` and inject it into the
> plot's `color`** in the declaration you return. See the wiring pattern in
> [Anatomy of a custom indicator](../indicators/anatomy.md#colors-do-not-auto-apply-wire-them).

```python
# WRONG — picker shows, but the line stays cyan no matter what the user picks.
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
    plots = [dict(p) for p in DECLARATION["plots"]]  # copy, don't mutate
    plots[0]["color"] = color
    return {**DECLARATION, "plots": plots}
```

---

## `plots[]` - chart lines

Each plot has a data series (in `series`, returned by the `df=` branch) and visual metadata:

```python
{
    "name": "ma_fast",          # REQUIRED - key in series
    "title": "SMA 9",           # optional - legend
    "source": "ma_fast",        # REQUIRED - key in series (usually equal to name)
    "type": "line",             # REQUIRED - omitting or using an invalid type drops the whole plot; see "Plot types"
    "color": "#22D3EE",         # 6-digit hex only (#RRGGBB), no alpha
    "width": 2,                 # pixels (use "width", not "lineWidth")
    "style": "solid",           # "solid" | "dashed" | "dotted"
    "visible": True,
}
```

> **Field name notes:**
> * `width` is the canonical spelling — `lineWidth`/`line_width` are silently
>   ignored by the normalizer, so the line falls back to the default thickness.
> * `color` accepts only **6-digit hex** (`#RRGGBB`). Alpha-prefixed forms
>   like `#RRGGBBAA` are rejected and dropped. For semi-transparent fills, use
>   `"type": "area"` and let the renderer apply the standard fill alpha
>   automatically.
> * A plot requires **both** a valid `name` **and** a valid `type`, or the
>   whole plot is dropped. An unknown `type` drops the plot too.

**The contract between `plots` and `series`:**

```python
# In DECLARATION:
"plots": [{"name": "ma_fast", "source": "ma_fast", "type": "line", "color": "#22D3EE"}]

# In the return value of _build_chart(df, params):
return {
    "plots": [...],
    "series": {
        "ma_fast": [None, None, ..., 100.5, 101.2, 102.3],  # same length as candles
    },
}
```

The key `"ma_fast"` in `series` must match the plot's `source` (after
normalization). Keep them identical to avoid surprises.

### Plot types

The 10 valid plot types:

| `type` | Visual | Typical use |
|---|---|---|
| `"line"` | Continuous line | Moving averages, RSI |
| `"histogram"` | Vertical bars | MACD histogram, volume |
| `"dots"` | Discrete dots | Signals, events |
| `"area"` | Filled area (with alpha) | Bands, ATR, translucent fills |
| `"arrows"` | Up/down arrows | Signal markers |
| `"circles"` | Circles | Pivots |
| `"stepline"` | Stepped line | Discrete levels |
| `"columns"` | Vertical columns | Volume-style bars |
| `"cross"` | Cross markers | Point markers |
| `"priceprofile"` | Horizontal volume/price profile | VPVR, volume profile |

The `priceprofile` type accepts the aliases `price_profile`, `volumeprofile`,
and `vpvr` (all normalize to `priceprofile`).

### Histogram coloring

Histograms (and other bar-style plots) support per-bar two-color rendering, in
increasing order of control:

* **`colorExpression`** — a per-bar JS-like expression evaluated against each
  value, e.g. `"value >= 0 ? '#22C55E' : '#EF4444'"`. Best for "green above
  zero, red below".
* **`colorPositive` / `colorNegative`** — split colors for non-negative vs
  negative values. Accepted aliases: `colorUp`/`colorRising` → `colorPositive`,
  `colorDown`/`colorFalling` → `colorNegative`.
* **`colorSeries`** (alias `color_series`) — a per-bar array of `#RRGGBB`
  colors, exactly `len(df)` long, for fully data-driven coloring.

```python
{
    "name": "macd_hist",
    "source": "macd_hist",
    "type": "histogram",
    "colorPositive": "#22C55E",   # green when value >= 0
    "colorNegative": "#EF4444",   # red when value < 0
    "pane": "new",
}
```

The plot base alias `histbase` → `base` is also accepted.

---

## `pane` - where the plot appears

| Value | Meaning |
|---|---|
| `"overlay"` | On top of the price chart (default). Used for moving averages, bands, VWAP. |
| `"price"` | Synonym for `"overlay"`. |
| `"same"` | On the current pane (useful when you are already on a separate pane). |
| `"new"` | Creates a new pane below the chart. Used for RSI, MACD, volume. |

For an oscillator such as RSI, you declare `"pane": "new"` and the frontend creates a dedicated subchart.

> **Critical for oscillators:** if your indicator's value range is unrelated
> to the asset's price scale (RSI 0–100, MACD around zero, Aroon Osc -100..+100,
> ATR in price-unit absolute), it **must** declare `"pane": "new"`. Without it,
> the line renders on the price pane — and on a high-priced asset (BTC ~78k),
> a value of 70 maps to a y-coordinate flush with zero, off-screen. The legend
> chip appears, but the line is invisible. See [Panes](../indicators/panes.md).

---

## `levels[]` - horizontal lines

Useful for marking fixed levels (RSI 70/30, pivot points).

```python
"levels": [
    {"name": "Overbought", "value": 70, "color": "#EF4444", "style": "dashed"},
    {"name": "Oversold",   "value": 30, "color": "#22C55E", "style": "dashed"},
],
```

Fields: `value` (required), `name`, `color`, `width`, `style`, `visible`.

> **Level colors are 6-digit hex only** (`#RRGGBB`) — there is no CSS-name
> fallback for levels (unlike plot `color`, which also tolerates CSS names).
> Stick to `#RRGGBB` everywhere.

---

## `entry_conditions[]` / `exit_conditions[]` (declarative mode)

An alternative to the manual `on_bar_strategy`. You declare the conditions and the engine executes them:

```python
"entry_conditions": [
    {
        "name": "Buy",
        "source": "ma_fast",         # key in series
        "operator": "crosses_above",
        "target": "ma_slow",         # another key in series, OR
        "value": None,               # a constant value
        "action": "buy_to_open",
        "enabled": True,
    },
],
"exit_conditions": [
    {
        "name": "Exit",
        "source": "ma_fast",
        "operator": "crosses_below",
        "target": "ma_slow",
        "action": "sell_to_close",
        "enabled": True,
    },
],
```

### Supported operators

| Operator | Meaning |
|---|---|
| `crosses_above` | Source crossed above target (on the last bar) |
| `crosses_below` | Source crossed below target |
| `crosses` | Any crossing |
| `greater_than` / `>` | Source > target |
| `greater_or_equal` / `>=` | Source >= target |
| `less_than` / `<` | Source < target |
| `less_or_equal` / `<=` | Source <= target |
| `equals` / `==` | Source = target |

### Accepted actions

The same 7 canonical actions described in [Canonical actions](../sdk-reference/actions.md): `buy_to_open`, `sell_short_to_open`, `sell_to_close`, `buy_to_cover`, `close_position`, `reverse_position`, `update_position_exits`.

### Exclusivity rule

Declarative `entry_conditions` / `exit_conditions` are **opt-in**. By default the engine runs your `on_bar_strategy` / `main(sdk=...)` logic per closed bar and **ignores** the declarative conditions (it prints a warning). To have the engine evaluate the declarative conditions, set `params["runtime_declarative_fallback"] = True`. So `on_bar_strategy` and declarative conditions are **not** mutually exclusive — when the fallback is off (the default), the manual code wins.

---

## Complete example - SMA crossover (colors first, wired)

Mirroring the [keystone structure](../indicators/anatomy.md): **colors → params
→ declaration → math → dispatcher**. The two color inputs are declared at the
top, *and* explicitly injected into the plots — because a `type:"color"` input
never auto-applies. The math uses [`tesstrade_indicators`](../indicators/tesstrade-indicators.md),
so the moving averages computed here are the **same kernels the chart renders
with**.

```python
import tesstrade_indicators as ti   # same kernels the chart renders with

# 1) COLORS FIRST — one place to retheme; mirrored into input defaults below.
COLOR_FAST = "#22D3EE"   # cyan
COLOR_SLOW = "#F59E0B"   # amber

# 2) PARAM DEFAULTS — the math reads these; never a magic number mid-function.
DEFAULT_FAST = 9
DEFAULT_SLOW = 21

# 3) DECLARATION — params and colors are the FIRST thing the engine sees.
DECLARATION = {
    "type": "strategy",
    "inputs": [
        # Tunable numbers...
        {"name": "fast_period", "label": "Fast MA", "type": "int",
         "default": DEFAULT_FAST, "min": 1, "max": 100, "step": 1},
        {"name": "slow_period", "label": "Slow MA", "type": "int",
         "default": DEFAULT_SLOW, "min": 2, "max": 200, "step": 1},
        # ...and tunable colors, declared right next to them.
        {"name": "fast_color", "label": "Fast color", "type": "color",
         "default": COLOR_FAST},
        {"name": "slow_color", "label": "Slow color", "type": "color",
         "default": COLOR_SLOW},
    ],
    "plots": [
        {"name": "ma_fast", "title": "Fast SMA", "source": "ma_fast",
         "type": "line", "color": COLOR_FAST, "width": 2},
        {"name": "ma_slow", "title": "Slow SMA", "source": "ma_slow",
         "type": "line", "color": COLOR_SLOW, "width": 2},
    ],
    "pane": "overlay",
    "scale": "none",
    "entry_conditions": [
        {"name": "Buy", "source": "ma_fast", "operator": "crosses_above",
         "target": "ma_slow", "action": "buy_to_open", "enabled": True},
    ],
    "exit_conditions": [
        {"name": "Exit", "source": "ma_fast", "operator": "crosses_below",
         "target": "ma_slow", "action": "sell_to_close", "enabled": True},
    ],
}


# 4) MATH SECOND — read params once, with safe casts and defaults.
def _resolve(params):
    p = params or {}
    return {
        "fast": int(p.get("fast_period", DEFAULT_FAST)),
        "slow": int(p.get("slow_period", DEFAULT_SLOW)),
        "fast_color": p.get("fast_color", COLOR_FAST),
        "slow_color": p.get("slow_color", COLOR_SLOW),
    }


def _declaration(params):
    """DECLARATION with the user's chosen colors wired into the plots.

    A type:"color" input does NOT auto-apply — read it and inject it here.
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
        **_declaration(params),   # spread the colors-applied declaration
        "series": {
            "ma_fast": ti.sma(closes, cfg["fast"]),  # None during warm-up
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

When the engine calls `main()` with no arguments, you return the declaration
**with colors applied** (`_declaration(params)`). When it calls with `df=`, the
canonical pattern is to spread that same declaration into the return so every
metadata field — `type`, `pane`, `scale`, `plots` (colors and all), `levels`,
`entry_conditions`, … — travels with the data:

```python
def _build_chart(df, params):
    # ... compute series ...
    return {
        **_declaration(params),
        "series": {"ma_fast": [...], "ma_slow": [...]},
    }
```

The spread propagates the full object in one shot. This is more robust than the
older `{"plots": DECLARATION["plots"], "series": {...}}` form, which only
forwards `plots`, drops `pane` (fatal for oscillators), and bypasses your color
wiring.

> **Parity, honestly.** `ti.sma`/`ti.ema`/… call the **same `tesstrade_core`
> kernels** the live chart renders with, so what you compute here equals what
> the chart draws (same code path). The streaming classes are *bit-for-bit*
> identical to the vectorised functions; PyO3 vs subprocess chart series agree
> to `< 1e-12`; and against `pandas_ta` the kernels match to floating-point
> precision under golden-vector tests with per-indicator tolerances. Only the
> 6 vectorised (`sma`, `ema`, `wma`, `rsi`, `atr`, `macd`) + 6 streaming
> (`Sma`, `Ema`, `Wma`, `Rsi`, `Atr`, `Macd`) functions are exposed to the
> sandbox — for anything else, hand-roll the math or use `pandas_ta`. Details
> in [`tesstrade_indicators`](../indicators/tesstrade-indicators.md).
