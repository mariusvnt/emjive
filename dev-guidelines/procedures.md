# Procedures

Step-by-step how-tos for common changes to this site. For architecture/"what does this file do," see the other docs in this folder instead — this one is purely procedural.

## Running it locally

```bash
npm install
npm run dev
```

This starts Vite's dev server (see `tooling.md`). You need a real server rather than opening `index.html` directly — the product grid loads its data via `fetch`, which browsers block on `file://`, and `js/three-viewer.js` additionally needs Vite specifically to resolve its bare-specifier imports (`three`, `three/addons/...`).

## Adding a product

Products belong to a series. Everything below assumes you're adding to an
existing one — `bones` is the only one so far. To start a *new* series, see
"Adding a series" further down first.

1. Make a folder under `assets/series/<series-slug>/products/<slug>_<category>/`.
   The `<slug>_<category>` shape is load-bearing: `npm run auto-render`
   *constructs* its output path from it rather than reading `model`, so a
   differently-named folder gets a second one created beside it.
2. Drop in a 3D model as `.glb` (or `.gltf`), e.g. `model.glb`.
   - Export from Blender/Cinema4D/etc. as glTF Binary (.glb) — keep it under
     a few MB for fast loading.
3. (Optional) drop in icons too — 512×512 transparent WebPs of just the
   product (no background), one per metal it can be shown in (not just its
   default — the product page's metal picker swaps the icon to match
   whichever finish is currently selected). Easiest way: set `"model"` and
   `"camera-setup"` below first, then run `npm run auto-render` (see
   "Re-rendering icons and metal swatches" further down) — it renders every
   metal's icon itself and fills in `"icons"` for you, guaranteed to match
   the model's pose since it's the exact same render pipeline. Only used as
   a fallback if `model` is left empty, or as a poster while the model loads.
4. Open that series' `data/series/<slug>/products.json` and add an entry to
   its `"products"` array:

```json
{
  "id": "04",
  "name": "Your Ring Name",
  "category": "ring",
  "description": "A line or two about the piece — shown on its product page.",
  "icons": {
    "steel":  "assets/series/bones/products/your-item-name_ring/your-ring-name_icon_steel.webp",
    "silver": "assets/series/bones/products/your-item-name_ring/your-ring-name_icon_silver.webp",
    "bronze": "assets/series/bones/products/your-item-name_ring/your-ring-name_icon_bronze.webp"
  },
  "photos": [],
  "assets": {
    "xray": "",
    "top-shot": { "steel": "", "silver": "", "bronze": "" }
  },
  "onHand": { "visible": false, "x": 50, "y": 50, "scale": 6, "rotation": 0 },
  "model": "assets/series/bones/products/your-item-name_ring/model.glb",
  "camera-setup": { "rotation": 0, "tilt": 75, "zoom": 105 },
  "metal": "silver",
  "metalDetails": {
    "steel":  { "price": 0, "weight": "", "composition": "" },
    "silver": { "price": 0, "weight": "", "composition": "" },
    "bronze": { "price": 0, "weight": "", "composition": "" }
  }
}
```

