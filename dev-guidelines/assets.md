# Assets

`assets/` is static binary content. Two things write into it programmatically: `scripts/auto-render.js`, into `assets/series/<slug>/products/*/` (the `icons`/`fallback-img`/`top-shot` triad only) and the top-level `metal-sample_*.webp` files; and `npm run json-tool`, into the same per-product folders (model/x-ray/photos only — it never touches the same three auto-render owns) plus `assets/hdri/*.hdr` and the folders themselves (creating a new product/series' folders, deleting a removed one's) — see `tooling.md` for both.

## The split: series-scoped vs global

```text
assets/
  series/bones/
    hero/      hand-rings-under-flesh_4k.webp, hand_xray.webp,
               hand_xray_extension_1.webp, hand_xray_extension_2.webp
    products/  furcula_ring/  foramen_ring/  disc_ring/  marrow_ring/
               suture_ring/  cartilage_ring/  rib-cage_ring/  rib-cage-extended_ring/
  draco/                             ─┐
  fonts/  dinish-woff2/               │
          geist-mono-woff2/           │
  hdri/                               │
  logo.svg, logo_compact.svg          ├─ global — every series shares these
  metal-sample_{steel,silver,bronze}.webp
  hand-pointer-thumb-opened.svg      ─┘
```

Anything under `assets/series/<slug>/` belongs to that collection and dies with it; everything else is brand-level and referenced from series-unaware code. That boundary isn't a guess — it's exactly what the global code paths point at: `css/style.css`'s only `url()`s are the five `@font-face` rules (three DINish weights + two Geist Mono subsets) and the three `.product-metals__option[data-metal]` swatches, `js/three-viewer.js` hardcodes the pointer SVG and its `DEFAULT_HDRI_SRC` fallback (`assets/hdri/studio_kontrast_04_1k.hdr` — the real per-call choice comes from `data/series.json`'s `"hdris"` map instead, see below), and `auto-render.js` writes `assets/metal-sample_<metal>.webp`.

**Paths are repo-root-relative with no leading slash** everywhere they appear (JSON fields, `<img src>` in a hero fragment). The one exception is `url()` inside a series' `hero.css`, which resolves against the CSS file instead (`../../assets/...`) — see `pages.md`.

## `series/<slug>/hero/`

That series' homepage hero art, referenced from its `hero.html` fragment and preloaded via the `hero.preload` list in `data/series.json`.

For Bones: WebP (quality 90) rather than PNG, since these are full-bleed photographic renders where the lossy compression buys a large size win with no visible quality loss. `hand-rings-under-flesh_4k.webp` (5760×3240 — same 16:9 ratio as the other three at 3840×2160, just a higher native resolution) is `.reveal__img--normal`'s source, showing the ring shapes already embossed under the skin — reworked to also embed the "SCROLL TO SCAN" hint directly into the image itself, like a tattoo on the skin, replacing the separate `.reveal__scan-hint` DOM element/CSS/JS that used to render that text on top (removed entirely — see `styling.md`/`client-scripts.md`).

## `series/<slug>/products/<slug>_<category>/`

One folder per product, matching that series' `products.json` path fields:

