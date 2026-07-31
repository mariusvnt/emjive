# Client-side scripts

`js/` has 6 files. 5 are plain classic scripts (`<script>` tags, no bundler needed to ship them). The 6th, `js/three-viewer.js`, is an ES module (`<script type="module">`, loaded from `<head>`) — it needs to `import` the `three` npm package, which only a module script can do. Despite the different script *kind*, it's fully part of the live site, not a dev-only file — see `tooling.md` for why an ES module is safe to mix into an otherwise-classic-script codebase, and `pages.md` for the exact load-order mechanics (`defer` on the two classic scripts that depend on it).

## Load order (see `pages.md` for the full page × script matrix and the `defer` explanation)

`selection.js` always loads before anything that touches `window.EmjiveSelection`. `three-viewer.js` (a module, in `<head>`) always finishes before `main.js`/`product.js` (both `defer`), which are the only two classic scripts that touch `window.EmjiveModelViewer`. Order on each page: `index.html` → three-viewer (module), main (defer), selection, selection-bar. `product.html` → three-viewer (module), main (defer), selection, product (defer), selection-bar. `launch-order.html` → main, selection, selection-page (no 3D content, no `three-viewer.js` at all).

## `js/three-viewer.js` (~750 lines) — the 3D viewer

The single shared construction path for every 3D product view on the site (homepage grid cards, the product-detail carousel) and for `scripts/auto-render.js`'s render pipeline — see `tooling.md`. A raw three.js scene per instance, driven by the `TrackballControls` addon (free, pole-crossing rotation — unlike the polar-angle-limited orbit a `<model-viewer>`-based approach would have), with a substantial amount of hand-tuned polish layered on top. Exports (all module-internal except the one exposed global):

- `METAL_PRESETS` — PBR values (`baseColorFactor`/`metallicFactor`/`roughnessFactor`) per metal name, the single source of truth repo-wide (also reused by `scripts/auto-render.js`'s harness, since it loads this exact module). Must stay in sync with `products.json`'s top-level `metals` list — see `procedures.md`'s "adding a metal" checklist. `metalToStandardMaterialParams()` converts a preset to `THREE.MeshStandardMaterial` params.
- `parseOrbitString()` / `parseTargetString()` — parse `product.cameraOrbit`/`cameraTarget`'s `"<theta>deg <phi>deg <radius%>"`/`"Xm Ym Zm"` string formats (the same convention a `<model-viewer camera-orbit>` attribute would have used) into the radians/percent the camera-framing math needs.
- `loadEnvironment(renderer)` — loads + PMREM-converts the studio HDRI into an environment map. Rebuilt fresh for every `buildThreeViewer()`/`buildMaterialSwatch()` call, never cached/shared across instances: a PMREM texture is a GPU resource tied to the specific `WebGLRenderer`/context that built it, and each instance has its own renderer. An earlier version cached this at module scope, meant to be reused across the homepage grid's several simultaneous viewers — that handed later instances a texture handle from a different (invalid) context, which silently rendered them solid black, since this scene has zero `THREE.Light` objects and depends entirely on `scene.environment` for lighting. Loading it per-instance costs a redundant fetch+decode+PMREM-generate per grid card, but normal HTTP caching keeps the repeat fetches cheap.
- `buildThreeViewer(product, metalKey, options)` — builds one viewer instance: `WebGLRenderer` + `Scene` + `PerspectiveCamera` + `TrackballControls`, a `ResizeObserver`-driven canvas that always exactly fills its container, a poster `<img>` shown until the model's first frame renders, and — layered on top of the base rotation — release inertia (frame-rate-independent, re-derived from a continuous decay rate rather than assumed-60fps, with an added progressive-braking boost at low speed so a coast stops crisply instead of trailing off), a continuous two-attractor up-vector leveling drift (fades to zero at the poles, flips sign continuously through the equator rather than snapping), a bezier/slerp-based "ease back to the default pose" idle reset, and a 3-phase idle "nudge" hint (a small camera wiggle synchronized with a floating hand-icon overlay, `assets/hand-pointer-placeholder.svg`) — suppressed session-wide via `sessionStorage["emjive_model_interacted"]` once any instance has actually been dragged (a real drag, not just a tap — same 6px-distance-threshold pattern `main.js`'s click-navigation uses). Returns `{ el, applyMetal(newKey), setCameraOrbit(orbitStr) }` — `setCameraOrbit` is an instant (non-animated) reposition, used only by the render harness (see `tooling.md`). Calls `controls.handleResize()` on every real resize (not just once at construction) — `TrackballControls` caches the element's screen rect itself rather than measuring fresh per pointer event, and at construction time the wrapper is still a detached `<div>` (the caller hasn't appended it to the page yet), so skipping this left `screen.width` permanently stuck at 0 and every drag silently a no-op (NaN rotation deltas, falsy, quietly skipped).
- `options.static` — harness-only (never set by the interactive site): skips the idle-nudge hint and the continuous per-frame animation loop entirely (only explicit `render()` calls, so nothing can shift the framing between the harness's `onReady` firing and its screenshot being taken a few ms later). `options.transparentBackground` — also harness-only, controls `preserveDrawingBuffer` (needed for an external screenshot readback of the canvas; the interactive site never reads its own canvas back). The renderer's alpha itself is unconditional now (both the interactive site and the harness render on a genuinely transparent canvas) — an earlier version kept the interactive site's canvas opaque on purpose to dodge a subtler ACES-tone-mapping edge-blending artifact, which traded it for a much more visible bug (a solid near-black square behind every model wherever the canvas wasn't covered by geometry).
- `buildMaterialSwatch(metalKey, sizePx, options)` — harness-only, used solely by `scripts/auto-render.js` for the metal-sample swatch bars (see `procedures.md`). Builds a plain cylinder (not any actual product) with the same `METAL_PRESETS` material + shared-HDRI-loading path, framed close enough that its curved surface fills the entire square frame with no cropping needed — see the function's own comment for why a product's own geometry (a torus viewed edge-on) can't do this at any zoom. Returns `{ el, renderer, scene, camera }`; `options.onReady` fires after the environment lands and the first frame renders.

