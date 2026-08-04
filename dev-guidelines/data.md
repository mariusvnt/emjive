# Data

Three kinds of file, all fetched client-side (no backend, no server-side templating), all hand-formatted with aligned columns — see the "how it's written" note at the end before running any formatter over them.

- **`data/series.json`** — the index. Brand-wide settings plus one entry per series.
- **`data/series/<slug>/products.json`** — that series' catalog.
- **`data/series/<slug>/manifest.json`** — that series' design manifest.

There is no global `data/products.json` any more; it split into the three above.

**Every path inside these files is repo-root-relative with no leading slash** (`assets/series/bones/...`, `series/bones/hero.css`). That resolves correctly *only* because every HTML page sits at the repo root — the fetches are relative to the page, and `vite.config.js` sets `base: "/emjive/"`. A page in a subdirectory would silently break all of them.

## `data/series.json` — top-level schema

| Field | Type | Purpose |
|---|---|---|
| `featured` | `string` | Which series' slug the homepage shows. **This one field is how you switch the featured series**; nothing else needs touching. |
| `metals` | `string[]` | Source of truth for valid metal keys, used throughout `assets.icons`, `assets.fallback-img`, `per-metal-specs`, `assets.top-shot`, and `default-metal`. Global rather than per-series because it must stay in sync with `METAL_PRESETS` in `js/three-viewer.js` (see `client-scripts.md`), which is module-scope and series-unaware. |
| `categories` | `{ [id]: { sizes: string[], unit: string } }` | The brand's full category vocabulary, and the one place sizing is declared. `sizes` are the standard options in the "Choose a size" popup; `unit` labels its custom-size field (e.g. `"mm"` for ring). Both empty for a category ⇒ the product page's "Select" button disables itself. Replaces the old parallel `sizesByCategory` + `sizeUnits` maps, which had to be kept in sync with each other by hand. |
| `series` | `Series[]` | Every series across the brand's lifetime. Drives the archives page. |

### Series entry schema

| Field | Type | Purpose |
|---|---|---|
| `slug` | `string` | URL identity — `index.html?series=<slug>`, `product.html?series=<slug>&id=...`, `series.html?series=<slug>`. |
| `name`, `year` | `string` | Display name and vintage. |
| `categories` | `string[]` | **A subset of the top-level `categories` keys**, in the order the header's filter row should show them. Each series declares its own, because the available categories genuinely differ between collections. Nothing enforces the subset relationship at runtime, but `scripts/auto-render.js` warns about violations (see `tooling.md`). |
| `products` | `string` | Path to this series' `products.json`. |
| `manifest` | `string` | Path to this series' `manifest.json`, rendered by `series.html`. |
| `hero` | `{ fragment, css, js, preload[] }` | This series' hero bundle — see `pages.md`. `preload` lists image paths to `<link rel="preload">` as soon as the index loads, since a runtime-injected fragment's images aren't visible to the browser's preload scanner. |

## `data/series/<slug>/products.json`

`{ "series": "<slug>", "products": Product[] }` — the `series` field is self-identifying, a cheap cross-check if a file ever gets copied to a new folder and half-edited.

Currently one series: **Bones** (`data/series/bones/products.json`), 4 entries (Furcula, Foramen, Disc, Marrow), all category `"ring"`.

## `data/series/<slug>/manifest.json`

`{ series, title, subtitle, year, intro, sections[], credits[] }`. Rendered by `series.html` via `js/series-page.js` — but **only `title`/`year`/`subtitle` are read today**; the page is otherwise an empty shell awaiting its design. The intended `sections[]` entry shape is `{ id, heading, body: string[], media: [{ type, src, alt, caption }] }`, documented here ahead of anything rendering it.

## Product object schema

Top-level field order: `id, name, category, description, default-metal, per-metal-specs, hero-hand-visibility, 3d-viewer-camera-default, assets`. `assets` itself is ordered `model, icons, fallback-img, xray, top-shot, photos`.

