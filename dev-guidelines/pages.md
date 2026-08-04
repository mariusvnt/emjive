# Pages

The 7 HTML files at the repo root.

**They all stay at the repo root, deliberately.** `js/series.js` fetches `data/series.json` with a *relative* path, and every path inside the JSON is repo-root-relative too. Combined with `vite.config.js`'s `base: "/emjive/"`, a page moved into a subdirectory would resolve all of them against the wrong prefix and break silently. Any new page also needs adding to `vite.config.js`'s `rollupOptions.input` or it ships unprocessed (see `tooling.md`).

## Shared header — one byte-identical nav

All seven pages open with the same `<header class="site-header">`: brand logo linking home, a `+`/`-` hamburger toggle, and a dropdown nav with exactly three rows, in this order:

1. **Creation process** (`creation-process.html`) — DINish, `class="is-info"`.
2. **Archives** (`archives.html`) — same.
3. **Filter row** — a DINish "Filter by" label plus one Geist Mono `.category` button per category, all on one wrapping row. **Rendered by `js/main.js` from the active series' own category list**, never hand-written — don't add markup for them, and don't assume there are three, since each series declares its own subset (see `data.md`). That same script **hides the whole row** (`hidden` on `#siteHeaderFilter`) once that subset is down to one category or fewer — toggling a single button can never narrow the grid. `css/style.css` needs an explicit `.site-header__filter[hidden] { display: none }` for that to actually work, same trap as `.product-card[hidden]` below: the row's own `display: flex` is an author rule and beats the UA `[hidden]` regardless of specificity. A hidden row costs no layout either — its flex gap and the extra `--header-kind-gap` margin (`a.is-info + .site-header__filter`) both vanish for free once it's `display: none`.

The `<nav>` block is now **byte-identical across all seven pages** (verified by hashing it in each). The one remaining difference anywhere in the header is `.site-header__brand`'s href: `#top` on `index.html`, `index.html#top` everywhere else. That has to stay — `index.html#top` on the index itself triggers a reload instead of the CSS `scroll-behavior: smooth` scroll.

**Opening the menu isn't limited to the `+`/`-` icon.** `js/main.js` also delegates a click handler to `.site-header__row` itself, so any empty space in that row toggles the menu the same way the icon does — it just ignores clicks that land on the brand logo (`.site-header__brand`, which keeps navigating home) or on `.menu-toggle` (which already has its own listener; letting the row's handler also fire there would double-toggle).

**Closing it isn't limited to picking a link, either.** `window.EmjiveMenus` (`js/series.js`) coordinates "click away to close" between the header menu and the floating selection bar's drawer (`js/selection-bar.js`) — two panels that don't know about each other and can be open at once. A click outside every currently-open panel's root closes only the most-recently-opened one; a second outside click is needed to close the other if both happened to be open together. See `client-scripts.md` for the mechanism.

The old `.ring`/`.neck`/`.wrist` links (three dead anchors all pointing at the same `#products`) and the "About us" link (pointing at a `#contact` section that never existed on any page) are both gone. `js/main.js` still carries a guarded `#contactForm` stub that no-ops, kept for whenever a contact form actually gets built — see `procedures.md`.

## The series hero bundle

`index.html` has no hero markup of its own. It carries two empty slots — `#seriesHero` in `<main>`, and `#seriesBackdrop` inside `.products` — and `js/series.js` clones the featured series' hero into them at runtime from `series/<slug>/`:

| File | What it is |
|---|---|
| `hero.html` | A set of `<template data-series-slot="...">` elements. The loader clones each into the matching element id, so a series can fill any subset of the slots without `index.html` changing. |
| `hero.css` | That hero's styling, injected as a `<link>`. Lands after `css/style.css`, so it wins on ties. |
| `hero.js` | That hero's behavior. Assigns `window.EmjiveSeriesHero = { init, onProducts }` and **must have no side effects at execution time** — that's what lets the loader run all three fetches in parallel. It also **must not use bare specifiers**: it's loaded via a runtime string path, so Vite never sees it and couldn't resolve `import "three"`. |

Two path conventions live side by side in one folder, which is the easy thing to get wrong: `url()` inside `hero.css` resolves against **the CSS file** (`../../assets/...`), while `<img src>` inside `hero.html` resolves against **the page**, because the element is cloned into the live document.

