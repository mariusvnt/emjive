# em·ji·ve — website

A static site for the em·ji·ve jewelry brand: a product grid that shows
each item as its own 3D model (glTF/GLB — click and drag to rotate, falls
back to a photo if no model is set yet). Clicking a product opens its
detail page — a carousel, a metal picker, a description, metal-dependent
specs, and a "Select size" flow that adds to a real, localStorage-backed
selection you can review on a dedicated order page, with a floating
selection bar following you around everywhere else.

Plain HTML, CSS, and vanilla JavaScript — no framework, no bundler required
to ship it. [Vite](https://vitejs.dev) is used as the local dev server. 3D
rendering is a custom [three.js](https://threejs.org) scene with free,
pole-crossing rotation (`js/three-viewer.js`) — Vite is what resolves that
module's imports, so it's required to run the site locally, not optional.

## Getting started

```bash
npm install
npm run dev
```

Then open the URL it prints. You can't just double-click `index.html` —
the product grid loads its data via `fetch`, which browsers block on
`file://`.

## Structure, at a glance

```
index.html, product.html, launch-order.html   The three pages
css/style.css                                  All styling, one file
js/                                             Vanilla JS + the three.js viewer module
data/products.json                              The product catalog
assets/                                          Images, 3D models, fonts, HDRIs
scripts/auto-render.js                           Re-renders product icons/swatches
```

## Where to go next

**Adding a product, changing a metal, re-rendering icons, or any other
step-by-step task** — see [`dev-guidelines/procedures.md`](dev-guidelines/procedures.md).

**Understanding how the codebase is put together** — start at
[`CLAUDE.md`](CLAUDE.md), which indexes the rest of
[`dev-guidelines/`](dev-guidelines/): one doc per area of the site (pages,
styling, the client-side scripts, the data schema, the build/render
tooling, and the assets folder).

## Where the project stands

This is intentionally a starting skeleton so the aesthetic — colors, type,
layout, animations, real photography, real 3D models — can keep evolving
from here. Two of the three current products still have no photography,
and every product's weight/composition (and most prices) are still
placeholders waiting on real data. There's also no checkout/payment step
yet — the selection system only covers building and viewing an order, not
completing one.