`id` only has to be unique **within this file** — every series numbers its
own products from `"01"`. `category` should be one the series declares in
its `"categories"` array in `data/series.json` (which must itself be a key
of that file's global `"categories"` vocabulary). Get this wrong and the
product still shows in the unfiltered grid but no filter button reaches it —
`npm run auto-render` warns about exactly this. The header's filter row is
rendered from the data, so there's nothing to hand-sync.

`"icons"` holds one entry per metal in `data/series.json`'s `"metals"` list, same
shape as `"metalDetails"` below — leave a metal's value as `""` until you
have a real render for it (`npm run auto-render` fills these in; nothing
else does). `"metal"` (singular, further down) is a separate field — it
only picks which of these icons the *homepage* grid card shows, since
there's no metal picker there to switch it.

Leave `"model": ""` if there's no 3D file yet — the card will just show
`icons[metal]` instead. The homepage card itself still displays nothing but
the model/icon and a `Name.category` label; `description` and
`metalDetails` only appear once you click through to the product page.
Reload the page and the new card appears automatically.

`metalDetails` holds one entry per metal in the top-level `"metals"` list,
each with `price` (a plain number — `0` renders as "Price on request", so
leave it `0` until you have a real price rather than inventing one),
`weight` and `composition` (free-text strings, left `""` until you have real
values). These are what the product page's Characteristics section shows,
and they re-render whenever a visitor switches the metal picker.

`photos` is extra photography for the product page's carousel, beyond the
always-present 3D model slide (or the `icons[metal]` fallback if there's no
model). Leave it as `[]` until you have real photos — the carousel hides its
arrows/dots entirely rather than showing a placeholder when there's only one
slide.

`assets` holds miscellaneous per-product files that aren't `icons`/`photos`:
`xray` (a single path, used as the carousel's backdrop — leave `""` until
you have one) and `top-shot` (one entry per metal, same shape as `icons` —
`npm run auto-render` fills these in too, same as icons).

`onHand` controls whether/how this product's `assets.top-shot[metal]`
image appears overlaid on the homepage hero's x-ray hand. Leave
`"visible": false` (with any placeholder `x`/`y`/`scale`/`rotation`) until
you've actually positioned it — `x`/`y` are the image's center as a % of
the hand image's own width/height, `scale` its width as a % of the same,
`rotation` in degrees. There's no live-preview tool for this the way
`camera-setup` at least has "drag it, read the values back"; easiest way
in practice is to open the homepage, guess-and-check by editing these
four and reloading, the same trial-and-error `camera-setup` itself
recommends just below. Any number of products can have `"visible": true`
at once — each gets its own independently-positioned overlay.

Sizes offered in the "Choose a size" popup aren't set per-product, and
aren't per-series either — they're a property of the *category*, declared
once in `data/series.json`'s global `"categories"` vocabulary. A ring is
52-62mm in every collection:

```json
"categories": {
  "ring":  { "sizes": ["52", "55", "57", "60", "62"], "unit": "mm" },
  "neck":  { "sizes": [], "unit": "" },
  "wrist": { "sizes": [], "unit": "" }
}
```

Leave a category with both an empty size list and an empty unit and the
"Select" button disables itself ("No sizes available") instead of opening
an empty popup, for any product in that category — a category with just a
unit set (and no standard sizes) still opens the popup with only the
custom-size field available.

## Adding a category

1. Add it to `data/series.json`'s **global** `"categories"` map, with its
   `sizes` and `unit` (both can start empty — see just above for what that
   does to the Select button).
2. Add its key to the `"categories"` array of each series that should offer
   it. That array is a subset of the global map's keys, in the order the
   header's filter row shows them — a series that doesn't sell the category
   simply omits it.

Nothing else. The header's filter buttons render from that per-series array,
so there's no markup to touch on any of the seven pages. `npm run auto-render`
warns if a series declares a category the global map doesn't define. Note
that the whole filter row stays hidden until a series' array has at least
two entries — see "Header rubrics" above.

## Adding a series

1. Create `data/series/<slug>/products.json` — `{ "series": "<slug>",
   "products": [] }` — and `data/series/<slug>/manifest.json` (see `data.md`
   for its shape; only `title`/`year`/`subtitle` are rendered today).
2. Create the hero bundle at `series/<slug>/hero.{html,css,js}`. Copy
   `series/bones/` as a starting point and read the contract in `pages.md`
   first — two rules bite otherwise: `hero.js` must have **no side effects
   at execution time** (it only assigns `window.EmjiveSeriesHero`), and it
   must **never use a bare specifier**, since Vite can't see a file loaded
   by runtime string path. A hero needing 3D calls `window.EmjiveModelViewer`.
3. Put that series' art under `assets/series/<slug>/hero/` and its product
   folders under `assets/series/<slug>/products/`.
4. Add an entry to `data/series.json`'s `"series"` array — slug, name, year,
   its `"categories"` subset, and paths to all of the above (see `data.md`).
5. **To make it the one the homepage shows, set `"featured"` to its slug.**
   That single field is the whole switch; the previous series stays fully
   reachable at `index.html?series=<old-slug>`, which is exactly what the
   archives page will link to.

No new HTML page is involved at any point — `index.html`, `product.html` and
`series.html` each already render any series.

### Setting a model's default view

Add `"camera-setup"` (and optionally `"cameraTarget"`) to a product entry to
control the angle it loads at. It's also the pose the model eases back to
smoothly whenever you let go after dragging it:

```json
"camera-setup": { "rotation": 0, "tilt": 75, "zoom": 105 }
```

`rotation` spins it left/right, `tilt` tilts it up/down (90 = eye-level),
`zoom` is a `%` of the distance that exactly frames the model's bounding
sphere (`js/three-viewer.js`'s `parseOrbitConfig()` — unlike the old
model-viewer-based system, `zoom` is always a percent, never an absolute
distance like `1.2m`). If `camera-setup` is omitted, it falls back to
`{ rotation: 0, tilt: 75, zoom: 105 }`.

There's no console helper like the old `model-viewer.getCameraOrbit()` to
read back an angle you've dragged to — `TrackballControls` doesn't track
orbit in these terms, it just holds a raw camera position. Easiest way
to find good numbers in practice: open the page, drag the model to the
angle you want it to default to as a visual reference, then edit
`camera-setup` in `products.json` and reload to compare, repeating until it
matches.

### Choosing a product's metal

Add `"metal"` to a product entry to pick which PBR material preset the
homepage card (and the product page, by default) applies to every mesh of
its 3D model, overriding whatever materials the model file itself has:

```json
"metal": "silver"
```

`metal` should be one of the values listed in the top-level `"metals"`
array in `data/series.json` — that list is global (not per-series) and is
the source of truth for what metals exist, and it's also what the product page's metal-picker swatches
are generated from. The actual presets live in `METAL_PRESETS` in
`js/three-viewer.js`: `"steel"`, `"silver"` (the default if `metal` is
omitted or unrecognized) and `"bronze"`. To add another finish, add it to
**three** places — the `"metals"` list in `data/series.json`, a matching
entry in `METAL_PRESETS` with its own `baseColorFactor` / `metallicFactor`
/ `roughnessFactor`, and a rendered swatch image for it in `css/style.css`
(`.product-metals__option[data-metal="..."]`, see "Re-rendering icons and
metal swatches" just below for how those are made) — and add a
`metalDetails` entry for it on every product, since the Characteristics
section looks values up by metal name.

The viewer construction itself (renderer/scene/camera setup, camera-orbit/
idle-reset behaviour, and applying `METAL_PRESETS`) lives in one place —
`buildThreeViewer()` in `js/three-viewer.js`, exposed as
`window.EmjiveModelViewer` — shared by both the homepage grid and the
product page's carousel, so a metal swap on the product page re-tints the
same model in place instead of reloading it or resetting the camera angle.

### Re-rendering icons and metal swatches after a shader change

A product's `icons`, its top shots (`assets.top-shot`), and the metal
picker's swatch bars (`css/style.css`'s
`.product-metals__option[data-metal="..."]`) are all real renders of the
PBR material — not hand-picked colors or gradients — using the exact same
`METAL_PRESETS` values the live 3D models use. All three also share the
same environment HDRI (`assets/hdri/studio_kontrast_04_1k.hdr`) — top
shots used to be lit with a plain `RoomEnvironment` instead, but that
override was removed since `window.EmjiveModelViewer` already sets the
studio HDRI before a render's `onReady` fires. If you change anything in
`METAL_PRESETS` or swap the HDRI file, **all three need to be re-rendered
to stay accurate**. Nothing regenerates any of them automatically.

```bash
npm install               # first time only — pulls in puppeteer-core + sharp
npm run auto-render                  # every metal
npm run auto-render -- steel bronze  # only these metals
```

This runs `scripts/auto-render.js`, which drives a real (non-headless-only)
Chrome instance through Puppeteer with GPU acceleration enabled
(`--use-angle=d3d11` on Windows), so the WebGL context gets proper
hardware MSAA — logged on startup as the WebGL renderer string; if that
ever prints `SwiftShader` instead of a real GPU name, output will still be
produced but without real antialiasing (set `CHROME_PATH` to point at a
Chrome build with GPU access if that happens). Crucially, it doesn't
hand-duplicate `METAL_PRESETS` or the viewer construction — it loads a bare
page that includes the real `js/three-viewer.js` (via an import map
resolving `three`/`three/addons/*` straight from `node_modules`, since this
bare page has no bundler of its own) and renders through
`window.EmjiveModelViewer()`, the exact same function `index.html` and
`product.html` use, so there's no risk of the render drifting from what
the site actually shows. See `tooling.md` for the harness's own structure.

For each metal passed in (or every metal in `data/series.json`'s `"metals"`
list, if none are given), across every series (or just one, with
`--series=<slug>`):

- **Icons** — every product, not just the ones whose own `"metal"` (their
  homepage-grid default) happens to equal the metal being rendered: the
  product page's metal picker swaps the icon (label thumbnail, and the
  poster/fallback for model-less products) to match whichever finish is
  currently selected, so every product needs one for every metal it could
  be shown in. Saved as a transparent 512×512 WebP named
  `<productname>_icon_<metal>.webp` next to the product's model
  (e.g. `assets/series/bones/products/furcula_ring/furcula_icon_steel.webp`), and
  that series' own `products.json` has its `"icons"` entry for that product updated in
  place to match (the previous file for that metal is deleted if the path
  changed). Uses the product's own `model` + `camera-setup` from
  `products.json`, and the same shared studio HDRI (`assets/hdri/studio_kontrast_04_1k.hdr`)
  the live site uses.
