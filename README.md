# em·ji·ve — website

A basic static site for the brand: a product grid that shows each item as
just its 3D model (glTF/GLB, click-and-drag to rotate — falls back to a
photo if no model is set yet), plus a Contact section. Clicking a product's
name opens its detail page (`product.html?id=...`) — a carousel, a metal
picker, a description, metal-dependent specs, and a "Select size" flow that
adds to a real (localStorage-backed) selection, viewable on
`launch-order.html`, plus a floating selection bar present on every other
page. Plain HTML/CSS/JS, no build step.

## Running it locally

Because the product grid loads `data/products.json` via `fetch`, you can't
just double-click `index.html` (browsers block `fetch` on `file://`). Run a
tiny local server from this folder instead:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

or, if you have Node:

```bash
npx serve .
```

## Adding a product

1. Make a folder under `assets/products/your-item-name/`.
2. Drop in a 3D model as `.glb` (or `.gltf`), e.g. `model.glb`.
   - Export from Blender/Cinema4D/etc. as glTF Binary (.glb) — keep it under
     a few MB for fast loading.
3. (Optional) drop in icons too — 512×512 transparent WebPs of just the
   product (no background), one per metal it can be shown in (not just its
   default — the product page's metal picker swaps the icon to match
   whichever finish is currently selected). Easiest way: set `"model"` and
   `"cameraOrbit"` below first, then run `npm run auto-render` (see
   "Re-rendering icons and metal swatches" further down) — it renders every
   metal's icon itself and fills in `"icons"` for you, guaranteed to match
   the model's pose since it's the exact same render pipeline. Only used as
   a fallback if `model` is left empty, or as a poster while the model loads.
4. Open `data/products.json` and add an entry to the `"products"` array:

```json
{
  "id": "04",
  "name": "Your Ring Name",
  "category": "ring",
  "description": "A line or two about the piece — shown on its product page.",
  "icons": {
    "steel":  "assets/products/your-item-name/your-ring-name_icon_steel.webp",
    "silver": "assets/products/your-item-name/your-ring-name_icon_silver.webp",
    "bronze": "assets/products/your-item-name/your-ring-name_icon_bronze.webp"
  },
  "photos": [],
  "assets": {
    "xray": "",
    "top-shot": { "steel": "", "silver": "", "bronze": "" }
  },
  "model": "assets/products/your-item-name/model.glb",
  "cameraOrbit": "0deg 75deg 105%",
  "metal": "silver",
  "metalDetails": {
    "steel":  { "price": 0, "weight": "", "composition": "" },
    "silver": { "price": 0, "weight": "", "composition": "" },
    "bronze": { "price": 0, "weight": "", "composition": "" }
  }
}
```

`category` should be one of the values listed in the top-level `"categories"`
array in that same file — that list is the source of truth for what
categories exist (the header's `.ring`/`.neck`/`.wrist` menu is hand-written
though, not generated from it, so keep the two in sync by hand if you add a
new category).

`"icons"` holds one entry per metal in the top-level `"metals"` list, same
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

Sizes offered in the "Choose a size" popup before an item is added to the
selection aren't set per-product — they're looked up from two top-level
objects by the product's own `"category"`, since a size run is a property
of the category (all rings share one, all necklaces would share another)
rather than of the individual piece: `"sizesByCategory"` (the standard
sizes) and `"sizeUnits"` (the unit label shown next to the popup's custom-
size field, e.g. `"mm"` for rings):

```json
"sizesByCategory": {
  "ring": ["50", "52", "54", "56", "58", "60"],
  "neck": [],
  "wrist": []
},
"sizeUnits": {
  "ring": "mm",
  "neck": "",
  "wrist": ""
}
```

Leave a category with both an empty size list and an empty unit and the
"Select" button disables itself ("No sizes available") instead of opening
an empty popup, for any product in that category — a category with just a
unit set (and no standard sizes) still opens the popup with only the
custom-size field available.

### Setting a model's default view

Add `"cameraOrbit"` (and optionally `"cameraTarget"`) to a product entry to
control the angle it loads at. It's also the pose the model eases back to
smoothly whenever you let go after dragging it:

```json
"cameraOrbit": "0deg 75deg 105%"
```