**Anti-flash measures**, all load-bearing:
- `.series-hero { min-height: 100svh }` reserves the above-the-fold box before the bundle lands, so the grid never flashes into the viewport. It must stay a plain box — `.reveal__pin` inside is `position: sticky`, which dies silently if an ancestor gets `overflow`/`transform`/`filter`/`contain`/`will-change`.
- `body.has-series-hero` is **static markup** in `index.html`. It replaced `body:has(#revealSection)`, which can't work with a runtime-injected hero: `:has()` is live, so it wouldn't match at first paint, the selection bar would paint visible, then snap away when the fragment landed.
- The series entry's `hero.preload` list gets `<link rel="preload">` tags the instant the index loads, because a fragment's images aren't discoverable by the browser's preload scanner.
- If the bundle fails to load, `js/series.js` strips `has-series-hero` and empties the slot — otherwise the bar would stay hidden forever, since nothing would ever publish a scroll position.

## `index.html` — homepage / the featured series

Hero slots (above), then `#productGrid`, empty in the markup and populated by `js/main.js` from the active series' products. `?series=<slug>` shows any past series' main page instead of the featured one; `?cat=ring,neck` pre-applies the category filter.

**Filtering hides already-built cards** (`card.hidden`) rather than re-rendering the grid. Re-rendering would destroy and recreate every three.js `WebGLRenderer` on each toggle, and nothing on the live site disposes contexts — past the browser's per-page budget `buildThreeViewer()` returns `null` and the grid degrades to static icons, permanently. `.product-card[hidden] { display: none }` in `css/style.css` is required for the hiding to work at all, since the card's own `display: grid` beats the UA `[hidden]` rule.

**The floating selection bar here specifically** slides in as a continuation of the hero's own wipe. The hero owns that geometry and publishes one number via `window.EmjiveHero`; `js/selection-bar.js` subscribes and measures its own travel (see `client-scripts.md`).

## `product.html` — product detail

Driven by `?id=...`, optionally with `?series=...`. Product ids are only unique within a series now, so a bare `?id=` resolves against the active series first, then scans the rest (see `client-scripts.md`).

Sections, in order (numbered in the HTML's own comments): label bar → carousel (3D model or photo slides; drag to scroll freely, or tap a slide to center it — no visible arrows, no rim click zones) → metal picker → select button → description → characteristics (metal-dependent specs) → shipping/returns (static text) → the size-selection modal (a sibling of `<main>`, opened by the select button).

Everything text/image-related starts empty or `hidden` and gets filled in by `js/product.js`.

## `launch-order.html` — order / checkout review

No title, no footer — straight from the header into the full selection, in `js/selection-page.js`. Toggles between `#selectionEmpty` (now "No item selected." plus a plain-text "Back to gallery" link, both centered) and `#selectionList`, in order:

1. **Item rows** (`#selectionItems`, a `<ul class="order-items">`) — a full-bleed dark panel breaking out to the true viewport edge (same `100vw`/`calc(50% - 50vw)` technique `.product-detail__select` uses), padded top and bottom by the same amount so the panel bookends itself. Each row shows thumb + name.category.metal.size (one continuous label, ellipsis-free — it fade-masks instead when it overflows) + price at rest; hovering (mouse), tapping, or focusing swaps the whole row to a Modify/Unselect overlay (a click anywhere else on that same row while it's open reverts it). Unselect collapses the row smoothly (reflowing the rows below it, same principle as the floating selection bar's icon-collapse) and offers a stacked, sequential "Undo" bar at the top of the panel for a few seconds — reusing the removed row's already-decoded thumbnail on restore rather than reloading it. Modify opens a second modal (`#modifyModal`) built from the **same** `.size-modal`/`.product-metals` classes and wiring `product.html`'s own Select button uses — a metal picker plus the standard/custom size picker, pre-filled to the item's current choice, saving via `window.EmjiveSelection.updateItem()` instead of `addItem()`.
2. **Shipping** (`.order-shipping`) — a plain, unlabeled pick list (`.order-shipping__option`, dot-indicator style borrowed from the size modal) between a couple of placeholder carriers; no real rates wired up yet.
3. **Terms** (`.order-terms`) — a sentence with a real link to `terms.html`, and a square tick-box (opacity-toggled, no border) at the row's right edge.

No running total on the page itself any more — it lives only in the fixed **checkout bar** (`#orderCheckoutBar`, a sibling of `<main>`, not `js/selection-bar.js` — this page has never carried that): a "liquid glass" strip (translucent, blurred, no black-bg chrome) at `--selection-bar-height`, showing the total and a plain-text "Proceed to checkout" button, disabled until a shipping option is picked and terms are ticked. It's a stub — see `client-scripts.md`.

It's still the **only** page **without** the floating selection bar (`selection-bar.js` isn't in its script list — showing the full list *and* a floating summary of the same thing would be redundant) — but no longer the only one with a footer; that's gone entirely now.