- **Top shots** — one per product per metal, same as icons, and lit with
  that same studio HDRI (set by `window.EmjiveModelViewer` itself before
  `onReady` fires — the harness used to swap in a plain `RoomEnvironment`
  here instead, three.js's stand-in for a neutral studio IBL, but that
  override was removed as an unnecessary divergence). A straight-down view
  (`{ rotation: 0, tilt: 0, zoom }`, reusing the product's own `camera-setup`
  zoom but always rotation 0 for a canonical top-down framing regardless
  of that product's own default rotation) plus a soft contact shadow (a
  radial-gradient texture generated on the fly with a 2D canvas, not a
  static asset, on a plane positioned at the model's bounding-sphere
  floor), rather than the flat, shadow-free cutout look of the icons.
  Also includes an invisible "finger" occluder plane, so the ring's own
  geometry that a real finger would hide (the band's inner wall, or a
  gap in an open shank) doesn't show through once the shot is composited
  onto a hand image — see `tooling.md`'s `scripts/auto-render.js` section
  for the mechanics and its known trade-off. Saved as a 1024×1024 WebP
  named `<productname>_top-shot_<metal>.webp` next to the product's
  model, and that series' own `products.json` has its `assets.top-shot` entry for that
  product is updated in place the same way `"icons"` is — and read live
  by the homepage hero's ring-on-hand overlay, see the product's own
  `onHand` field (`data.md`) and `pages.md`'s `index.html` section.
