# em·ji·ve — website

A basic static site for the brand: a product grid that shows each item as
just its 3D model (glTF/GLB, click-and-drag to rotate — falls back to a
photo if no model is set yet), plus a Contact section. Clicking a product's
name opens its detail page (`product.html?id=...`) — a carousel, a metal
picker, a description, metal-dependent specs, and a "Select size" flow that
adds to a real (localStorage-backed) cart, viewable on `cart.html`. Plain
HTML/CSS/JS, no build step.

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
3. (Optional) drop in a photo too, e.g. `image.jpg` — only used as a
   fallback if `model` is left empty, or as a poster while the model loads.
4. Open `data/products.json` and add an entry to the `"products"` array:

```json
{
  "id": "04",
  "name": "Your Ring Name",
  "category": "ring",
  "description": "A line or two about the piece — shown on its product page.",
  "image": "assets/products/your-item-name/image.jpg",
  "images": [],
  "model": "assets/products/your-item-name/model.glb",
  "cameraOrbit": "0deg 75deg 105%",
  "metal": "silver",
  "sizes": ["50", "52", "54", "56", "58", "60"],
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

Leave `"model": ""` if there's no 3D file yet — the card will just show the
`image` instead. The homepage card itself still displays nothing but the
model/image and a `Name.category` label; `description` and `metalDetails`
only appear once you click through to the product page. Reload the page and
the new card appears automatically.

`metalDetails` holds one entry per metal in the top-level `"metals"` list,
each with `price` (a plain number — `0` renders as "Price on request", so
leave it `0` until you have a real price rather than inventing one),
`weight` and `composition` (free-text strings, left `""` until you have real
values). These are what the product page's Characteristics section shows,
and they re-render whenever a visitor switches the metal picker.

`images` is extra photography for the product page's carousel, beyond the
always-present 3D model slide (or the `image` fallback if there's no
model). Leave it as `[]` until you have real photos — the carousel hides its
arrows/dots entirely rather than showing a placeholder when there's only one
slide.

`sizes` is the list offered in the "Select size" popup before an item is
added to the cart. Leave it empty and the button disables itself
("No sizes available") instead of opening an empty popup.

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
`roughnessFactor`, and a swatch color for it in `css/style.css`
(`.product-metals__option[data-metal="..."]`) — and add a `metalDetails`
entry for it on every product, since the Characteristics section looks
values up by metal name.

The model-viewer construction itself (attributes, camera-orbit/reset
behaviour, and applying `METAL_PRESETS`) lives in one place —
`buildModelViewer()` in `js/main.js`, exposed as `window.EmjiveModelViewer`
— shared by both the homepage grid and the product page's carousel, so a
metal swap on the product page re-tints the same model in place instead of
reloading it or resetting the camera angle.

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

## Cart

Adding an item (from a product page's "Select size" popup) writes to
`localStorage` via `window.EmjiveCart` (`js/cart.js`) — a real, working
cart, not a placeholder. `cart.html` (`js/cart-page.js`) reads it back and
renders line items with a remove button and a running total, falling back
to the original "Your cart is currently empty" state once it's empty again.
There's no checkout/payment step wired up yet — this only covers building
and viewing the cart itself.

## Contact form

The contact form currently doesn't send anywhere — it just shows an alert.
To make it work, wire it to a form backend, e.g.:

- [Formspree](https://formspree.io) — add `action="https://formspree.io/f/yourFormId"`
  and `method="POST"` to the `<form>` in `index.html`, remove the JS
  `preventDefault` alert in `js/main.js`.
- Netlify Forms (if you host on Netlify) — add `data-netlify="true"` to the form.

## Structure

```
index.html          Main page (hero, products, contact)
product.html         Product detail page (carousel, metal picker, specs, select/cart)
cart.html            Order/cart page — renders window.EmjiveCart's contents
css/style.css        All styling
js/main.js           Renders products.json into cards (model-viewer or image)
js/product.js        Product detail page logic
js/cart.js           Shared localStorage cart (window.EmjiveCart)
js/cart-page.js       Renders the cart on cart.html
data/products.json    Product list — edit this to add/remove/change items
assets/products/...   Per-product images + 3D models
```

## Where we go next

This is intentionally a starting skeleton so we can refine the aesthetic
together — colors, type, layout, animations, real photography, and real 3D
models can all evolve from here. Foramen and Disc still have no photography
and every product's `metalDetails` is missing real weight/composition data
(and price, for everything but Furcula's silver) — fill those in as they
become available.
