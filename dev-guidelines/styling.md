# Styling

One file, `css/style.css` (~1660 lines), plain CSS — no preprocessor, no CSS-in-JS. Line numbers below verified directly against the file; re-check them if the file has grown/shrunk a lot since.

## Design tokens (`:root`, lines 5–47)

| Token | Value | Purpose |
|---|---|---|
| `--bg` | `#f8f8f8` | Global page background |
| `--black` / `--white` | `#000` / `#fff` | Primary ink/light colors |
| `--category-col` | `#777777` | Secondary/muted text — category labels, metadata, prose |
| `--black-bg` | `#1a1a1a` | "Near-black" dark surface, shared exactly by the select button's hover state, the size modal's confirm button, and the floating selection bar |
| `--selection-bar-height` | `3.5rem` | Used by exactly two rules that must stay in sync: `.selection-bar__summary`'s own height (line 1450) and `body`'s reserved bottom padding (line 102, via `body:has(.selection-bar)`) — a CSS-internal contract, not read from JS |
| `--font-secondary` | Geist Mono (Google Fonts) | Nav category rubrics and other mono usages |
| `--font-main` | "DINish", sans-serif fallback | Everything else — see the `@font-face` note below, this can silently fail to load |
| `--max` | `1440px` | Site-wide content max-width cap |
| `--edge-px` | `clamp(20px, 2.5vw, 28px)` | The single horizontal edge-inset used everywhere content is padded away from the true screen edge — header, selection bar, size modal, section heads, product grid, footer, product detail all share this one token |
| `--reveal-pin-height` | `100vh` | Root-scoped (not scoped to `.reveal`) because `.reveal__extension-crop` in the sibling `.products` section also needs it |

## Known issue: `@font-face` (line 48) is malformed

```css
src: url("../assets/fonts/dinish-woff2/DINish-Regular.woff2") format("woff2"),;
```

Trailing comma with nothing after it — invalid CSS. Depending on the browser's error recovery this can cause the whole `src` declaration (and possibly the whole rule) to be dropped, meaning DINish may silently never load even though the file exists at exactly the path referenced. Verified by reading the file directly; not fixed as part of this documentation pass — if you're investigating "why does `--font-main` text look like fallback sans-serif," start here before assuming it's a missing/misplaced font file (see `assets.md` and `procedures.md` for where the file actually lives).

## Section map

| Lines | Section |
|---|---|
| 56–125 | Base element rules (`html`/`body`/headings/etc.) — see gotchas below |
| 126–175 | Shared 3D viewer (`.emjive-3d-viewer` — see below) |
| 176–325 | Header |
| 326–506 | Entry reveal (homepage hero) |
| 507–542 | Section heads (shared component) |
| 543–663 | Products (homepage grid) |
| 664–734 | Selection / order page |
| 735–1425 | Product detail page (by far the largest — sub-map below) |
| 1426–1441 | Footer |
| 1442–1660 | Floating selection bar |

**Product detail sub-map** (matches the numbered comments in both this file and `product.html`):
- 775 — label bar
- 858 — carousel
- 1021 — metal selection
- 1125 — select button
- 1149 — prose sections (description / characteristics / shipping)
- 1200 — size-selection modal (1252 standard sizes, 1324 custom size, 1389 size guide, 1403 confirm button)

**Floating selection bar sub-map**: 1473 — summary row (always visible), 1614 — drawer (item list, height driven by an inline px value `js/selection-bar.js` sets — see `client-scripts.md`).

## Shared 3D viewer (`.emjive-3d-viewer`, lines 126–175)

The wrapper `js/three-viewer.js`'s `buildThreeViewer()` returns as `el` — see `client-scripts.md`. `.emjive-3d-viewer` itself just sets `position:relative` (so the poster/nudge-hand overlays below can be absolutely positioned against it) plus `touch-action:none; cursor:grab;`. `.emjive-3d-viewer__canvas` fills it at `width/height:100%` — the module's own `ResizeObserver` keeps the renderer's pixel buffer matched to whatever size this resolves to, so there's no `object-fit`/cover-vs-contain concept needed here the way the old `<model-viewer>` tag selectors used (both real contexts, the grid card and the carousel slide, are always square anyway). `.emjive-3d-viewer__poster` and `.emjive-3d-viewer__nudge-hand` are both `position:absolute` overlays — the poster fades out via JS once the model's first frame has rendered, the nudge hand's position/opacity are driven per-frame from JS during the idle-nudge hint (only the opacity gets a CSS transition; position is hard-set every frame to stay in sync with the 3D camera nudge — see `client-scripts.md`).

Per-context sizing of the wrapper itself lives with each context instead (`.product-card__figure .emjive-3d-viewer`, `.product-carousel__slide .emjive-3d-viewer`, `.product-carousel__slide--model .emjive-3d-viewer` at `55%`) — same pattern the old `model-viewer`-tag selectors used, just retargeted at this class.

## Base-rule gotchas worth knowing before touching layout

- `html { scrollbar-gutter: stable; overflow-x: hidden; }` — reserves vertical scrollbar space unconditionally and forbids horizontal scroll, specifically so the fixed `.selection-bar`'s `left:0; right:0` stays consistent across pages.
- `body:has(.selection-bar) { padding-bottom: var(--selection-bar-height); }` — `:has()` auto-scopes the bottom-padding reservation to only the pages that actually render the bar (not `launch-order.html`).

## Recurring non-obvious techniques

Recognizing these by pattern saves re-deriving them every time:

1. **Backdrop-filter invert band** — `position:absolute; left:50%; top/bottom:50%; width:100vw; transform:translate(-50%,-50%); backdrop-filter:invert(1);`. Used 3 times: `.reveal__frontier`, `.product-detail__label-bar::before`, `.selection-bar__row::before`. The label bar and selection-bar row versions are each paired with a solid-color sibling (`#e5e5e5`) tuned so the inverted result matches `--black-bg` exactly, rather than inverting whatever happens to sit behind them.
2. **Full-bleed breakout of a centered column** — two variants: `left:50%; transform:translateX(-50%); width:100vw` for absolutely-positioned overlays, vs. `width:100vw; margin-left/right: calc(50% - 50vw)` for normal-flow blocks (`.product-detail__select`, `.size-modal__confirm`).
3. **`grid-template-rows: 0fr → 1fr` open/close reveal** — animates a height from/to auto without ever measuring it in JS. Used by `.site-header__menu` and the size modal's size-guide panel.
4. **Container queries** (`container-type: inline-size` + `cqw` units) — `.product-carousel-frame` (tile size, rim width), `.product-metals` (swatch width), `.size-modal__custom-row` (custom-size input width). Used wherever a component's internal sizing needs to respond to its own box rather than the viewport.
5. **Always-rendered, toggled-transparent indicator dot** — reserves its own layout space up front so selecting an option never shifts adjacent text. Used by the metal picker and both the standard/custom rows of the size modal.
6. **Full-bleed clickable divider bar as one real element** — `.product-card__bar-link` is a single `<a>` breakout out to `100vw`, used as the whole row's click target, rather than an invisible overlay layered on top of separate content.

## Pointers

- What markup these classes apply to: `pages.md`
- JS that reads/writes these classes or sets inline styles (drawer height, drag transforms, etc.): `client-scripts.md`
- Where the DINish font file actually lives: `assets.md`
