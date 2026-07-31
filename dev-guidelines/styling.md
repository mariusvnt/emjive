# Styling

One file, `css/style.css` (~1852 lines), plain CSS — no preprocessor, no CSS-in-JS. Line numbers below verified directly against the file; re-check them if the file has grown/shrunk a lot since.

## Design tokens (`:root`, lines 5–51)

| Token | Value | Purpose |
|---|---|---|
| `--bg` | `#f8f8f8` | Global page background |
| `--black` / `--white` | `#000` / `#fff` | Primary ink/light colors |
| `--category-col` | `#777777` | Secondary/muted text — category labels, metadata, prose |
| `--black-bg` | `#1a1a1a` | "Near-black" dark surface, shared exactly by the select button's hover state, the size modal's confirm button, and the floating selection bar |
| `--selection-bar-height` | `3.5rem` | Used by exactly two CSS rules that must stay in sync: `.selection-bar__summary`'s own height and `body`'s reserved bottom padding (via `body:has(.selection-bar)`) — a CSS-internal contract, not read from JS. `js/main.js`'s scroll-driven bar entrance (see "Floating selection bar" below) measures `.selection-bar__summary`'s real rendered height instead of this variable's value, so it stays correct even if the two ever drift apart, but in practice they should always agree |
| `--button-font-weight`/`--font-size`/`--letter-spacing`/`--text-transform` | `900` / `0.75rem` / `0.05rem` / `uppercase` | Shared text recipe for on-page buttons, applied across `.btn`, `.selection-item__remove`, the product-detail select, the size-modal controls, and `.selection-bar__order` — one place to retune every button's type instead of each repeating its own values |
| `--font-secondary` | Geist Mono (Google Fonts) | Nav category rubrics and other mono usages |
| `--font-main` | "DINish", sans-serif fallback | Everything else — three weights registered (400/700/900, lines 53–79), see below |
| `--max` | `1440px` | Site-wide content max-width cap |
| `--edge-px` | `clamp(20px, 2.5vw, 28px)` | The single horizontal edge-inset used everywhere content is padded away from the true screen edge — header, selection bar, size modal, section heads, product grid, footer, product detail all share this one token |
| `--reveal-pin-height` | `100vh` | Root-scoped (not scoped to `.reveal`) because `.reveal__extension-crop` in the sibling `.products` section also needs it |

## `@font-face` (lines 53–79) — three DINish weights

