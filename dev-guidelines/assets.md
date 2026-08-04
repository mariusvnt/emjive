# Assets

`assets/` is static binary content. The only thing that writes into it programmatically is `scripts/auto-render.js`, into `assets/series/<slug>/products/*/` and the top-level `metal-sample_*.webp` files (see `tooling.md`).

## The split: series-scoped vs global

```text
assets/
  series/bones/
    hero/      hand-rings-under-flesh_4k.webp, hand_xray.webp,
               hand_xray_extension_1.webp, hand_xray_extension_2.webp
    products/  furcula_ring/  foramen_ring/  disc_ring/  marrow_ring/
  fonts/                            ─┐
  hdri/                              │
  logo.svg, logo_compact.svg         ├─ global — every series shares these
  metal-sample_{steel,silver,bronze}.webp
  hand-pointer-thumb-opened.svg     ─┘
```

Anything under `assets/series/<slug>/` belongs to that collection and dies with it; everything else is brand-level and referenced from series-unaware code. That boundary isn't a guess — it's exactly what the global code paths point at: `css/style.css`'s only `url()`s are the three `@font-face` rules and the three `.product-metals__option[data-metal]` swatches, `js/three-viewer.js` hardcodes `assets/hdri/...` and the pointer SVG, and `auto-render.js` writes `assets/metal-sample_<metal>.webp`.

**Paths are repo-root-relative with no leading slash** everywhere they appear (JSON fields, `<img src>` in a hero fragment). The one exception is `url()` inside a series' `hero.css`, which resolves against the CSS file instead (`../../assets/...`) — see `pages.md`.

## `series/<slug>/hero/`

That series' homepage hero art, referenced from its `hero.html` fragment and preloaded via the `hero.preload` list in `data/series.json`.

For Bones: WebP (quality 90) rather than PNG, since these are full-bleed photographic renders where the lossy compression buys a large size win with no visible quality loss. `hand-rings-under-flesh_4k.webp` (5760×3240 — same 16:9 ratio as the other three at 3840×2160, just a higher native resolution) is `.reveal__img--normal`'s source, showing the ring shapes already embossed under the skin — reworked to also embed the "SCROLL TO SCAN" hint directly into the image itself, like a tattoo on the skin, replacing the separate `.reveal__scan-hint` DOM element/CSS/JS that used to render that text on top (removed entirely — see `styling.md`/`client-scripts.md`).

## `series/<slug>/products/<slug>_<category>/`

One folder per product, matching that series' `products.json` path fields:

```text
disc_ring/       disc_gltf.glb, disc_icon_{bronze,silver,steel}.webp, disc_fallback-img_{bronze,silver,steel}.webp, disc_top-shot_{bronze,silver,steel}.webp
foramen_ring/    Foramen_gltf.glb, foramen_icon_{bronze,silver,steel}.webp, foramen_fallback-img_{bronze,silver,steel}.webp, foramen_top-shot_{bronze,silver,steel}.webp
furcula_ring/    furcula_gltf.glb, furcula_icon_{bronze,silver,steel}.webp, furcula_fallback-img_{bronze,silver,steel}.webp, furcula_top-shot_{bronze,silver,steel}.webp,
                 furcula-xray.png, Furcula_photo1.png, Furcula_photo2.png
marrow_ring/     Marrow_gltf.glb, marrow_icon_{bronze,silver,steel}.webp, marrow_fallback-img_{bronze,silver,steel}.webp, marrow_top-shot_{bronze,silver,steel}.webp
```

**Naming conventions:**
- Folder: `<slug>_<category>` (lowercase product name + underscore + category). **This one is load-bearing now** — `auto-render.js` *constructs* the render output path from `assets/series/<slug>/products/<slug(name)>_<category>/` rather than reading it off `product.assets.model`, so a hand-renamed folder gets a new one created beside it instead of being silently found. It warns when a model sits outside the folder the convention predicts.
- Model file: `<name>_gltf.glb` — capitalization follows whoever exported it (`Foramen_gltf.glb` and `Marrow_gltf.glb` are capitalized, the other two aren't) — hand-authored/exported, not machine-generated, so don't assume consistent casing when scripting against it.
- Icons/fallback images/top-shots: always `<slugified-name>_icon_<metal>.webp` / `<slugified-name>_fallback-img_<metal>.webp` / `<slugified-name>_top-shot_<metal>.webp`, generated and kept in sync by `scripts/auto-render.js` — these ARE consistently lowercase, since the slug function produces them. `icon` and `fallback-img` come from the exact same underlying screenshot (one capture, two saves — see `tooling.md`), just processed differently.
- Extra photography (`assets.photos` field): `<Name>_photo<N>.png` — capitalized to match the product name, `.png` not `.webp`, hand-added (Furcula is currently the only product with any).
- X-ray backdrop (`assets.xray` field): `<slug>-xray.png` — hyphenated, hand-added (Furcula only, currently).

## Global items

- `hdri/studio_kontrast_04_1k.hdr` — the studio environment HDRI (the `_2k.hdr` variant that used to sit alongside it was removed — the 1k version is the only one anything ever loaded). Loaded by `js/three-viewer.js`'s `loadEnvironment()`, used by the live site and by every one of `scripts/auto-render.js`'s renders — icons, swatches, and top shots alike (top shots used to be lit with a plain `RoomEnvironment` instead; that override was removed, see `procedures.md`).
- `logo.svg`, `logo_compact.svg` — brand marks.
- `metal-sample_steel.webp`, `metal-sample_silver.webp`, `metal-sample_bronze.webp` — the metal-picker swatch bars, generated by `scripts/auto-render.js`, referenced from `css/style.css`'s `.product-metals__option[data-metal="..."]` rules. Global by nature: a material sample, not any product.
- `hand-pointer-thumb-opened.svg` — the floating hand icon in `js/three-viewer.js`'s idle "nudge" hint.
- `hand_normal.webp` — **dead**. The plain hand that `hand-rings-under-flesh_4k.webp` replaced; no live HTML/CSS/JS references it. Left on disk rather than deleted, same as `hand_xray_white.png` was before it was removed outright — deleting a binary is a separate call from a doc pass.

## `fonts/dinish-woff2/` — 43 files

The full DINish family (every weight/width/italic combination). Only three files are actually referenced by the site's CSS — `DINish-Regular.woff2` (400), `DINish-Bold.woff2` (700), `DINish-Black.woff2` (900) — at exactly these paths:

```text
assets/fonts/dinish-woff2/DINish-Regular.woff2
```

That's the path `css/style.css`'s first `@font-face` rule points at, and it exists on disk — so the font file itself isn't the problem if DINish isn't rendering. See `styling.md`'s note: that rule previously had a real syntax bug (a trailing comma in its `src` value) that made browsers drop the whole declaration regardless of the file being present and correctly pathed.

## Pointers

- Which JSON fields point at these files: `data.md`
- What generates the icon/top-shot/swatch files: `tooling.md`
- How a hero bundle references its own art: `pages.md`
- Step-by-step "add a product" / "add a series" / "set up DINish": `procedures.md`
