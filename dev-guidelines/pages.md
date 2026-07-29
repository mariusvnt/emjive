# Pages

The 3 HTML files at the repo root.

## Shared header — near-identical, not byte-identical

All three real pages open with the same `<header class="site-header">` markup: brand logo linking home, a `+`/`-` hamburger toggle, and a dropdown nav with hand-written links (`.is-cat` for `.ring`/`.neck`/`.wrist`, `.is-info` for "About us") — **not generated** from `data/products.json`'s `categories` list, so keep them in sync by hand if categories change (see `data.md`).

The one difference: `index.html`'s links use bare anchors (`#top`, `#products`, `#contact`) since it *is* the target page; `product.html` and `launch-order.html` prefix every nav href with `index.html#...` to get back there first. Verified directly (`grep href="...#" *.html`) — don't assume byte-identical markup when diffing these files.

**Known gap**: the nav's "About us" link points at `#contact` on every page, but `index.html` has no element with `id="contact"` — there's no Contact section on the page at all currently, just the dangling link. `js/main.js` has a matching stub handler (`getElementById("contactForm")`, guarded so it no-ops safely since that element doesn't exist either) that would wire up form submission once a `<form id="contactForm">` exists — see `procedures.md`'s "Contact form" section for how to wire it once it's built. Whether to add the section or remove the dead link is a product decision, not something this doc pass resolves.

## `index.html` — homepage

Hero (`#revealSection`) — a scroll-driven x-ray reveal effect over a hand image, animated by `js/main.js`'s `updateReveal()` via `clip-path`. Then `#productGrid`, empty in the markup and populated client-side by `js/main.js` from `data/products.json` (shows "Loading specimens…" until then, and a fallback message if the fetch fails — e.g. if you open the file directly instead of via a server).

`<head>` loads `js/three-viewer.js` as an ES module (`<script type="module">`) — see the load-order note below. Body scripts, in order: `main.js` (`defer`), `selection.js`, `selection-bar.js`.

## `product.html` — product detail

Driven by a `?id=...` query string resolved against `data/products.json` (see `client-scripts.md`'s `product.js` section). Sections, in the order they appear (numbered in the HTML's own comments): label bar → carousel (3D model or photo slides, drag/click-rim navigation only, no visible arrows) → metal picker → select button → description → characteristics (metal-dependent specs) → shipping/returns (static text, same on every product) → the size-selection modal (a sibling of `<main>`, not nested inside it — opened by the select button).

Everything text/image-related starts empty or `hidden` in the markup and gets filled in by `js/product.js` once the product data loads.

`<head>` loads `js/three-viewer.js` as a module, same as `index.html`. Body scripts, in order: `main.js` (`defer`), `selection.js`, `product.js` (`defer`), `selection-bar.js`.

## `launch-order.html` — order / selection page

Shows everything currently in the selection as a full itemized list with a running total — not a drawer, a whole page. Toggles between an empty state (`#selectionEmpty`) and the populated list (`#selectionList`) depending on whether anything's been selected.

Two things make this page different from the other two:
- It's the **only** page with a `<footer class="site-footer">`.
- It's the **only** page **without** the floating selection bar — `selection-bar.js` simply isn't in its script list, since showing the full list already and a floating summary of the same thing would be redundant.

Scripts, in order: `main.js`, `selection.js`, `selection-page.js`.

## Page × script matrix

| | `three-viewer.js` (module) | `main.js` | `selection.js` | `product.js` | `selection-bar.js` | `selection-page.js` |
|---|---|---|---|---|---|---|
| `index.html` | ✓ | ✓ | ✓ | | ✓ | |
| `product.html` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `launch-order.html` | | ✓ | ✓ | | | ✓ |

`main.js` loads on all three — besides the homepage grid, it also owns the header-menu toggle shared by every page, and its homepage-specific code (hero reveal, grid rendering) simply no-ops when `#revealSection`/`#productGrid` aren't present, the same guard pattern `selection-bar.js` uses for `window.EmjiveSelection`. `launch-order.html` doesn't load `three-viewer.js` at all — it has no 3D content.

**Why `main.js`/`product.js` specifically carry `defer`**: module scripts (`three-viewer.js`) always execute after the document finishes parsing; plain classic scripts without `defer` execute immediately, inline, as the parser reaches them — which on these two pages is *before* the deferred module, even though the module's `<script>` tag sits earlier in `<head>`. `main.js`/`product.js` both call `window.EmjiveModelViewer` (set by `three-viewer.js`) inside a `fetch(...).then(...)` callback, and that fetch can resolve fast enough to race ahead of the module actually finishing. `defer` puts them on the same ordered, post-parse execution queue as the module, which — since the module's tag comes first in the document — guarantees it runs first. `selection.js`/`selection-bar.js`/`selection-page.js` don't touch `window.EmjiveModelViewer`, so they're untouched, plain synchronous scripts.

## Pointers

- Markup classes/ids → what they look like: `styling.md`
- What the scripts on each page actually do: `client-scripts.md`
- The JSON shape these pages read: `data.md`
- Step-by-step "how do I add a product / change a metal / etc.": `procedures.md`