**Exposes**: `window.EmjiveModelViewer = buildThreeViewer` — consumed by `main.js`'s grid and `product.js`'s carousel. Also `window.EmjiveModelViewer.buildMaterialSwatch` — a harness-only second export, see above.

## `js/main.js` (~309 lines)

Loads on all three real pages. Owns:

- The header hamburger menu toggle (shared everywhere).
- The homepage's scroll-driven hero reveal (`updateReveal()`) — no-ops if `#revealSection` isn't on the page. There used to be a separate `#revealScanHint` ("SCROLL TO SCAN") DOM element progressively erased in lockstep with the x-ray wipe — removed; that text is now baked directly into `assets/hand-rings-under-flesh_4k.webp` itself (see `assets.md`), so it reveals for free as part of the same image the wipe already clips, with no dedicated element/logic needed here anymore. The same function also drives the floating selection bar's entrance (see the dedicated point below) and, once `data/products.json` loads, `updateHeroRings()` inserts one `.reveal__ring` `<img>` into `#revealXrayGroup` per product with `onHand.visible: true` (see `data.md`), each positioned/sized/rotated via inline custom properties (`--ring-x`/`--ring-y`/`--ring-size`/`--ring-rotation`) set straight from that product's own `onHand` object — not shared globally, so multiple rings on screen at once don't fight over one set of values.
- **The floating selection bar's scroll-driven entrance** (homepage only — see `pages.md`): `updateReveal()` measures `.selection-bar__summary`'s real height and the fixed `.site-header`'s real height, then sets `.selection-bar`'s `transform` directly (no CSS transition) from how far the visitor has scrolled past the point where the hero's frontier band would pass behind the header — continuing the exact same scroll motion that finishes the x-ray wipe, reversible in both directions. See `styling.md`'s "Floating selection bar" section for what this looks like from the CSS side.
- `wireModelClickNavigation(el, href)` — the 6px drag-distance-threshold click-vs-drag disambiguation, attached to a viewer's wrapper element so rotating a model doesn't accidentally navigate.
- The homepage grid rendering (`buildCard`/`renderProducts`) — fetches `data/products.json`, builds one card per product, calling `window.EmjiveModelViewer(product, product.metal)` (from `js/three-viewer.js`) for any product with a `model` set.
- A guarded contact-form stub (`getElementById("contactForm")`) — currently a no-op since no page has that element yet (see `pages.md`'s known-gap note).

No longer owns `METAL_PRESETS` or any viewer-construction logic at all — that all moved to `js/three-viewer.js` above; `main.js` is purely a *consumer* of `window.EmjiveModelViewer` now.

## `js/selection.js` (73 lines)

The cart/selection data layer — a thin `localStorage` wrapper. `STORAGE_KEY = "emjive_selection"`. Read/write helpers fall back to `[]` on any error (e.g. corrupted JSON). Every mutating call dispatches `new CustomEvent("emjive:selection-changed")` on `window` — the sole mechanism other scripts use to react live to a change without a page reload.

**Exposes**: `window.EmjiveSelection = { getSelection, addItem, removeItem, clear, formatPrice }`.

**Item shape**: `{ productId, name, category, metal, size, price, image }` — a deliberately self-contained snapshot, so `launch-order.html` never has to re-fetch or join against `data/products.json` to render itself.

## `js/product.js` (634 lines) — the largest file

Owns `product.html` end to end. Resolves `?id=` against `data/products.json`, then renders (by the file's own numbered section comments):

1. **Label** — name, category, per-metal thumbnail, price.
2. **Carousel** — builds slides (a 3D viewer via `window.EmjiveModelViewer` if `product.model` is set, else a fallback icon image, then any `product.photos`). Drag/momentum/rim-click navigation, "first/last tile centered" bounds (not edge-flush), rubber-band overshoot on drag past the ends. Carousel geometry can only be measured once `#productDetailContent` is actually visible (`[hidden]` elements measure zero) — bounds are explicitly re-synced right after the content is unhidden.
3. **Metal picker** — re-tints the live 3D model in place via `state.modelHandle.applyMetal(metal)` (no reload, no camera reset), and separately updates the label thumbnail/fallback icon/specs/price, since only the 3D model re-tints itself automatically.
4. **Characteristics** — metal-dependent weight/composition/price from `product.metalDetails[selectedMetal]`.
5. **Select button + size modal** — sizes/units looked up by *category* (not per-product) from the top-level `sizesByCategory`/`sizeUnits`; standard-size buttons + a decimal-only custom input; on confirm, calls `window.EmjiveSelection.addItem({...})` with the self-contained item snapshot and closes the modal.

All page state lives in one `state` object (product, metals, selected metal/size, carousel scroll offset, the live model handle, etc.).

**Notable gotchas** (from the file's own comments): rims need the same drag handling as the viewport since they sit on top of it (`z-index: 2`) and would otherwise swallow `pointerdown`; a `suppressClick` flag works around desktop browsers still firing a native click after pointerup regardless of drag distance (touch doesn't have this problem); `img.draggable = false` + `dragstart` prevention stops the browser's native image-drag gesture from fighting the custom pointer-drag scroll; release momentum is deliberately capped small (a gentle coast, not a mobile-style flick).

## `js/selection-bar.js` (~300 lines)

The floating bar shown on `index.html` and `product.html` only (not `launch-order.html` — that page isn't in its script list at all, plus it self-guards with `if (!window.EmjiveSelection) return;`). Builds its whole DOM programmatically and appends to `<body>`.

Shows either "No selected item" or a thumbnail strip + "Order ›" link; clicking the bar (not the Order link) opens a drawer with per-item "Unselect" rows. The drawer's `max-height` is set to a real measured pixel value in JS (not a CSS trick) — this is the piece `styling.md`'s drawer note points back to — specifically so it can animate smoothly both on open/close *and* on shrinking while already open (removing a row).

This file itself has no notion of which page it's on or of scroll position — the homepage's hero-only hiding/scroll-driven entrance (see `js/main.js` above) is entirely someone else's job, driven by `updateReveal()` and `css/style.css`'s `body:has(#revealSection)` scoping. Kept that way deliberately: `product.html`'s bar (no hero on that page) needs zero special-casing here as a result.

Listens for `window.addEventListener("emjive:selection-changed", render)` — this is how it stays live-in-sync with additions from `product.js` or removals from its own drawer.

## `js/selection-page.js` (83 lines)

Renders `launch-order.html`'s full list + running total from `window.EmjiveSelection.getSelection()`. Re-renders synchronously right after its own remove action rather than listening for `emjive:selection-changed` — it's the only page without a concurrently-visible selection bar, so nothing else can change the selection while it's open.

## Cross-cutting contracts (the highest-value section if you're changing behavior that spans files)

- **`window.EmjiveModelViewer`** — set by `three-viewer.js`, consumed by `main.js` (grid) and `product.js` (carousel). The one place 3D viewer construction/materials/camera behavior lives.
- **`window.EmjiveSelection`** — set by `selection.js`, consumed by `product.js` (add), `selection-bar.js` (add/remove/read), `selection-page.js` (remove/read).
- **`"emjive:selection-changed"`** — `CustomEvent` on `window`, dispatched by every `selection.js` mutation. Only `selection-bar.js` listens for it.
- **`localStorage["emjive_selection"]`** — the persisted selection array (via `selection.js`).
- **`sessionStorage["emjive_model_interacted"]`** — unrelated to selection; remembers within a browsing session whether the visitor has already discovered models are draggable, to stop nudging them with the wiggle hint (set/read in `three-viewer.js`).
- **Item shape**: `{ productId, name, category, metal, size, price, image }` (see `selection.js` above).

## Pointers

- Which pages load which of these, and the `defer`/module load-order mechanics: `pages.md`
- The JSON these scripts fetch/read, including `product.model`/`cameraOrbit`/`cameraTarget`: `data.md`
- How `scripts/auto-render.js` reuses `three-viewer.js`: `tooling.md`
