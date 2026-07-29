# CLAUDE.md

em·ji·ve is a static jewelry e-commerce site: 3 HTML pages, one CSS file, vanilla JS (no framework), a custom three.js/TrackballControls 3D viewer for products (free, pole-crossing rotation), and a real localStorage-backed selection/cart system with no backend. [Vite](https://vitejs.dev) is the dev server — `npm run dev` — and is required (not optional) since the 3D viewer is an ES module resolving `three` from npm.

This file is an index into `dev-guidelines/`, the full agent-facing documentation set. For the human-facing project overview, see [`README.md`](README.md) instead.

## Known issues

- The `@font-face` rule for the site's main font has a malformed `src` value that can make browsers drop the whole declaration → [`dev-guidelines/styling.md`](dev-guidelines/styling.md)
- The header's "About us" link points at `#contact` on every page, but no page actually has a `#contact` section — it's a dangling link, and the matching JS contact-form handler is a guarded no-op waiting for a form that doesn't exist yet → [`dev-guidelines/pages.md`](dev-guidelines/pages.md)
- `data/products.json`'s `assets.top-shot` images are fully generated for every product but not read by any live JS or CSS yet → [`dev-guidelines/data.md`](dev-guidelines/data.md)

## Where to look

| Doc | Read this when... |
|---|---|
| [`dev-guidelines/rules.md`](dev-guidelines/rules.md) | Before touching anything — process rules for how to work in this repo |
| [`dev-guidelines/procedures.md`](dev-guidelines/procedures.md) | You need a step-by-step: adding a product, changing/adding a metal, re-rendering icons, setting up fonts, etc. |
| [`dev-guidelines/pages.md`](dev-guidelines/pages.md) | Working on any of the 3 real HTML pages, or their shared header |
| [`dev-guidelines/styling.md`](dev-guidelines/styling.md) | Touching `css/style.css`, or debugging a layout/visual issue |
| [`dev-guidelines/client-scripts.md`](dev-guidelines/client-scripts.md) | Touching `js/main.js`, `selection.js`, `product.js`, `selection-bar.js`, `selection-page.js`, or `three-viewer.js` |
| [`dev-guidelines/data.md`](dev-guidelines/data.md) | Touching `data/products.json` or its schema |
| [`dev-guidelines/tooling.md`](dev-guidelines/tooling.md) | Touching `package.json` scripts or `scripts/auto-render.js` |
| [`dev-guidelines/assets.md`](dev-guidelines/assets.md) | Adding/moving files under `assets/` |

## Elsewhere

`README.md` is the project's front door for a human landing on the repo for the first time — what it is, why it exists, and a quick-start. It intentionally doesn't duplicate anything above.