```text
disc_ring/                disc_gltf.glb, disc_icon_{bronze,silver,steel}.webp, disc_fallback-img_{bronze,silver,steel}.webp, disc_top-shot_{bronze,silver,steel}.webp, disc_xray.webp
foramen_ring/              Foramen_gltf.glb, foramen_icon_{bronze,silver,steel}.webp, foramen_fallback-img_{bronze,silver,steel}.webp, foramen_top-shot_{bronze,silver,steel}.webp, foramen_xray.webp
furcula_ring/              furcula_gltf.glb, furcula_icon_{bronze,silver,steel}.webp, furcula_fallback-img_{bronze,silver,steel}.webp, furcula_top-shot_{bronze,silver,steel}.webp,
                           furcula_xray.webp, Furcula_photo1.webp, Furcula_photo2.webp
marrow_ring/               Marrow_gltf.glb, marrow_icon_{bronze,silver,steel}.webp, marrow_fallback-img_{bronze,silver,steel}.webp, marrow_top-shot_{bronze,silver,steel}.webp, marrow_xray.webp
suture_ring/               suture_gltf.glb, suture_icon_{bronze,silver,steel}.webp, suture_fallback-img_{bronze,silver,steel}.webp, suture_top-shot_{bronze,silver,steel}.webp — no xray/photos
cartilage_ring/            cartilage_gltf.glb, cartilage_icon_{bronze,silver,steel}.webp, cartilage_fallback-img_{bronze,silver,steel}.webp, cartilage_top-shot_{bronze,silver,steel}.webp — no xray/photos
rib-cage_ring/             rib-cage_gltf.glb, rib-cage_icon_{bronze,silver,steel}.webp, rib-cage_fallback-img_{bronze,silver,steel}.webp, rib-cage_top-shot_{bronze,silver,steel}.webp — no xray/photos
rib-cage-extended_ring/    rib-cage-extended_gltf.glb, rib-cage-extended_icon_{bronze,silver,steel}.webp, rib-cage-extended_fallback-img_{bronze,silver,steel}.webp, rib-cage-extended_top-shot_{bronze,silver,steel}.webp — no xray/photos
```