## `archives.html`, `creation-process.html`, `terms.html` — empty shells

Header, a `.section-head` title block, correct meta tags, and a deliberately empty `.page-shell__body`. No designed content yet; each carries a comment naming what belongs there. Archives will render the series list from `data/series.json` via `EmjiveSeries.all()`/`.manifestHref()` — that's deferred, not missing by accident. `terms.html` follows the identical shell pattern but isn't in the header nav at all — it's reached only from `launch-order.html`'s terms-acceptance link, so the checkbox row there isn't pointing at a dead page.

## `series.html` — a series' design manifest

One page renders **any** series' manifest, from `data/series/<slug>/manifest.json`, selected by `?series=<slug>` — so adding a series never means adding a page. Also an empty shell: `js/series-page.js` wires the title, year and subtitle plus a real not-found state, and nothing else.

It's the one page that resolves its slug **without** the featured-series fallback the others use. Silently showing the wrong series' manifest would be worse than saying it doesn't exist, so `series.html` with no `?series=` is a not-found state, not the featured series.

## Page × script matrix

| | `series.js` (head, blocking) | `three-viewer.js` (module) | `main.js` | `selection.js` | `product.js` | `selection-bar.js` | `selection-page.js` | `series-page.js` |
|---|---|---|---|---|---|---|---|---|
| `index.html` | ✓ | ✓ | ✓ (defer) | ✓ | | ✓ | | |
| `product.html` | ✓ | ✓ | ✓ (defer) | ✓ | ✓ (defer) | ✓ | | |
| `launch-order.html` | ✓ | | ✓ | ✓ | | | ✓ | |
| `archives.html` | ✓ | | ✓ | ✓ | | ✓ | | |
| `creation-process.html` | ✓ | | ✓ | ✓ | | ✓ | | |
| `terms.html` | ✓ | | ✓ | ✓ | | ✓ | | |
| `series.html` | ✓ | | ✓ | ✓ | | ✓ | | ✓ |

`main.js` loads everywhere — it owns the header menu and the filter row, which render on every page, and its grid code no-ops when `#productGrid` isn't present. Only `index.html`/`product.html` load `three-viewer.js`; nothing else has 3D content.

**Why `js/series.js` is blocking in `<head>`** (no `defer`, not a module): it has to define `window.EmjiveSeries` before `main.js` runs, and `launch-order.html` loads `main.js` as a plain synchronous body script — a deferred `series.js` would run *after* it. Blocking also starts the `series.json` fetch at head-parse time, which is what the hero's anti-flash story depends on. It doesn't disturb the `defer` contract below: a blocking `<head>` script runs before the entire deferred queue.

**Why `main.js`/`product.js` specifically carry `defer`**: module scripts (`three-viewer.js`) always execute after the document finishes parsing; plain classic scripts without `defer` execute immediately, inline, as the parser reaches them — which on these two pages is *before* the deferred module, even though the module's tag sits earlier in `<head>`. Both call `window.EmjiveModelViewer` (set by `three-viewer.js`) inside async callbacks that can resolve fast enough to race it. `defer` puts them on the same ordered, post-parse queue as the module, which — since the module's tag comes first — guarantees it runs first.

## Pointers

- Markup classes/ids → what they look like: `styling.md`
- What the scripts on each page actually do: `client-scripts.md`
- The JSON shape these pages read: `data.md`
- Step-by-step "how do I add a product / a series / a category": `procedures.md`