- **One metal sample bar**, regardless of whether any product defaults to
  it — saved as `assets/metal-sample_<metal>.webp` (240×240). **Not** a
  render of any actual product — `js/three-viewer.js`'s
  `buildMaterialSwatch(metalKey, sizePx)` builds a plain cylinder instead
  (its own dedicated scene: same `METAL_PRESETS` material + the same HDRI
  file loaded via `loadEnvironment()`, but no GLTF, no product-relative
  camera-orbit framing). This replaced an
  earlier version that rendered a close-up crop of the Disc ring's own
  curve: a torus viewed edge-on is always a thin diagonal band in a square
  frame, leaving empty corners at any zoom (its silhouette never exceeds a
  square frame's bounds the way a solid convex shape's does) — the crop
  rectangle chasing that band around the frame was fragile and, after the
  three.js migration changed the framing math, stopped landing well.
  A cylinder viewed from the side has a rectangular silhouette instead,
  sized and positioned (camera distance as a fraction of the exact-
  tangent-fit distance — see the function's own comment for the exact
  tuning trade-off) to exceed the square frame in both dimensions, so the
  render is always fully covered with no cropping needed at all. CSS
  applies the result via `background: url(...) center / cover`, so the
  render only needs to look good as a plain square — `cover` handles
  fitting it into the swatch bar's actual thin/wide shape at any width
  (`.product-metals__option`'s `clamp(90px, 18cqw, 180px)`).

All three are captured at 2x the final pixel size and downscaled with
`sharp` — real GPU MSAA already handles edge antialiasing, this step is
just for retina-sharp source pixels before the final resize.

## Header rubrics (nav vs. informative)

The dropdown menu (`.site-header__nav`) has exactly three rows, in this
order: Creation process, then Archives, then the category filter row.
Links come in two kinds, styled identically except for font:

- `class="is-info"` — DINish, used for the two informative links (Creation
  process, Archives).
- `class="is-cat"` — Geist Mono (loaded from Google Fonts already), used for
  the category filter buttons. **These are rendered by `js/main.js` from the
  active series' own category list — never hand-write them**, and don't
  assume there are three. `.is-active` marks the selected ones. The whole
  row hides itself (`hidden` on `#siteHeaderFilter`) once that list is down
  to one category or fewer — there's nothing to filter with a single button.

Filtering is multi-select and in-place on `index.html`, reflected as
`?cat=ring,neck`; from any other page the same button is an ordinary link
that navigates to the grid with that one category applied.

The header row's empty space (excluding the brand logo and the toggle
button itself) also opens/closes the menu, same as the `+`/`-` icon —
see `client-scripts.md`'s `js/main.js` entry. Both the header menu and the
selection-bar drawer close on an outside click via `window.EmjiveMenus`
(`js/series.js`) — see the same doc.

