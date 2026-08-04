# Styling

One file, `css/style.css` (~2220 lines), plain CSS — no preprocessor, no CSS-in-JS. Line numbers below verified directly against the file; re-check them if the file has grown/shrunk a lot since.

## Design tokens (`:root`, lines 5–57)

| Token | Value | Purpose |
|---|---|---|
| `--bg` | `#f8f8f8` | Global page background |
| `--black` / `--white` | `#000` / `#fff` | Primary ink/light colors |
| `--category-col` | `#777777` | Secondary/muted text — category labels, metadata, prose |
| `--black-bg` | `#1a1a1a` | "Near-black" dark surface, shared exactly by the select button's hover state, the size modal's confirm button, the floating selection bar, `.product-card__bar-link`, the order page's full-bleed item panel (`.order-items`), its checked terms tick-box, and the checkout bar's own CTA |
| `--selection-bar-height` | `3.5rem` | Used by exactly two CSS rules that must stay in sync: `.selection-bar__summary`'s own height and `body`'s reserved bottom padding (via `body:has(.selection-bar)`) — a CSS-internal contract, not read from JS. `js/main.js`'s scroll-driven bar entrance (see "Floating selection bar" below) measures `.selection-bar__summary`'s real rendered height instead of this variable's value, so it stays correct even if the two ever drift apart, but in practice they should always agree. `launch-order.html`'s own checkout bar (`.order-checkout-bar`) reuses this same token directly, "same height as the standard bar" being the point |
| `--button-font-weight`/`--font-size`/`--letter-spacing`/`--text-transform` | `900` / `0.75rem` / `0.05rem` / `uppercase` | Shared text recipe for on-page buttons, applied across `.btn`, the product-detail select, the size-modal controls, `.selection-bar__order`, and the order page's own text buttons (`.order-item__overlay-btn`, `.order-items__undo-btn`, `.selection-empty__back`, `.order-checkout-bar__button`) — one place to retune every button's type instead of each repeating its own values |
| `--font-secondary` | Geist Mono (Google Fonts) | Nav category rubrics and other mono usages |
| `--font-main` | "DINish", sans-serif fallback | Everything else — three weights registered (400/700/900, lines 59–85), see below |
| `--max` | `1440px` | Site-wide content max-width cap |
| `--edge-px` | `clamp(20px, 2.5vw, 28px)` | The single horizontal edge-inset used everywhere content is padded away from the true screen edge — header, selection bar, size modal, section heads, product grid, product detail, and the order page all share this one token |
| `--header-filter-gap` | `.75rem` | Gap between the header's category filter buttons |
| `--header-filter-label-gap` | `1rem` | Gap from the "Filter by" label to the first category button |

## `@font-face` (lines 59–85) — three DINish weights

