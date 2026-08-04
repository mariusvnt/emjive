# em·ji·ve — website

A static site for the em·ji·ve jewelry brand, organised into **series** —
each collection brings its own products, its own homepage hero animation,
and its own design manifest, with one field in `data/series.json` deciding
which one the homepage shows. A product grid that shows
each item as its own 3D model (glTF/GLB — click and drag to rotate, falls
back to a photo if no model is set yet). Clicking a product opens its
detail page — a carousel, a metal picker, a description, metal-dependent
specs, and a "Select size" flow that adds to a real, localStorage-backed
selection you can review on a dedicated order page — item rows you can
modify or unselect (with a few seconds to undo), a shipping pick, a terms
toggle, and a "Proceed to checkout" bar — with a floating selection bar
following you around everywhere else.

Plain HTML, CSS, and vanilla JavaScript — no framework. [Vite](https://vitejs.dev)
is used as the local dev server. 3D rendering is a custom [three.js](https://threejs.org)
scene with free, pole-crossing rotation (`js/three-viewer.js`) — Vite is
what resolves that module's `import "three"`, so it's required to run the
site locally, not optional. It's also required to *deploy* the site: a
plain static host serving the raw files can't resolve that import either,
so shipping this anywhere real means running `npm run build` first — see
"Deploying" below.

## Getting started

```bash
npm install
npm run dev
```

Then open the URL it prints. You can't just double-click `index.html` —
the product grid loads its data via `fetch`, which browsers block on
`file://`.

## Deploying

`npm run build` produces a real, portable `dist/` folder — a plain
`vite build` isn't enough on its own for this site, so `vite.config.js`
adds two things on top of Vite's defaults:

- **Multi-page entries** — Vite only treats `index.html` as a build entry
  by default; every other page is listed explicitly too, so all seven get
  their imports resolved. Add a line there for any new page.
- **A copy step for `js/`, `assets/`, `data/`, `series/`** — Vite's build can only
  see paths it can trace statically (`<script type="module">`,
  `url()` in CSS, that kind of thing). It can't bundle *classic*
  `<script src>` tags at all (so `js/main.js` etc. would silently vanish
  from the build without help), and it has no visibility into paths that
  only exist as runtime string data — a series' `products.json` icon/model
  paths, the hero bundle paths in `data/series.json`, or the HDRI path in
  `js/three-viewer.js`. Copying those four folders (`js/`, `assets/`,
  `data/`, `series/`) verbatim sidesteps tracing every case individually.

### The current setup: GitHub Pages (interim)

`.github/workflows/deploy.yml` runs that build on every push to `main`
and publishes `dist/` to GitHub Pages. `vite.config.js` also sets
`base: "/emjive/"`, because a GitHub Pages *project* page
(`mariusvnt.github.io/emjive/`) is served from a subpath rather than a
domain root — every built `<script>`/`<link>` reference needs that
prefix to resolve. **This is explicitly a stopgap** for the current URL,
not the intended long-term home for the site.

### Moving to a real domain

Most static hosts (Netlify, Vercel, Cloudflare Pages, …) run the build
themselves once you point them at the repo — build command `npm run build`,
publish directory `dist`, no GitHub Actions involved. Two things actually
need to change when that happens:

1. In `vite.config.js`, change `base: "/emjive/"` to `base: "/"` (or just
   delete the line — `/` is Vite's default). This is the one setting
   that's specifically about GitHub's subpath, not about deploying in
   general — everything else in `vite.config.js` (the multi-page entries,
   the copy step) stays, since any host running a real Vite build has the
   same underlying limitations to work around.
2. Delete `.github/workflows/deploy.yml` — it's GitHub-Pages-specific CI,
   superseded by the new host's own build pipeline.

If you also want `mariusvnt.github.io/emjive/` to stop resolving
afterward, that's a manual step in this repo's GitHub Settings → Pages
(switch the source away from "GitHub Actions", or disable Pages
entirely) — not something committing code here can do.

## Structure, at a glance

```text
index.html, product.html, launch-order.html    The shop
archives.html, creation-process.html, terms.html   Empty shells, design pending
series.html                                     Renders any series' design manifest
css/style.css                                   All shared styling, one file
js/                                             Vanilla JS + the three.js viewer module
data/series.json                                Series index + category vocabulary
data/series/<slug>/                             One series' products + manifest
series/<slug>/                                  One series' hero bundle (html/css/js)
assets/                                         Images, 3D models, fonts, HDRIs
scripts/auto-render.js                          Re-renders product icons/swatches
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
from here. Three of the four current products still have no photography,
and every product's weight/composition (and most prices) are still
placeholders waiting on real data. `launch-order.html`'s review page goes
all the way to a "Proceed to checkout" button, but there's still no real
payment step behind it — no backend exists yet to hand that off to (e.g. a
Stripe Checkout session); clicking it just says so.