The format is `"<theta>deg <phi>deg <radius>"` — theta spins it left/right,
phi tilts it up/down (90deg = eye-level), radius is zoom (as a `%` of the
default framing, or a distance like `1.2m`). Easiest way to find good
numbers for a specific model: open the page, drag the model to the angle
you want, then in the browser console run

```js
document.querySelector('model-viewer').getCameraOrbit()
```

and convert the returned `{theta, phi, radius}` (radians + meters) into the
`"Xdeg Ydeg Zm"` string format above. If `cameraOrbit` is omitted, it just
uses model-viewer's own default framing.

### Choosing a product's metal

Add `"metal"` to a product entry to pick which PBR material preset the
homepage card (and the product page, by default) applies to every mesh of
its 3D model, overriding whatever materials the model file itself has:

```json
"metal": "silver"
```

`metal` should be one of the values listed in the top-level `"metals"`
array in `products.json` — that list is the source of truth for what
metals exist, and it's also what the product page's metal-picker swatches
are generated from. The actual presets live in `METAL_PRESETS` in
`js/main.js`: `"steel"`, `"silver"` (the default if `metal` is omitted or
unrecognized) and `"bronze"`. To add another finish, add it to **three**
places — the `"metals"` list in `products.json`, a matching entry in
`METAL_PRESETS` with its own `baseColorFactor` / `metallicFactor` /
`roughnessFactor`, and a rendered swatch image for it in `css/style.css`
(`.product-metals__option[data-metal="..."]`, see "Re-rendering icons and
metal swatches" just below for how those are made) — and add a
`metalDetails` entry for it on every product, since the Characteristics
section looks values up by metal name.

The model-viewer construction itself (attributes, camera-orbit/reset
behaviour, and applying `METAL_PRESETS`) lives in one place —
`buildModelViewer()` in `js/main.js`, exposed as `window.EmjiveModelViewer`
— shared by both the homepage grid and the product page's carousel, so a
metal swap on the product page re-tints the same model in place instead of
reloading it or resetting the camera angle.

### Re-rendering icons and metal swatches after a shader change

A product's `icons`, its top shots (`assets.top-shot`), and the metal
picker's swatch bars (`css/style.css`'s
`.product-metals__option[data-metal="..."]`) are all real renders of the
PBR material — not hand-picked colors or gradients — using the exact same
`METAL_PRESETS` values the live 3D models use. Icons and swatches also
share the same environment HDRI (`assets/hdri/studio_kontrast_04_1k.hdr`);
top shots deliberately don't (see below). If you change anything in
`METAL_PRESETS`, **all three need to be re-rendered to stay accurate** —
swapping the HDRI only affects icons/swatches, not top shots. Nothing
regenerates any of them automatically.

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
hand-duplicate `METAL_PRESETS` or the model-viewer setup — it loads a bare
page that includes the real `js/main.js` and renders through
`window.EmjiveModelViewer()`, the exact same function `index.html` and
`product.html` use, so there's no risk of the render drifting from what
the site actually shows.

For each metal passed in (or every metal in `products.json`'s `"metals"`
list, if none are given):

- **Icons** — every product, not just the ones whose own `"metal"` (their
  homepage-grid default) happens to equal the metal being rendered: the
  product page's metal picker swaps the icon (label thumbnail, and the
  poster/fallback for model-less products) to match whichever finish is
  currently selected, so every product needs one for every metal it could
  be shown in. Saved as a transparent 512×512 WebP named
  `<productname>_icon_<metal>.webp` next to the product's model
  (e.g. `assets/products/furcula_ring/furcula_icon_steel.webp`), and
  `data/products.json`'s `"icons"` object for that product is updated in
  place to match (the previous file for that metal is deleted if the path
  changed). Uses the product's own `model` + `cameraOrbit` from
  `products.json`.