Regular (400), Bold (700), and Black (900, driven by `--button-font-weight` — see the design tokens table above). Bold currently has no selector actually rendering at `font-weight: 700` (it used to be justified by `.reveal__scan-hint`'s "SCROLL TO SCAN" hint, since removed — see "Entry reveal" below and `client-scripts.md`) — left registered rather than deleted, since dropping a font file is a separate call from the doc-sync pass that noticed this. Regular's `src` used to have a trailing-comma syntax error (`format("woff2"),;`) that could make browsers drop the whole declaration, silently falling back to sans-serif even with the font file present at exactly the right path — fixed; if `--font-main` text ever looks like fallback sans-serif again, that bug class is exactly where to look first (see `assets.md`/`procedures.md` for where the font files live).

## Section map

| Lines | Section |
|---|---|
| 80–167 | Base element rules (`html`/`body`/headings/etc.) — see gotchas below |
| 168–217 | Shared 3D viewer (`.emjive-3d-viewer` — see below) |
| 218–367 | Header |
| 368–561 | Entry reveal (homepage hero — includes the ring-on-hand overlay, see below; the DOM/CSS "SCROLL TO SCAN" hint that used to live here — `.reveal__scan-hint` — is gone, the text is baked into `hand-rings-under-flesh_4k.webp` itself now, see `assets.md`) |
| 562–597 | Section heads (shared component) |
| 598–718 | Products (homepage grid) |
| 719–793 | Selection / order page |
| 794–1540 | Product detail page (by far the largest — sub-map below; this pass touched the shared `--button-*` text recipe, the size modal's own guide-row wrapper/layout, and an `isolation: isolate` fix on `.product-detail__label-bar`, so numbers below are current as of that) |
| 1541–1556 | Footer |
| 1557–1852 | Floating selection bar |

**Product detail sub-map** (matches the numbered comments in both this file and `product.html`):

- 821 — label bar
- 928 — carousel
- 1091 — metal selection
- 1195 — select button
- 1221 — prose sections (description / characteristics / shipping)
- 1272 — size-selection modal (1343 standard sizes, 1416 custom size, 1496 size guide, 1510 confirm button)

**Floating selection bar sub-map**: 1611 — summary row (always visible in the DOM/markup sense — see the scroll-driven entrance note below for the one page where it isn't always *shown*), 1756 — drawer (item list, height driven by an inline px value `js/selection-bar.js` sets — see `client-scripts.md`).

## `.reveal__ring` (lines 392–395 for the `--ring-*` fallbacks, 511–522 for the rule itself) — ring-on-hand overlay

`.reveal__ring` positions a product's top-shot image on the x-ray hand: `left`/`top` from `--ring-x`/`--ring-y` (a % of the hand image's own width/height), `width` from `--ring-size` (a % of the same), `transform: translate(-50%,-50%) rotate(--ring-rotation)` to center on that point then spin in place. The four `--ring-*` custom properties declared on `.reveal` (lines 392–395) are fallback values only, inherited if nothing more specific overrides them — `js/main.js`'s `updateHeroRings()` sets all four inline, per `<img class="reveal__ring">` it creates, straight from that product's own `data/products.json` `onHand` object (see `data.md`), so several rings on screen at once each get their own values instead of fighting over one shared set. There's no `<img>` for this in the markup at all — every one is created and inserted into `#revealXrayGroup` by that same function, one per product with `onHand.visible: true` (zero, one, or several).

## Shared 3D viewer (`.emjive-3d-viewer`, lines 177–216)

The wrapper `js/three-viewer.js`'s `buildThreeViewer()` returns as `el` — see `client-scripts.md`. `.emjive-3d-viewer` itself just sets `position:relative` (so the poster/nudge-hand overlays below can be absolutely positioned against it) plus `touch-action:none; cursor:grab;`. `.emjive-3d-viewer__canvas` fills it at `width/height:100%` — the module's own `ResizeObserver` keeps the renderer's pixel buffer matched to whatever size this resolves to, so there's no `object-fit`/cover-vs-contain concept needed here the way the old `<model-viewer>` tag selectors used (both real contexts, the grid card and the carousel slide, are always square anyway). `.emjive-3d-viewer__poster` and `.emjive-3d-viewer__nudge-hand` are both `position:absolute` overlays — the poster fades out via JS once the model's first frame has rendered, the nudge hand's position/opacity are driven per-frame from JS during the idle-nudge hint (only the opacity gets a CSS transition; position is hard-set every frame to stay in sync with the 3D camera nudge — see `client-scripts.md`).

Per-context sizing of the wrapper itself lives with each context instead (`.product-card__figure .emjive-3d-viewer`, `.product-carousel__slide .emjive-3d-viewer`, `.product-carousel__slide--model .emjive-3d-viewer` at `55%`) — same pattern the old `model-viewer`-tag selectors used, just retargeted at this class.

## Base-rule gotchas worth knowing before touching layout

- `html { scrollbar-gutter: stable; overflow-x: hidden; }` — reserves vertical scrollbar space unconditionally and forbids horizontal scroll, specifically so the fixed `.selection-bar`'s `left:0; right:0` stays consistent across pages.
- `html`/`body { overscroll-behavior-x: none; }` — a separate concern from the `overflow-x: hidden` above: that stops actual horizontal scrolling, but browsers still show a rubber-band bounce for a left/right drag at the document edge regardless of whether there's anything to scroll to (narrow screens make that gesture easy to trigger by accident). Vertical overscroll bounce is deliberately left alone — scoped to `-x` only.
- `body:has(.selection-bar) { padding-bottom: var(--selection-bar-height); }` — `:has()` auto-scopes the bottom-padding reservation to only the pages that actually render the bar (not `launch-order.html`).

## Floating selection bar (lines 1557–1852) — scroll-driven on the homepage only

`.selection-bar` itself (line 1568) is visible (`transform: translateY(0)`) by default, with no `transition` on `transform` at all — deliberately, see below. `body:has(#revealSection) .selection-bar` (line 1607) overrides that to hidden (`translateY(100%)`) purely to cover the instant between the bar being appended (`js/selection-bar.js` runs synchronously, before `js/main.js`'s deferred code) and that page's first real scroll-computed position landing a moment later; it isn't the thing actually driving the entrance.

The actual entrance is `js/main.js`'s `updateReveal()` (see `client-scripts.md`), which sets `.selection-bar`'s `transform` directly, every scroll frame, as a continuous function of scroll position — continuing straight out of the hero's own x-ray wipe rather than switching to a separate, time-based animation once some threshold is crossed. That's exactly why there's no CSS `transition` here: one would lag behind the live scroll-computed value instead of tracking it exactly, undermining the "same physical scroll motion" effect. Pages with no `#revealSection` (`product.html`) never match that `:has()` override, so the bar there is just always visible — `js/main.js`'s reveal code (and this whole mechanic) never runs at all in that case.

## Recurring non-obvious techniques

Recognizing these by pattern saves re-deriving them every time:

1. **Backdrop-filter invert band** — `position:absolute; left:50%; top/bottom:50%; width:100vw; transform:translate(-50%,-50%); backdrop-filter:invert(1);`. Used 3 times: `.reveal__frontier`, `.product-detail__label-bar::before`, `.selection-bar__row::before`. The label bar and selection-bar row versions are each paired with a solid-color sibling (`#e5e5e5`) tuned so the inverted result matches `--black-bg` exactly, rather than inverting whatever happens to sit behind them.
2. **Full-bleed breakout of a centered column** — two variants: `left:50%; transform:translateX(-50%); width:100vw` for absolutely-positioned overlays, vs. `width:100vw; margin-left/right: calc(50% - 50vw)` for normal-flow blocks (`.product-detail__select`). `.size-modal__confirm` used to be a second example of the latter but no longer breaks out to the true viewport edge — it now stays flush with `--size-modal-max`'s own edges instead (`width: calc(100% + 2 * var(--edge-px)); margin: 0 calc(-1 * var(--edge-px)) 0`), so it tracks the modal's narrowed width on wide screens rather than overshooting past it.
3. **`grid-template-rows: 0fr → 1fr` open/close reveal** — animates a height from/to auto without ever measuring it in JS. Used by `.site-header__menu` and the size modal's size-guide panel.
4. **Container queries** (`container-type: inline-size` + `cqw` units) — `.product-carousel-frame` (tile size, rim width), `.product-metals` (swatch width), `.size-modal__custom-row` (custom-size input width). Used wherever a component's internal sizing needs to respond to its own box rather than the viewport.
5. **Always-rendered, toggled-transparent indicator dot** — reserves its own layout space up front so selecting an option never shifts adjacent text. Used by the metal picker and both the standard/custom rows of the size modal.
6. **Full-bleed clickable divider bar as one real element** — `.product-card__bar-link` is a single `<a>` breakout out to `100vw`, used as the whole row's click target, rather than an invisible overlay layered on top of separate content.

## Pointers

- What markup these classes apply to: `pages.md`
- JS that reads/writes these classes or sets inline styles (drawer height, drag transforms, etc.): `client-scripts.md`
- Where the DINish font file actually lives: `assets.md`