**Every** `.glb` in the catalog now carries `KHR_draco_mesh_compression` (check via a model's `extensionsRequired` in its own glTF JSON chunk), and all of them are produced by one re-runnable script — `npm run optimize-models` (`scripts/optimize-models.js`, see `tooling.md`). That was not always true: three shipped compressed and five didn't, which left the series at **66.9MB of glTF** with a single ring at 20.6MB. After one pass it is **8.3MB**. Run it on any newly added model; it is idempotent enough to run over the whole folder.

Alongside Draco, that script strips each model's textures and its `TEXCOORD_0`/`COLOR_n`/`TANGENT` vertex attributes. That is safe **only because** `js/three-viewer.js`'s `applyMaterial()` unconditionally replaces every mesh's material with a freshly built, untextured `MeshStandardMaterial` from `METAL_PRESETS` — a model's own maps and UVs are never read by anything. If the viewer ever starts honoring them, that step has to go.

What Draco does **not** fix is triangle count, and that is where the remaining cost sits: `rib-cage-extended` is 2.32M triangles, `rib-cage` 1.25M, `suture` 721K — dense, faceted, presumably un-decimated exports (their vertex:triangle ratios are ~1.9:1, i.e. essentially unwelded, which is also why `--simplify` barely moves them). Those are download-cheap and GPU-expensive. Fixing them properly means smooth-shading + merge-by-distance in Blender before export, not a flag on the script.

`js/three-viewer.js`'s `GLTFLoader` needs a `DRACOLoader` to decode the extension at all — see `draco/` below and `client-scripts.md`. Without one, `GLTFLoader` doesn't degrade gracefully: it throws synchronously per-model, the load promise rejects, and the model just never appears (the pre-load image stays up forever, silently, with no visible error) — confirmed as the root cause the one time rib-cage/rib-cage-extended shipped ahead of the decoder being wired up.

**Naming conventions:**
- Folder: `<slug>_<category>` (lowercase product name + underscore + category). **This one is load-bearing now** — `auto-render.js` *constructs* the render output path from `assets/series/<slug>/products/<slug(name)>_<category>/` rather than reading it off `product.assets.model`, so a hand-renamed folder gets a new one created beside it instead of being silently found. It warns when a model sits outside the folder the convention predicts.
- Model file: `<name>_gltf.glb` — capitalization follows whoever exported it (`Foramen_gltf.glb` and `Marrow_gltf.glb` are capitalized, the other two aren't) — hand-authored/exported, not machine-generated, so don't assume consistent casing when scripting against it. `npm run json-tool`'s dropzone (or its Replace button on an existing model) always writes/overwrites `<slug(name)>_gltf.<ext>` (`.glb`/`.gltf` only) — always lowercase, since it goes through the same slug function as the icon/fallback-img/top-shot filenames below, and it does **not** preserve an existing file's own irregular casing: replacing `Foramen_gltf.glb` this way deletes it and writes `foramen_gltf.glb` in its place.
- Icons/fallback images/top-shots: always `<slugified-name>_icon_<metal>.webp` / `<slugified-name>_fallback-img_<metal>.webp` / `<slugified-name>_top-shot_<metal>.webp`, generated and kept in sync by `scripts/auto-render.js` — these ARE consistently lowercase, since the slug function produces them. `icon` and `fallback-img` come from the exact same underlying screenshot (one capture, two saves — see `tooling.md`), just processed differently. **Never written by `json-tool`** — it has no upload slot for these three at all, by design.
- Extra photography (`assets.photos` field): `<Name>_photo<N>.webp` — capitalized to match the product name, hand-added (Furcula is currently the only product with any). `json-tool`'s dropzone follows the same `<Name>_photo<N>.<ext>` shape but preserves whatever extension was dropped.
- X-ray backdrop (`assets.xray` field): `<slug>_xray.<ext>` — underscore, matching the icon/fallback-img/top-shot convention (not hyphenated — an earlier, Furcula-only version was, before the other three products picked up their own backdrops too). Hand-added — no `auto-render.js` involvement, unlike icons/fallback-img/top-shot. `json-tool`'s dropzone/Replace writes `<slug(name)>_xray.<ext>`, same canonical-lowercase, casing-isn't-preserved rule as the model file above.

**Hand-added art should be WebP, and `npm run optimize-images` (`scripts/optimize-images.js`) is what enforces it** — it converts any stray PNG/JPEG under `assets/` to WebP (quality 82, alpha preserved, capped at 2048px) and deletes the original. Furcula's three files were the reason it exists: they shipped as PNG at **8.4MB combined**, `furcula_xray.png` alone being 6.38MB — larger than every 3D model in the catalog put together after Draco, on a page whose own model is 0.3MB. They are now 0.42MB. The script deliberately does **not** rewrite the `products.json` paths that point at what it converts; it prints the list of renames for you to apply by hand, since silently editing the catalog while also deleting the source art is the wrong trade.

## Global items

- `draco/` — `draco_decoder.js`, `draco_decoder.wasm`, `draco_wasm_wrapper.js`, copied verbatim (unmodified) from `node_modules/three/examples/jsm/libs/draco/` — three's own Draco decoder, self-hosted here rather than pointed at the Google CDN three.js's examples default to, so the site makes no external requests. `js/three-viewer.js` points **one** shared, module-scope `DRACOLoader` at this folder and attaches it to **one** shared `GLTFLoader`. Both the sharing and the count matter: a `DRACOLoader` per load is the most-reported cause of Draco failing specifically on iOS Safari (three.js#22445), since each instance spawns its own worker pool and WASM heap. The path is resolved once against `document.baseURI` rather than left as the bare relative string `"assets/draco/"`, which would break silently — and only for Draco models — if a page ever moved into a subdirectory. `setWorkerLimit()` is lowered from the default 4 to at most 2, since every viewer decodes exactly one model and each extra worker is just another copy of the WASM heap. `preload()` is fired as soon as the first model load starts, so the decoder's ~336KB downloads *alongside* the .glb instead of serially after it. In practice only `draco_wasm_wrapper.js` + `draco_decoder.wasm` are ever fetched; `draco_decoder.js` (719KB) is the pure-JS fallback for a browser with no WebAssembly, kept as a safety net and never requested in practice. Needs re-copying by hand from `node_modules/three` on a `three` upgrade if the decoder's own wire format ever changes (rare — Draco's bitstream is stable) — not automated by any script.
- `hdri/` — environment HDRIs. Three today: `studio_kontrast_04_2k.hdr` (re-derived from an 8k EXR master via linear-space 2×2 box downsampling — an old `_1k.hdr` variant it replaced was itself a downscale of the same source), `autumn_field_puresky_1k.hdr` (a 1024×512 downscale from an 8k EXR source), and `white-room_2k.hdr` (4096×2048 — added at its native resolution, deliberately *not* downscaled to match the other two, so it's a noticeably larger file). Resolved by name via `data/series.json`'s top-level `"hdris"` map (`studio`/`blue-pure-sky`/`white-room`), not a single hardcoded path — each series picks one via its own `"hdri"` key (`js/series.js`'s `hdriPath()`), and the swatch renderer's own choice is the separate top-level `"swatch-hdri"` key (see `data.md`). A brand-new `.hdr` file plus its `hdris` map key is added (or replaced/removed) via `npm run json-tool`'s Global tab now, rather than hand-copying the file in and hand-editing the map — see `procedures.md`. `js/three-viewer.js`'s `DEFAULT_HDRI_SRC` (still `studio_kontrast_04_2k.hdr`) is only the fallback of last resort for a caller that omits `options.hdri` entirely — `scripts/auto-render.js`'s bare harness is one such caller, since it never loads `js/series.js`. Loaded by `loadEnvironment(renderer, hdriSrc)`, used by the live site and by every one of `scripts/auto-render.js`'s renders — icons, swatches, and top shots alike (top shots used to be lit with a plain `RoomEnvironment` instead; that override was removed, see `procedures.md`).
- `logo.svg`, `logo_compact.svg` — brand marks.
- `metal-sample_steel.webp`, `metal-sample_silver.webp`, `metal-sample_bronze.webp` — the metal-picker swatch bars, generated by `scripts/auto-render.js`, referenced from `css/style.css`'s `.product-metals__option[data-metal="..."]` rules. Global by nature: a material sample, not any product. Rendered from whichever primitive shape, HDRI, and camera angle `data/series.json`'s `"swatch-primitive"`/`"swatch-hdri"`/`"swatch-camera"` fields currently say — a cylinder is the default, not the only option; `scene-tool.html` (`npm run scene-tool`) is how those three get previewed and tuned (see `tooling.md`/`procedures.md`).
- `hand-pointer-thumb-opened.svg` — the floating hand icon in `js/three-viewer.js`'s idle "nudge" hint.
- `hand_normal.webp` — **dead**. The plain hand that `hand-rings-under-flesh_4k.webp` replaced; no live HTML/CSS/JS references it. Left on disk rather than deleted, same as `hand_xray_white.png` was before it was removed outright — deleting a binary is a separate call from a doc pass.

## `fonts/geist-mono-woff2/` — 2 files

`GeistMono-latin.woff2` and `GeistMono-latin-ext.woff2`, pulled from Google's own CDN and committed here. Geist Mono (SIL OFL, by Vercel) used to arrive at runtime via a `<link rel="stylesheet">` to `fonts.googleapis.com` in all seven pages' `<head>` — two extra DNS+TLS handshakes plus a **render-blocking third-party stylesheet** ahead of first paint, for 37KB of font. Self-hosting made the site genuinely external-request-free (verified: zero cross-origin resource entries on every page), which the `draco/` note above had already been claiming on the site's behalf.

Both weights the site uses (400 and 500) resolve to the same file — Geist Mono ships as one variable font — so `css/style.css` declares `font-weight: 400 500` per `@font-face` rather than one block per weight. Only the `latin` and `latin-ext` subsets are here; Google also serves cyrillic/vietnamese/symbols subsets, deliberately skipped since nothing on the site uses them and a browser never downloads a subset whose `unicode-range` it doesn't need. Each page preloads `GeistMono-latin.woff2` and `DINish-Regular.woff2` directly (`<link rel="preload" as="font" crossorigin>`) — `crossorigin` is mandatory there even same-origin, since fonts are always fetched in CORS mode and a mismatched preload is simply downloaded twice.

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