- **Top shots** — one per product per metal, same as icons. A straight-down
  view (`camera-orbit: 0deg 0deg <radius>`, reusing the product's own
  `cameraOrbit` radius but always theta 0deg for a canonical top-down
  framing regardless of that product's own default rotation) lit *without*
  the studio HDRI — no `environment-image` at all, just model-viewer's own
  plain built-in environment — plus a soft contact shadow
  (`shadow-intensity`/`shadow-softness: 1`), rather than the flat,
  shadow-free cutout look of the icons. Saved as a 1024×1024 WebP named
  `<productname>_top-shot_<metal>.webp` next to the product's model, and
  `data/products.json`'s `assets.top-shot` object for that product is
  updated in place the same way `"icons"` is.
- **One metal sample bar**, regardless of whether any product defaults to
  it — saved as `assets/metal-sample_<metal>.webp` (240×240). Rendered
  from the Disc ring model (`assets/products/disc_ring/disc_gltf.glb` —
  used purely as a source of smoothly curved metal surface, not as a
  "reference" model) at a fixed close-up framing:
  `camera-orbit: -90deg 90deg 1.5%`, with `min-camera-orbit: auto auto 1%`
  to override model-viewer's own default, which otherwise clamps closer
  zoom than that. That framing fills most, but not quite all, of the
  frame, so the script also crops a 520×520 square starting at `(220,
  200)` out of a 900×900 capture before the final downscale, to trim the
  empty corners it leaves. CSS applies the result via
  `background: url(...) center / cover`, so the render only needs to look
  good as a small square crop — `cover` handles fitting it into the
  swatch bar's actual thin/wide shape at any width
  (`.product-metals__option`'s `clamp(90px, 18cqw, 180px)`).

All three are captured at 2x the final pixel size and downscaled with
`sharp` — real GPU MSAA already handles edge antialiasing, this step is
just for retina-sharp source pixels before the final resize.

## Header rubrics (nav vs. informative)

Links inside the header's dropdown menu (`.site-header__nav`) come in two
kinds, styled identically except for font:

- `class="is-cat"` — Geist Mono (loaded from Google Fonts already), used
  for the category rubrics (`.ring`, `.neck`, `.wrist`).
- `class="is-info"` — DINish, used for informative links ("About us").

DINish isn't on any font CDN — it's a free (SIL OFL licensed) font by Bert
Driehuis. Download it (e.g. from Befonts) and drop the files at:

```
assets/fonts/DINish-Regular.woff2
assets/fonts/DINish-Regular.woff
assets/fonts/DINish-Regular.ttf
```

(only `.woff2` is really needed for modern browsers — the others are just
older-browser fallbacks). Until those files exist, `is-info` text falls
back to the browser's default sans-serif.

## Selection

Adding an item (from a product page's "Choose a size" popup) writes to
`localStorage` via `window.EmjiveSelection` (`js/selection.js`) — a real,
working selection, not a placeholder, and dispatches an
`"emjive:selection-changed"` event on every add/remove/clear so any page
can react live without a reload.

Two things read it back:
- The floating selection bar (`js/selection-bar.js`), present on every page
  except `launch-order.html` — always visible, shows a thumbnail strip (or
  "No selected item") and an "Order ›" link, with a drawer for removing
  individual items.
- `launch-order.html` (`js/selection-page.js`) — the full order page,
  renders line items with a remove button and a running total, falling
  back to the "Nothing selected yet" state once it's empty again.

There's no checkout/payment step wired up yet — this only covers building
and viewing the selection itself.

## Contact form

The contact form currently doesn't send anywhere — it just shows an alert.
To make it work, wire it to a form backend, e.g.:

- [Formspree](https://formspree.io) — add `action="https://formspree.io/f/yourFormId"`
  and `method="POST"` to the `<form>` in `index.html`, remove the JS
  `preventDefault` alert in `js/main.js`.
- Netlify Forms (if you host on Netlify) — add `data-netlify="true"` to the form.

## Structure

```
index.html            Main page (hero, products, contact)
product.html          Product detail page (carousel, metal picker, specs, select/size)
launch-order.html     Order page — renders window.EmjiveSelection's contents
css/style.css         All styling
js/main.js            Renders products.json into cards (model-viewer or icon)
js/product.js         Product detail page logic
js/selection.js       Shared localStorage selection (window.EmjiveSelection)
js/selection-bar.js   Floating selection bar (every page except launch-order.html)
js/selection-page.js  Renders the selection on launch-order.html
data/products.json    Product list — edit this to add/remove/change items
assets/products/...   Per-product images + 3D models
scripts/auto-render.js `npm run auto-render` — re-renders icons + metal swatches (see above)
```

## Where we go next

This is intentionally a starting skeleton so we can refine the aesthetic
together — colors, type, layout, animations, real photography, and real 3D
models can all evolve from here. Foramen and Disc still have no photography
and every product's `metalDetails` is missing real weight/composition data
(and price, for everything but Furcula's silver) — fill those in as they
become available.
