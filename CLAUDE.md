# CLAUDE.md

em·ji·ve is a static jewelry e-commerce site: 7 HTML pages, one CSS file, vanilla JS (no framework), a custom three.js/TrackballControls 3D viewer for products (free, pole-crossing rotation), and a real localStorage-backed selection/cart system with no backend. The catalog is organised into **series**: `data/series.json` indexes them all, each with its own products, design manifest, and swappable homepage hero bundle, and one field there decides which series the homepage shows. `launch-order.html` is a full checkout review (item list, shipping, terms, a "Proceed to checkout" bar) but stops short of an actual payment step — no backend exists to take it further yet. [Vite](https://vitejs.dev) is the dev server — `npm run dev` — and is required (not optional) since the 3D viewer is an ES module resolving `three` from npm.

This file is an index into `dev-guidelines/`, the full agent-facing documentation set. For the human-facing project overview, see [`README.md`](README.md) instead.

## Known issues

- `archives.html`, `creation-process.html`, `series.html` and `terms.html` are deliberately **empty shells** — real routes, meta tags and styling hooks, no designed content yet. The archives page in particular does *not* render the series list, even though `data/series.json` already holds everything it needs → [`dev-guidelines/pages.md`](dev-guidelines/pages.md)
- `js/main.js` still carries a guarded `#contactForm` handler that no-ops, since no page has that element. Harmless, kept for whenever a contact form gets built → [`dev-guidelines/procedures.md`](dev-guidelines/procedures.md)
- `launch-order.html`'s "Proceed to checkout" button is a stub — no Stripe session, no backend to hit yet. Clicking it (once shipping + terms are filled in) just shows an alert saying so → [`dev-guidelines/client-scripts.md`](dev-guidelines/client-scripts.md)

## Where to look

| Doc | Read this when... |
|---|---|
| [`dev-guidelines/rules.md`](dev-guidelines/rules.md) | Before touching anything — process rules for how to work in this repo |
| [`dev-guidelines/procedures.md`](dev-guidelines/procedures.md) | You need a step-by-step: adding a product, changing/adding a metal, re-rendering icons, setting up fonts, etc. |
| [`dev-guidelines/pages.md`](dev-guidelines/pages.md) | Working on any of the 7 HTML pages, their shared header, or a series' hero bundle |
| [`dev-guidelines/styling.md`](dev-guidelines/styling.md) | Touching `css/style.css`, or debugging a layout/visual issue |
| [`dev-guidelines/client-scripts.md`](dev-guidelines/client-scripts.md) | Touching anything in `js/` (`series.js`, `main.js`, `product.js`, `selection*.js`, `series-page.js`, `three-viewer.js`) or a series' `hero.js` |
| [`dev-guidelines/data.md`](dev-guidelines/data.md) | Touching `data/series.json`, a series' `products.json`/`manifest.json`, or their schema |
| [`dev-guidelines/tooling.md`](dev-guidelines/tooling.md) | Touching `package.json` scripts, `scripts/auto-render.js`, `scripts/scene-tool-server.js`/`scene-tool.html`, `scripts/json-tool-server.js`/`scripts/json-tool-blocks.js`/`json-tool.html`, `vite.config.js`, or the GitHub Pages deploy workflow |
| [`dev-guidelines/assets.md`](dev-guidelines/assets.md) | Adding/moving files under `assets/` |

## Elsewhere

`README.md` is the project's front door for a human landing on the repo for the first time — what it is, why it exists, and a quick-start. It intentionally doesn't duplicate anything above.