DINish isn't on any font CDN — it's a free (SIL OFL licensed) font by Bert
Driehuis. The family already lives in this repo at `assets/fonts/dinish-woff2/`
(43 files — every weight/width/italic combination); only the one file the
CSS actually references needs to exist for the site to work:

```
assets/fonts/dinish-woff2/DINish-Regular.woff2
```

If you're setting this up fresh elsewhere, that's the one file to fetch
(SIL OFL license, e.g. from Befonts) and place at that exact path — the
`@font-face` rule in `css/style.css` points there specifically, and only
`.woff2` is needed for modern browsers. Until that file exists there,
`is-info` text falls back to the browser's default sans-serif. (See
`styling.md` for a separate, real bug in that `@font-face` rule that can
prevent it from loading even when the file is present.)

## Selection

Adding an item (from a product page's "Choose a size" popup) writes to
`localStorage` via `window.EmjiveSelection` (`js/selection.js`) — a real,
working selection, not a placeholder, and dispatches an
`"emjive:selection-changed"` event on every add/remove/insert/update so any
page can react live without a reload.

Two things read it back:
- The floating selection bar (`js/selection-bar.js`), present on every page
  except `launch-order.html` — always visible, shows a thumbnail strip (or
  "No selected item") and an "Order ›" link, with a drawer for removing
  individual items.
- `launch-order.html` (`js/selection-page.js`) — the full checkout review:
  item rows you can modify (metal/size, in a popup reusing the product
  page's own size-selection modal) or unselect (with a "Undo" bar for a few
  seconds), a shipping pick, a terms toggle, and a "Proceed to checkout" bar
  gated on both — falling back to a centered "No item selected." state once
  it's empty again. See `client-scripts.md` for the mechanics.

"Proceed to checkout" is still a stub — no Stripe session, no backend to
hand off to yet. Clicking it (once shipping + terms are filled in) just
shows an alert saying so.

## Contact form

The contact form currently doesn't send anywhere — it just shows an alert.
To make it work, wire it to a form backend, e.g.:

- [Formspree](https://formspree.io) — add `action="https://formspree.io/f/yourFormId"`
  and `method="POST"` to the `<form>` in `index.html`, remove the JS
  `preventDefault` alert in `js/main.js`.
- Netlify Forms (if you host on Netlify) — add `data-netlify="true"` to the form.
