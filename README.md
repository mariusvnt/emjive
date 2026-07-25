# em·ji·ve — website

A basic static site for the brand: a product grid that shows each item as
just its 3D model (glTF/GLB, click-and-drag to rotate — falls back to a
photo if no model is set yet), plus a Contact section. Plain HTML/CSS/JS,
no build step.

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
4. Open `data/products.json` and add an entry:

```json
{
  "id": "04",
  "name": "Your Ring Name",
  "image": "assets/products/your-item-name/image.jpg",
  "model": "assets/products/your-item-name/model.glb"
}
```

Leave `"model": ""` if there's no 3D file yet — the card will just show the
`image` instead. The card itself displays nothing but the model/image (no
name, price, or description shown on the page — `name` is only used as alt
text). Reload the page and the new card appears automatically.

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

### Choosing a product's shader

Add `"shader"` to a product entry to pick which PBR material preset gets
applied to every mesh of its 3D model, overriding whatever materials the
model file itself has:

```json
"shader": "gold"
```

Available presets live in `SHADER_PRESETS` in `js/main.js`: `"silver"`
(the default if `shader` is omitted or unrecognized) and `"gold"`. To add
another finish (brass, patinated, etc.), add an entry there with its own
`baseColorFactor` / `metallicFactor` / `roughnessFactor`.

## Header rubrics (nav vs. informative)

Links inside the header's dropdown menu (`.site-header__nav`) come in two
kinds, styled identically except for font:

- `class="is-nav"` — Geist Mono (loaded from Google Fonts already).
- `class="is-info"` — DINish.

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
cart.html            Order/cart page (placeholder — no cart logic wired up yet)
css/style.css        All styling
js/main.js           Renders products.json into cards (model-viewer or image)
data/products.json    Product list — edit this to add/remove/change items
assets/products/...   Per-product images + 3D models
```

## Where we go next

This is intentionally a starting skeleton so we can refine the aesthetic
together — colors, type, layout, animations, real photography, and real 3D
models can all evolve from here.