- **`id`** (`string`) — e.g. `"01"`. **Unique within one series' file, not globally** — every series starts over at `"01"`. Used in `product.html?id=...` URLs (with `?series=` prepended when it isn't the featured series), and as the anchor `scripts/auto-render.js` scopes its text-patching to (see `tooling.md`). A bare `?id=` with no `?series=` resolves against the active series first, then scans the others — see `client-scripts.md`.
- **`name`** (`string`) — display name; also the basis for auto-render's generated filenames (lowercased, spaces→hyphens).
- **`category`** (`string`) — should be one of the categories its own series declares, which in turn must be a key of the global `categories` vocabulary. Looks up that category's `sizes`/`unit` for the size popup. A product in a category its series doesn't declare still renders in the unfiltered grid, but no filter button can reach it — `auto-render.js` warns about this.
- **`description`** (`string`) — shown on the product detail page only. Empty string falls back to "No description yet." in `js/product.js`.
- **`default-metal`** (`string`) — singular. Picks which of `assets.icons`/`per-metal-specs` the *homepage* card defaults to (no picker there), and which metal's `assets.top-shot`/`assets.xray` gets used wherever a single, unpicked variant is needed (the hero ring overlay, the product carousel backdrop). The product page separately defaults its own picker to this value but lets the visitor change it.
- **`per-metal-specs`** (`{ [metal]: { price: number, weight: string, composition: string } }`) — per-metal specs, shown in the product page's Characteristics section, re-rendered on every metal-picker switch. `price: 0` renders as "Price on request".
- **`hero-hand-visibility`** (`{ visible: boolean, x: number, y: number, scale: number, rotation: number }`) — controls whether and how this product's `assets.top-shot[metal]` image is overlaid on the homepage hero's x-ray hand. `visible` gates whether the hero bundle's `updateHeroRings()` creates a `.reveal__ring` `<img>` for this product at all — any number of products can have this `true` at once, each getting its own independently-positioned image. `x`/`y` are that image's center as a % of the hand image's own width/height (not the viewport); `scale` is its width as a % of the hand image's width; `rotation` is in degrees. All four are set inline per-image from this data (the `--ring-x`/`--ring-y`/`--ring-size`/`--ring-rotation` values in `series/<slug>/hero.css` are only the pre-JS fallbacks). This is hero art, so it deliberately ignores the header's category filter. See `pages.md`/`styling.md` for the reveal/positioning mechanics these feed into.
- **`3d-viewer-camera-default`** (`{ rotation: number, tilt: number, zoom: number }`) — default/reset camera framing, parsed by `js/three-viewer.js`'s `parseOrbitConfig()` (see `client-scripts.md`). `rotation` spins left/right, `tilt` is up/down (90 = eye-level), `zoom` is radius as a % of the distance that exactly frames the model's bounding sphere. Also inherited (`zoom` only, `rotation` forced to 0) by auto-render's top-shot renderer.
- **`assets.model`** (`string`) — `.glb`/`.gltf` path. Empty string → falls back to `assets.icons[metal]` instead of a 3D viewer.
- **`assets.icons`** (`{ [metal]: string }`) — one 512×512 transparent WebP path per metal, every metal (not just the default) — the metal picker swaps this live. A flat, tightly-cropped/re-centered thumbnail (see `tooling.md`'s `normalizeIconFraming`) used for the product page's label thumbnail, the cart/order-page line-item snapshot, the homepage card's fallback when `model` is empty, and the carousel's fallback slide for a model-less product. **Not** used as the 3D viewer's pre-load poster any more — see `fallback-img` below.
- **`assets.fallback-img`** (`{ [metal]: string }`) — one 512×512 transparent WebP path per metal, same shape as `icons`. This IS the 3D viewer's `.emjive-3d-viewer__poster` overlay (shown until the model's first frame renders). Captured by `scripts/auto-render.js` from the exact same screenshot `icons` is derived from, but saved as-is (no crop/re-center/pad) — so it holds the model's real `3d-viewer-camera-default` framing pixel-for-pixel and the poster→model handoff shows no jump, unlike `icons`' tighter, re-centered crop.
- **`assets.xray`** (`string`) — single path, carousel backdrop image. Empty string hides it.
- **`assets.top-shot`** (`{ [metal]: string }`) — one 1024×1024 WebP per metal, straight-down camera, lit with the same studio HDRI every other render uses, with an invisible "finger" occluder plane baked into the render so the ring's own hidden-from-above geometry (the far side of a gap in the shank, the inner wall of the hole) doesn't show through once composited over a hand (see `tooling.md`'s `scripts/auto-render.js` section). Generated by `scripts/auto-render.js`, populated for all 4 current products. Read by the active series' hero bundle (`series/<slug>/hero.js`'s `updateHeroRings()`) — see `hero-hand-visibility` above.
- **`assets.photos`** (`string[]`) — extra photography slides appended to the carousel after the model/icon slide. Empty array hides the carousel's nav entirely if it leaves only one slide.

## Current data gaps (so placeholder content doesn't get mistaken for a bug)

Verified directly against the file: Foramen, Disc, and Marrow have no `assets.photos`, no `assets.xray`, empty `description`, and `price: 0` for every metal. Marrow also has `hero-hand-visibility.visible: false` (not yet positioned on the hero hand). Every product's `weight`/`composition` is empty for every metal, including Furcula's. Furcula itself has real prices for all three metals (220/350/240) and a real description/photos/xray — it's the one fleshed-out example the other three haven't caught up to yet.

## How it's written

By hand for most fields, or patched by `scripts/auto-render.js` for `assets.icons`/`assets.fallback-img`/`assets.top-shot` specifically — via regex text-surgery on the raw file text, not `JSON.stringify` (see `tooling.md` for why: it preserves the hand-aligned column formatting, which a full re-serialize would flatten). **Don't run a formatter/prettify pass on these files** — they'll survive structurally but lose that alignment.

## Pointers

- Who reads these fields and how: `client-scripts.md`
- Step-by-step "add a product" walkthrough: `procedures.md`
- Where the referenced asset files actually live: `assets.md`