Regular (400), Bold (700), and Black (900, driven by `--button-font-weight` — see the design tokens table above). Bold currently has no selector actually rendering at `font-weight: 700` (it used to be justified by `.reveal__scan-hint`'s "SCROLL TO SCAN" hint, since removed — see "Entry reveal" below and `client-scripts.md`) — left registered rather than deleted, since dropping a font file is a separate call from the doc-sync pass that noticed this. Regular's `src` used to have a trailing-comma syntax error (`format("woff2"),;`) that could make browsers drop the whole declaration, silently falling back to sans-serif even with the font file present at exactly the right path — fixed; if `--font-main` text ever looks like fallback sans-serif again, that bug class is exactly where to look first (see `assets.md`/`procedures.md` for where the font files live).

## Section map

`css/style.css` is 2220 lines and holds only what's shared across pages. **The homepage hero's styling is no longer here** — it moved wholesale into the featured series' own bundle at `series/<slug>/hero.css`, along with the `--reveal-pin-height` and `--reveal-xray-opacity` tokens it owns (see `pages.md`).

| Lines | Section |
|---|---|
| 87–174 | Base element rules (`html`/`body`/headings/etc.) — see gotchas below |
| 175–224 | Shared 3D viewer (`.emjive-3d-viewer` — see below) |
| 225–431 | Header — including the category filter row (`.site-header__filter`, its wrapping options row, `.is-cat.is-active`, and the `.site-header__filter[hidden]` override — see the gotcha below) |
| 432–477 | Series hero slots (`.series-hero`, `.series-hero-backdrop`) — the two empty containers the hero fragment gets cloned into. See the warning below |
| 478–513 | Section heads (shared component) |
| 514–682 | Products (homepage grid) — `.product-card__label` is a fixed-width box (`width: 6.25rem`) centered in its grid column via `justify-self: center`, replacing an earlier viewport-relative `padding-left: 12vw` push that drifted out of proportion against the model column's own sizing on narrow phones. `.product-card[hidden]` lives here too — see the gotcha below |
| 683–714 | Standalone content pages (`.page-shell`) — archives, creation process, terms, series manifest |
| 715–1081 | Selection / order page (grown a lot since the order-page rebuild — sub-map below) |
| 1082–1175 | Checkout bar — `launch-order.html`'s own "liquid glass" bar (`.order-checkout-bar`), not `.selection-bar` (see `pages.md`/`client-scripts.md`) |
| 1176–1916 | Product detail page (by far the largest — sub-map below) |
| 1917–2220 | Floating selection bar |

No more standalone Footer section — `<footer class="site-footer">` (and its CSS) was removed along with the rest of `launch-order.html`'s old layout; it was never used anywhere else.

**Selection / order page sub-map**:

- 726 — empty state (`.selection-empty`, now just centered "No item selected." text + a plain-text `.selection-empty__back` link — no more bordered `.btn`)
- 765 — `.selection-list`'s own `gap`-only rhythm — every section below (item panel, shipping, terms) is told apart purely by that gap, no border/rule anywhere, per the design brief
- 772 — item rows (`.order-items`/`.order-item`) — a full-bleed dark panel (same `100vw` + `calc(50% - 50vw)` breakout `.product-detail__select` uses below), padded top *and* bottom so the panel bookends itself. Each row reuses the same inverting-band technique as `.selection-bar__row::before` (see "Recurring non-obvious techniques" below) and a `max-height`/padding/opacity collapse (`.is-removing`) for both Unselect and the restored-row entrance — driven by `js/selection-page.js`, see `client-scripts.md`
- 952 — the "Undo" bar (`.order-items__undo`) — built on `.order-item` itself for the same collapse animation, with `.order-items__undo::before { content: none }` suppressing the inverting band (it isn't an item)
- 993 — shipping pick (`.order-shipping__option`) — the size modal's own dot-indicator recipe, reused
- 1041 — terms acceptance (`.order-terms`) — text hugging the left edge, a square opacity-toggled tick-box (no border) hugging the right

**Product detail sub-map** (matches the numbered comments in both this file and `product.html`):

- 1216 — label bar
- 1310 — carousel (no rim click zones anymore — dropped in favor of drag-to-scroll plus tap-a-slide-to-center-it, all in JS; see `client-scripts.md`)
- 1443 — metal selection
- 1547 — select button
- 1573 — prose sections (description / characteristics / shipping)
- 1624 — size-selection modal (1720 standard sizes, 1793 custom size, 1872 size guide, 1886 confirm button). `launch-order.html`'s own Modify popup (`#modifyModal`) reuses this exact `.size-modal`/`.product-metals` markup and CSS rather than a page-specific copy — a couple of rules here (`#modifyModalTitleName`/`#modifyModalTitleType`, `.size-modal__content .product-metals`) are scoped to that one instance so product.html's own "Choose a size" modal is untouched

**Floating selection bar sub-map**: 1979 — summary row (always visible in the DOM/markup sense — see the scroll-driven entrance note below for the one page where it isn't always *shown*), 2124 — drawer (item list, height driven by an inline px value `js/selection-bar.js` sets — see `client-scripts.md`).

**`.series-hero` must stay a plain box.** `.reveal__pin` inside it is `position: sticky`, which silently stops working if any ancestor picks up `overflow` (other than `visible`), `transform`, `filter`, `contain` or `will-change`. Its `min-height: 100svh` exists to reserve the above-the-fold box before the hero bundle lands, so the grid never flashes into the viewport. `.series-hero-backdrop` is `display: contents` so the injected backdrop keeps `.products` as its containing block and every `.reveal__extension-crop` rule applies with no geometry change.

## `series/bones/hero.css` (207 lines) — the Bones hero

Not part of `css/style.css` at all: it's injected as a `<link>` at runtime by `js/series.js`, so it lands *after* the shared stylesheet and wins on ties. It carries the whole "Entry reveal" block plus the two `:root` tokens only it needs (`--reveal-pin-height`, `--reveal-xray-opacity`). The DOM/CSS "SCROLL TO SCAN" hint that used to live here — `.reveal__scan-hint` — is gone; that text is baked into `hand-rings-under-flesh_4k.webp` itself now (see `assets.md`).

**Path gotcha, and it's the easy one to get wrong**: `url()` in a bundle stylesheet resolves against **the CSS file** (`../../assets/...`), while `<img src>` in the bundle's `hero.html` fragment resolves against **the page**, since the element is cloned into the live document. Two conventions, one folder. `hero.css` happens to need no `url()` at all today — every hero image is a real `<img>` — but a future series' bundle will hit this.

### `.reveal__ring` (hero.css lines 54–57 for the `--ring-*` fallbacks, 175 for the rule itself) — ring-on-hand overlay

`.reveal__ring` positions a product's top-shot image on the x-ray hand: `left`/`top` from `--ring-x`/`--ring-y` (a % of the hand image's own width/height), `width` from `--ring-size` (a % of the same), `transform: translate(-50%,-50%) rotate(--ring-rotation)` to center on that point then spin in place. The four `--ring-*` custom properties declared on `.reveal` are fallback values only, inherited if nothing more specific overrides them — the bundle's own `updateHeroRings()` sets all four inline, per `<img class="reveal__ring">` it creates, straight from that product's `onHand` object (see `data.md`), so several rings on screen at once each get their own values instead of fighting over one shared set. There's no `<img>` for this in the markup at all — every one is created and inserted into `#revealXrayGroup` by that same function, one per product with `onHand.visible: true` (zero, one, or several).

## Shared 3D viewer (`.emjive-3d-viewer`, lines 196–235)

The wrapper `js/three-viewer.js`'s `buildThreeViewer()` returns as `el` — see `client-scripts.md`. `.emjive-3d-viewer` itself just sets `position:relative` (so the poster/nudge-hand overlays below can be absolutely positioned against it) plus `touch-action:none; cursor:grab;`. `.emjive-3d-viewer__canvas` fills it at `width/height:100%` — the module's own `ResizeObserver` keeps the renderer's pixel buffer matched to whatever size this resolves to, so there's no `object-fit`/cover-vs-contain concept needed here the way the old `<model-viewer>` tag selectors used (both real contexts, the grid card and the carousel slide, are always square anyway). `.emjive-3d-viewer__poster` and `.emjive-3d-viewer__nudge-hand` are both `position:absolute` overlays — the poster fades out via JS once the model's first frame has rendered, the nudge hand's position/opacity are driven per-frame from JS during the idle-nudge hint (only the opacity gets a CSS transition; position is hard-set every frame to stay in sync with the 3D camera nudge — see `client-scripts.md`).

Per-context sizing of the wrapper itself lives with each context instead (`.product-card__figure .emjive-3d-viewer`, `.product-carousel__slide .emjive-3d-viewer`, `.product-carousel__slide--model .emjive-3d-viewer` at `55%`) — same pattern the old `model-viewer`-tag selectors used, just retargeted at this class.

## Base-rule gotchas worth knowing before touching layout

- `html { scrollbar-gutter: stable both-edges; overflow-x: hidden; }` — reserves vertical scrollbar space unconditionally and forbids horizontal scroll, specifically so the fixed `.selection-bar`'s `left:0; right:0` stays consistent across pages. `both-edges` (not plain `stable`) matters for a second reason too: the site leans on a lot of "re-center on my own midpoint, then breakout to `100vw`" tricks (`.product-card__bar-link`, the hero images, the carousel frame, `.product-detail__select`), and plain `stable` reserves its gutter on one edge only — which, on any engine that honors it even with no scrollbar actually visible (observed on Chrome for Android), quietly shifts those midpoints off the true viewport center. `both-edges` reserves the same gutter on both sides instead, keeping centering symmetric. On iOS Safari specifically, a real reported instance of this same gap-on-one-edge/scrollable-on-the-other symptom turned out to be unrelated to scrollbar-gutter at all — see `.product-card`'s own `min-width: 0` note in the Products row of the section map above.
- `html`/`body { overscroll-behavior-x: none; }` — a separate concern from the `overflow-x: hidden` above: that stops actual horizontal scrolling, but browsers still show a rubber-band bounce for a left/right drag at the document edge regardless of whether there's anything to scroll to (narrow screens make that gesture easy to trigger by accident). Vertical overscroll bounce is deliberately left alone — scoped to `-x` only.
- `body:has(.selection-bar) { padding-bottom: var(--selection-bar-height); }` — `:has()` auto-scopes the bottom-padding reservation to only the pages that actually render the bar (not `launch-order.html`). That page has its own equivalent instead — `body:has(.order-checkout-bar:not([hidden]))` — for its own fixed checkout bar, same mechanism, just scoped to a `[hidden]` toggle rather than the bar's mere presence, since `launch-order.html` always renders the element but only sometimes shows it (nothing selected ⇒ nothing to check out).
- **`[hidden]` loses to any explicit `display`.** The UA stylesheet's `[hidden] { display: none }` is beaten by a rule that sets `display` itself, so hiding such an element via the `hidden` attribute silently does nothing without a matching `[hidden]` rule. Several places in this file exist purely for that: `.product-card[hidden]` (the header's category filter hides cards this way — see below), `.selection-bar__icons[hidden]`, `.selection-bar__order`, `.site-header__filter[hidden]` (`js/main.js` hides the whole filter row once a series is down to one category or fewer — see the Header row in the section map above), and — since the order-page rebuild — `.selection-empty[hidden]`/`.selection-list[hidden]` (both `display: flex` now, for the centered empty state and the section-to-section `gap` rhythm respectively). If you add a `display:` to a block that JS ever hides, add its `[hidden]` companion in the same edit.
- **The category filter hides cards, it never re-renders them.** `js/main.js` builds every `.product-card` once and toggles `hidden`. Rebuilding the grid per toggle would destroy and recreate every three.js `WebGLRenderer`, and nothing on the live site disposes contexts — past the browser's per-page budget the viewer returns `null` and the whole grid degrades to static icons, permanently. Keep any future filter/sort work on the same "hide, don't rebuild" footing.

## Floating selection bar (lines 1917–2220) — scroll-driven on the homepage only

`.selection-bar` itself (line 1928) is visible (`transform: translateY(0)`) by default, with no `transition` on `transform` at all — deliberately, see below. `body.has-series-hero .selection-bar` (line 1975) overrides that to hidden (`translateY(100%)`) purely to cover the instant between the bar being appended (`js/selection-bar.js` runs synchronously) and that page's first real scroll-computed position landing a moment later; it isn't the thing actually driving the entrance.

That selector used to be `body:has(#revealSection)`, which broke the moment the hero became a runtime-injected bundle: `:has()` is live, so at first paint there is no `#revealSection`, the bar paints visible, and it snaps away when the fragment lands — exactly the flash the rule exists to prevent. The class is static markup in `index.html` instead, and `js/series.js` strips it if the bundle fails to load, so the bar isn't stranded off-screen with nothing left to publish a scroll position.

The actual entrance is driven by the active series' hero, which publishes how far past its trigger point the page has scrolled via `window.EmjiveHero`; `js/selection-bar.js` subscribes and sets `.selection-bar`'s `transform` directly, every scroll frame, as a continuous function of that — continuing straight out of the hero's own x-ray wipe rather than switching to a separate, time-based animation once some threshold is crossed. That's exactly why there's no CSS `transition` here: one would lag behind the live scroll-computed value instead of tracking it exactly, undermining the "same physical scroll motion" effect. Pages with no hero never get `has-series-hero` and nothing ever publishes, so the bar there is just always visible — the whole mechanic never runs (see `client-scripts.md`).

## Recurring non-obvious techniques

Recognizing these by pattern saves re-deriving them every time:

1. **Backdrop-filter invert band** — `position:absolute; left:50%; top/bottom:50%; width:100vw; transform:translate(-50%,-50%); backdrop-filter:invert(1);`. Used 4 times: `.reveal__frontier`, `.product-detail__label-bar::before`, `.selection-bar__row::before`, and (since the order-page rebuild) `.order-item::before`. The label bar and selection-bar row versions are each paired with a solid-color sibling (`#e5e5e5`) tuned so the inverted result matches `--black-bg` exactly, rather than inverting whatever happens to sit behind them — `.order-item::before` needs no such sibling, since the row already sits directly on `.order-items`' own solid `--black-bg`. That same `#e5e5e5` math (inverting it lands exactly on `--black-bg`) is reused a second way by `.order-item__overlay-btn`'s text color: not paired with a band-specific sibling, just chosen so wherever the row's own band happens to cross the Modify/Unselect text, it reads as `--black-bg` rather than snapping to pure black.
2. **Full-bleed breakout of a centered column** — two variants: `left:calc(50% - 50vw); width:100vw` for absolutely-positioned overlays needing only one axis this way (`.product-card__bar-link` — vertical centering there still uses `top:50%; transform:translateY(-50%)`, a separate axis with no equivalent single-step expression), vs. `width:100vw; margin-left/right: calc(50% - 50vw)` for normal-flow blocks (`.product-detail__select`). `.product-card__bar-link` used to pair `left:50%` with `transform:translateX(-50%)` instead of the `calc()` form — changed because that pairing mixes two independently-rounded values (a % of the card's own width, then a transform based on the bar's own `100vw` width), which on some device pixel ratios showed up as a hairline gap at one screen edge. `.size-modal__confirm` used to be a second example of the margin-based variant but no longer breaks out to the true viewport edge — it now stays flush with `--size-modal-max`'s own edges instead (`width: calc(100% + 2 * var(--edge-px)); margin: 0 calc(-1 * var(--edge-px)) 0`), so it tracks the modal's narrowed width on wide screens rather than overshooting past it.
3. **`grid-template-rows: 0fr → 1fr` open/close reveal** — animates a height from/to auto without ever measuring it in JS. Used by `.site-header__menu` and the size modal's size-guide panel.
4. **Container queries** (`container-type: inline-size` + `cqw` units) — `.product-carousel-frame` (tile size), `.product-metals` (swatch width), `.size-modal__custom-row` (custom-size input width). Used wherever a component's internal sizing needs to respond to its own box rather than the viewport.
5. **Always-rendered, toggled-transparent indicator dot** — reserves its own layout space up front so selecting an option never shifts adjacent text. Used by the metal picker, both the standard/custom rows of the size modal, and the order page's shipping picker (`.order-shipping__option::before`). The order page's terms tick-box (`.order-terms__toggle`) is a variant of the same idea scaled up into a standalone control (opacity-toggled fill, no outline) rather than a small accent next to other text, since there it *is* the whole control.
6. **Full-bleed clickable divider bar as one real element** — `.product-card__bar-link` is a single `<a>` breakout out to `100vw` (`--black-bg`, with `.product-card__label-name` set to `--white` so the product name stays legible over it — `.product-card__label-type`'s existing `--category-col` grey already read fine against black), used as the whole row's click target, rather than an invisible overlay layered on top of separate content.
7. **`min-width: 0` to stop a grid item's content from ballooning its container** — grid items default to `min-width: auto`, i.e. they refuse to shrink below their own content's minimum size, which can force a track (and everything containing it) wider than intended. `.product-card` needs this: `.product-card__figure`'s explicit `clamp(210px, …)` floor alone already exceeds half of a narrow phone's available width, which — without `min-width: 0` — was forcing `.product-grid`, and so the whole page, wider than the viewport (visible as `.product-card__bar-link`'s breakout landing a few px off-center, with a matching hairline of genuinely scrollable overflow on the far edge).

## Pointers

- What markup these classes apply to: `pages.md`
- JS that reads/writes these classes or sets inline styles (drawer height, drag transforms, etc.): `client-scripts.md`
- Where the DINish font file actually lives: `assets.md`
