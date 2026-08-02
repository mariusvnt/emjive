#!/usr/bin/env node
/* ==========================================================================
   auto-render — re-renders product icons and metal sample bars using the
   exact same rendering path as the live site (window.EmjiveModelViewer in
   js/three-viewer.js: same three.js/TrackballControls construction, same
   studio HDRI, same METAL_PRESETS material application), but through a
   real GPU-accelerated WebGL context instead of the browser a visitor
   sees it in — so the output gets proper MSAA instead of relying on
   supersample-then-downscale tricks.

   Usage:
     node scripts/auto-render.js [metal ...]
     npm run auto-render -- steel bronze

   With no metal names given, renders every metal in data/products.json's
   top-level "metals" list. Requires a local Chrome install (set CHROME_PATH
   to override the auto-detected path) with a real GPU available — see the
   WebGL renderer string this script logs on startup; if it says
   "SwiftShader" or similar, output will still be produced but without real
   MSAA.

   For each requested metal:
   - Product icons: EVERY product gets an icon rendered in this metal, not
     just the ones that default to it — the product page's metal picker
     swaps the icon (label thumbnail / poster) to match whichever metal is
     currently selected, so every product needs an icon for every metal it
     could be shown in, not only its default. Saved as 512x512 transparent
     WebP at assets/products/<folder>/<name>_icon_<metal>.webp, and
     data/products.json's "icons" object for that product (keyed by metal,
     alongside "metalDetails") is updated in place to point at it — the old
     file, if the path changed, is deleted.
   - One top shot per product: a straight-down (camera-orbit phi: 0deg)
     view lit by the same studio HDRI every other render here uses (set by
     window.EmjiveModelViewer itself before onReady fires — this harness
     doesn't touch scene.environment for top shots) plus a soft contact
     shadow, rather than the flat/shadowless cutout look of the icons.
     Also includes an invisible "finger" occluder (see scanFingerHole/
     addFingerOccluder below) — with no hand model in these renders, a
     straight-down shot of a ring's hole would otherwise show whatever
     real geometry sits under the visible top surface (the band's own
     inner wall, or worse, a glimpse through a gap in the shank); this
     hides that the same way a real finger would once the shot is
     composited onto a hand image. Saved as 1024x1024 WebP at
     assets/products/<folder>/<name>_top-shot_<metal>.webp, indexed in
     data/products.json under that product's "assets.top-shot" object
     (keyed by metal), mirroring how "icons" is keyed and updated.
   - One metal sample bar: a plain cylinder in this metal (not any actual
     product — see js/three-viewer.js's buildMaterialSwatch), saved as
     240x240 WebP at assets/metal-sample_<metal>.webp (the small square
     background CSS crops with background-size: cover — see
     .product-metals__option in css/style.css).

   Whenever METAL_PRESETS (js/three-viewer.js) or the environment HDRI
   changes, re-run this for every metal so the icons/swatches stay
   accurate — see "Re-rendering icons and metal swatches after a shader
   change" in dev-guidelines/procedures.md.
   ========================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const PRODUCTS_JSON_PATH = path.join(ROOT, "data", "products.json");
const PORT = 5199;

const ICON_SIZE = 512;
const TOP_SHOT_SIZE = 1024;
const SWATCH_SIZE = 240;
// Captured at 2x the final pixel size (real GPU MSAA already handles edge
// aliasing — this is purely for retina-sharp source pixels before the
// final downscale) then resized down with sharp.
const CAPTURE_SCALE = 2;


function findChrome() {
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    throw new Error("CHROME_PATH is set but doesn't exist: " + process.env.CHROME_PATH);
  }
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    "Could not find a Chrome install in the usual places. Set CHROME_PATH to your Chrome " +
    "executable's path and try again."
  );
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".hdr": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".css": "text/css"
};

// A minimal page loading the exact same js/three-viewer.js the live site
// uses, so every render goes through window.EmjiveModelViewer — the SAME
// construction code (renderer/material/camera setup, HDRI, METAL_PRESETS
// application) as index.html/product.html — instead of a hand-duplicated
// approximation that could quietly drift from what the site actually
// shows. The import map resolves "three"/"three/addons/*" straight from
// node_modules, the same package the real site's Vite build bundles —
// this bare http server has no bundler of its own to do that resolution
// for us. Two harness-only viewer options exist purely for this file (see
// js/three-viewer.js): `transparentBackground` (the interactive site's
// renderer is deliberately opaque; a screenshot needs real alpha to crop
// against) and `static` (skips the idle-nudge hint and the continuous
// animate loop entirely, so nothing can shift the framing between
// onReady firing and the screenshot actually being taken a few ms later).
const HARNESS_HTML = `<!doctype html>
<html><head><meta charset="UTF-8" />
<script type="importmap">
{
  "imports": {
    "three": "/node_modules/three/build/three.module.js",
    "three/addons/": "/node_modules/three/examples/jsm/"
  }
}
</script>
<script type="module" src="js/three-viewer.js"></script>
<style>
  html, body { margin: 0; background: transparent; }
  #target-wrap { display: block; background: transparent; }
  /* js/three-viewer.js's renderer.setSize(w, h, false) deliberately
     leaves the canvas's CSS-rendered size to the stylesheet (so it
     doesn't fight the live site's percentage sizing) — this harness
     doesn't load css/style.css at all, so without this rule the canvas
     falls back to its raw pixel-buffer size as its CSS box (2x too big,
     from CAPTURE_SCALE), and the screenshot captures a zoomed-in crop
     instead of the full frame. */
  .emjive-3d-viewer, .emjive-3d-viewer__canvas { width: 100%; height: 100%; display: block; }
</style>
</head><body>
<script type="module">
  import * as THREE from "three";

  window.__renderReady = false;

  // Each render call builds a brand new viewer (a fresh WebGLRenderer,
  // i.e. a fresh WebGL context) — disposing the previous one first is
  // required, not just tidy: a full run renders many products x metals x
  // (icon + top shot) + swatches in this one page session, and undisposed
  // contexts accumulate until the browser refuses to grant new ones.
  // js/three-viewer.js loads its HDRI environment fresh for every
  // buildThreeViewer() call (not cached across instances — a PMREM
  // texture is tied to the renderer/context that built it, and a shared
  // cache handed later instances an invalid cross-context handle, which
  // silently rendered them solid black), so it needs no help from this
  // harness to stay correctly scoped to whichever renderer is current.
  var currentHandle = null;
  function disposeCurrentHandle() {
    if (currentHandle && currentHandle.renderer) currentHandle.renderer.dispose();
    currentHandle = null;
  }

  function mountTargetWrap(sizePx) {
    document.body.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.id = "target-wrap";
    wrap.style.width = sizePx + "px";
    wrap.style.height = sizePx + "px";
    document.body.appendChild(wrap);
    return wrap;
  }

  window.__renderTarget = function (product, metalKey, sizePx) {
    window.__renderReady = false;
    disposeCurrentHandle();
    var wrap = mountTargetWrap(sizePx);
    var handle = window.EmjiveModelViewer(product, metalKey, {
      transparentBackground: true,
      static: true,
      onReady: function () {
        // Two rAFs: one to let the just-framed camera actually paint, one
        // more so it's that settled frame (not a stale one) that gets
        // screenshotted.
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            window.__renderReady = true;
          });
        });
      }
    });
    handle.el.id = "target";
    handle.el.style.width = "100%";
    handle.el.style.height = "100%";
    wrap.appendChild(handle.el);
    currentHandle = handle;
  };

  // A soft radial-gradient contact shadow under the model, generated
  // on the fly (a plain 2D canvas gradient) rather than a static asset —
  // used only here, in the top-shot path; the live interactive site never
  // renders a shadow at all.
  function makeShadowTexture() {
    var c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    var ctx = c.getContext("2d");
    var gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, "rgba(0,0,0,0.45)");
    gradient.addColorStop(0.7, "rgba(0,0,0,0.18)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }

  function addShadowPlane(scene, box) {
    var sphere = box.getBoundingSphere(new THREE.Sphere());
    // The gradient's own fade-to-transparent completes exactly at this
    // plane's edge (makeShadowTexture's canvas maps its whole 0-1 UV range
    // to the gradient's r=0..128, i.e. center to canvas edge) — too large
    // a multiplier here means the captured frame's OWN edge (bounded by
    // the camera framing, not this plane) falls well short of that, so
    // real but faint non-zero alpha (confirmed directly: ~40/255 at a
    // frame edge midpoint, ~10/255 near a corner) still reaches all the
    // way to the image's own border. Invisible at native size against a
    // plain background, but this render now also gets composited small
    // (the hero's ring-on-hand overlay) — at that scale a resurviving
    // haze across the whole frame reads as a visible translucent
    // rectangle instead of a soft circular vignette. Small enough that
    // the gradient is fully zero well inside the captured frame.
    var size = sphere.radius * 1.4;
    var plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(sphere.center.x, sphere.center.y - sphere.radius, sphere.center.z);
    scene.add(plane);
    return plane;
  }

  // Every product here is a ring, always shot with nothing actually
  // inside it (no hand/finger model exists) — so looking straight down
  // shows whatever real geometry lies under the visible top surface: the
  // band's own inner wall descending into the hole, or, worse, a glimpse
  // of the far side entirely (e.g. Furcula's split shank, whose two
  // halves don't fully close, opens a sightline straight through to
  // geometry that should read as "under the finger"). A real finger
  // would hide all of that; since none is modeled, this fakes the same
  // occlusion with an invisible flat plane standing in for one, cutting
  // the model at the vertical midpoint of its own bounding box — only
  // the top half ever renders. Its material writes depth but not color
  // (colorWrite false) — it can never leave a visible trace in the
  // screenshot no matter how far it overlaps the model's own geometry.
  //
  // Tried confining this to a radius-fitted cylinder first (so untouched
  // geometry outside the "hole" would be provably safe from clipping
  // regardless of cutoff height): a shared circle left Furcula's
  // elongated shank only partly hidden, and letting each angle keep its
  // own detected radius (to hug the shank more closely) clipped a
  // visible chunk out of Foramen's genuinely decorative loop instead.
  // Settled on a plain global half — no radius fit at all, every product
  // cut at exactly the same 50% of its own bounding-box height — as a
  // deliberate simplicity trade-off: it fully hides Furcula's shank (the
  // one product with an actual reported defect) and leaves Foramen
  // untouched, but does cut into Disc's own lower, genuinely-visible
  // band surface, since Disc's decorative material happens to start
  // lower (relative to its own bounding box) than the other two. Accepted
  // rather than chasing a per-product height, which is its own can of
  // worms — an earlier, fancier version of this that derived a cutoff
  // straight from the model's geometry (raycasting for the nearest real
  // surface) failed in a different way, since the first surface found
  // outward from the center isn't reliably "the rim" at all — for
  // Furcula specifically, it's the shank itself, i.e. exactly the thing
  // meant to be hidden.
  //
  // renderOrder -1 forces this to draw before the model regardless of
  // THREE's own distance-sorted opaque render order — without that
  // guarantee, a farther-side fragment could render (and win the depth
  // test) before the occluder ever got a chance to stake its claim on
  // the depth buffer.
  function addFingerOccluder(scene, box) {
    var size = new THREE.Vector3();
    box.getSize(size);
    var center = new THREE.Vector3();
    box.getCenter(center);
    var cutY = box.min.y + size.y * 0.5;
    // Generously oversized — harmless given colorWrite is off, and
    // guarantees the cut reaches every corner of the model regardless of
    // its footprint shape.
    var planeSize = Math.max(size.x, size.z) * 4;
    var mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(planeSize, planeSize),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(center.x, cutY, center.z);
    mesh.renderOrder = -1;
    scene.add(mesh);
  }

  // Still built via window.EmjiveModelViewer first — same METAL_PRESETS
  // material application AND same studio HDRI as every other render — then
  // deliberately diverges on exactly two things: camera angle (straight
  // down) and the added soft contact shadow below, so "light from above"
  // actually reads in a still image.
  window.__renderTopShot = function (product, metalKey, sizePx) {
    window.__renderReady = false;
    disposeCurrentHandle();
    var wrap = mountTargetWrap(sizePx);
    // Reuses the product's own default zoom (falls back to 105) so top
    // shots stay consistently framed with the product's other renders —
    // rotation is fixed at 0 rather than the product's own default, for a
    // canonical, camera-north-up top-down shot regardless of how each
    // model's default 3/4 view happens to be rotated.
    var defaultOrbit = product["camera-setup"] || { rotation: 0, tilt: 75, zoom: 105 };
    var zoom = typeof defaultOrbit.zoom === "number" ? defaultOrbit.zoom : 105;
    var handle = window.EmjiveModelViewer(product, metalKey, {
      transparentBackground: true,
      static: true,
      onReady: function () {
        // handle.scene.environment is already the studio HDRI here —
        // window.EmjiveModelViewer sets it itself before onReady fires
        // (see js/three-viewer.js's environmentPromise), so no override
        // needed.
        // Measured before anything else is added to the scene — both
        // addFingerOccluder and addShadowPlane need the model's own
        // bounding box, not one inflated by each other.
        var modelBox = new THREE.Box3().setFromObject(handle.scene);

        // The finger occluder has to draw before the model within a
        // single, ordinary opaque render pass (see addFingerOccluder's
        // comment) — but the shadow plane can't share that same pass:
        // tried directly, the occluder winning the depth test against
        // the shadow (drawn later, in the transparent pass) erased the
        // shadow's own color wherever it did, punching a visible hole in
        // the gradient at exactly the "finger" location. So this renders
        // in two passes instead — the model hidden on its own layer for
        // the first, so the shadow plane (still transparent, blending
        // normally) draws alone against a genuinely empty canvas. Then,
        // for the second pass, the shadow plane specifically is hidden
        // right back again (tried leaving it visible for both passes: it
        // redrew a second time everywhere the occluder wasn't there to
        // block its depth test, double-blending that whole area a shade
        // darker than the occluder-covered patch and leaving an equally
        // visible — just lower-contrast — disc behind) while the model
        // and the new occluder render on top without clearing: wherever
        // the occluder wins the depth test, colorWrite:false leaves the
        // first pass's shadow color untouched instead of erasing it.
        handle.scene.traverse(function (obj) { obj.layers.set(1); });
        var shadowMesh = addShadowPlane(handle.scene, modelBox);
        handle.setCameraOrbit({ rotation: 0, tilt: 0, zoom: zoom }); // pass 1: shadow alone

        handle.scene.traverse(function (obj) { obj.layers.set(0); });
        shadowMesh.layers.set(1); // hide it again — only the model + occluder render this pass
        addFingerOccluder(handle.scene, modelBox);
        handle.renderer.autoClear = false;
        handle.renderer.render(handle.scene, handle.camera); // pass 2: model + occluder, over the shadow
        handle.renderer.autoClear = true;

        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            window.__renderReady = true;
          });
        });
      }
    });
    handle.el.id = "target";
    handle.el.style.width = "100%";
    handle.el.style.height = "100%";
    wrap.appendChild(handle.el);
    currentHandle = handle;
  };

  // A plain cylinder (js/three-viewer.js's buildMaterialSwatch, not any
  // actual product) rather than a close-up of the Disc ring's own curve —
  // see that function's comment for why: a torus viewed edge-on is always
  // a thin diagonal band in a square frame, leaving empty corners at any
  // zoom, unlike a solid shape framed to exceed the frame on every side.
  window.__renderSwatch = function (metalKey, sizePx) {
    window.__renderReady = false;
    disposeCurrentHandle();
    var wrap = mountTargetWrap(sizePx);
    var handle = window.EmjiveModelViewer.buildMaterialSwatch(metalKey, sizePx, {
      onReady: function () {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            window.__renderReady = true;
          });
        });
      }
    });
    handle.el.id = "target";
    handle.el.style.width = "100%";
    handle.el.style.height = "100%";
    wrap.appendChild(handle.el);
    currentHandle = handle;
  };
</script>
</body></html>`;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (urlPath === "/__render__.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(HARNESS_HTML);
        return;
      }
      const filePath = path.join(ROOT, urlPath);
      const normalizedFile = path.resolve(filePath).replace(/\\/g, "/").toLowerCase();
      const normalizedRoot = path.resolve(ROOT).replace(/\\/g, "/").toLowerCase();
      if (!normalizedFile.startsWith(normalizedRoot)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("not found: " + urlPath);
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function captureTarget(page, cssSizePx, product, metalKey) {
  await page.setViewport({ width: cssSizePx, height: cssSizePx, deviceScaleFactor: CAPTURE_SCALE });
  await page.evaluate((p, m, s) => window.__renderTarget(p, m, s), product, metalKey, cssSizePx);
  await page.waitForFunction("window.__renderReady === true", { timeout: 30000 });
  const handle = await page.$("#target");
  return handle.screenshot({ omitBackground: true });
}

async function writeWebp(sharpInstance, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharpInstance.webp({ quality: 92, alphaQuality: 100 }).toFile(outPath);
}

// How much of the final square an icon's actual rendered content (its
// trimmed alpha bbox) occupies along its longer edge, once centered.
// frameCamera() in js/three-viewer.js sizes the camera off each model's
// bounding-SPHERE (a crude, shape-agnostic stand-in for its true 2D
// silhouette), at that product's own camera-setup angle — so the same
// nominal radius-% lands at very different actual on-screen fill per
// product (an anisotropic/thin ring viewed at a shallow angle produces a
// far more lopsided bounding sphere than a stockier one viewed near
// level). Trimming to the real rendered content and re-centering it at a
// fixed fraction of its LONGER edge normalizes that scale inconsistency
// away, and guarantees left/right margins symmetric WITHIN each single
// icon (fit: "contain" centers on both axes) — but two products with
// different width/height proportions still end up with different margin
// WIDTHS from one another (a squatter ring's trimmed content is wider
// relative to its own height than a slender one's), which this alone
// can't fix without either distorting the ring or leaving inconsistent
// top/bottom margins instead.
const ICON_CONTENT_FRACTION = 0.8;

function normalizeIconFraming(sharpPipeline, sizePx) {
  const inner = Math.round(sizePx * ICON_CONTENT_FRACTION);
  const padLeft = Math.floor((sizePx - inner) / 2);
  const padRight = sizePx - inner - padLeft;
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  return sharpPipeline
    .trim({ threshold: 10 })
    .resize(inner, inner, { fit: "contain", background: transparent })
    .extend({ top: padLeft, bottom: padRight, left: padLeft, right: padRight, background: transparent });
}

async function renderIcon(page, product, metalKey, outPath) {
  const buffer = await captureTarget(page, ICON_SIZE, product, metalKey);
  await writeWebp(normalizeIconFraming(sharp(buffer), ICON_SIZE), outPath);
}

async function captureTopShotTarget(page, cssSizePx, product, metalKey) {
  await page.setViewport({ width: cssSizePx, height: cssSizePx, deviceScaleFactor: CAPTURE_SCALE });
  await page.evaluate((p, m, s) => window.__renderTopShot(p, m, s), product, metalKey, cssSizePx);
  await page.waitForFunction("window.__renderReady === true", { timeout: 30000 });
  const handle = await page.$("#target");
  return handle.screenshot({ omitBackground: true });
}

async function renderTopShot(page, product, metalKey, outPath) {
  const buffer = await captureTopShotTarget(page, TOP_SHOT_SIZE, product, metalKey);
  await writeWebp(sharp(buffer).resize(TOP_SHOT_SIZE, TOP_SHOT_SIZE), outPath);
}

async function captureSwatchTarget(page, cssSizePx, metalKey) {
  await page.setViewport({ width: cssSizePx, height: cssSizePx, deviceScaleFactor: CAPTURE_SCALE });
  await page.evaluate((m, s) => window.__renderSwatch(m, s), metalKey, cssSizePx);
  await page.waitForFunction("window.__renderReady === true", { timeout: 30000 });
  const handle = await page.$("#target");
  return handle.screenshot({ omitBackground: true });
}

async function renderSwatch(page, metalKey, outPath) {
  const buffer = await captureSwatchTarget(page, SWATCH_SIZE, metalKey);
  await writeWebp(sharp(buffer).resize(SWATCH_SIZE, SWATCH_SIZE), outPath);
}

function slug(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, "-");
}

function deleteIfExists(absPath) {
  if (absPath && fs.existsSync(absPath)) fs.unlinkSync(absPath);
}

// Patches a single product's "<blockKey>": {...} sub-object (a per-metal
// map of paths, e.g. top-level "icons" or the nested "assets.top-shot") in
// the raw products.json TEXT (not a re-serialize of the parsed object, so
// hand-aligned formatting elsewhere in the file survives untouched).
// Scoped to the one product via its unique "id" field, then directly to
// the "<blockKey>": {...} block within that product's own text — blockKey
// only needs to be unique *within a single product's block*, not
// necessarily top-level, which is why this works for assets.top-shot too
// without first needing to isolate "assets" itself (that object also
// holds the plain-string "xray" field, so it can't be matched with the
// same non-nested-braces regex this uses for its child blocks).
// Returns the updated text, or null if the expected shape wasn't found
// (caller falls back to warning the user to fix it by hand).
function updateProductMetalFieldInText(text, product, blockKey, metal, newRelPath) {
  const idAnchor = `"id": "${product.id}"`;
  const startIdx = text.indexOf(idAnchor);
  if (startIdx === -1) return null;
  const nextIdIdx = text.indexOf('"id": "', startIdx + idAnchor.length);
  const blockEnd = nextIdIdx === -1 ? text.length : nextIdIdx;
  const block = text.slice(startIdx, blockEnd);

  const blockPattern = new RegExp(`"${blockKey}":\\s*\\{[^}]*\\}`);
  const blockMatch = block.match(blockPattern);
  if (!blockMatch) return null;
  const matchedBlock = blockMatch[0];
  const metalKeyPattern = new RegExp(`("${metal}":\\s*)"[^"]*"`);
  if (!metalKeyPattern.test(matchedBlock)) return null;
  const newMatchedBlock = matchedBlock.replace(metalKeyPattern, `$1"${newRelPath}"`);
  const newBlock = block.replace(matchedBlock, newMatchedBlock);
  return text.slice(0, startIdx) + newBlock + text.slice(blockEnd);
}

async function main() {
  const requestedMetals = process.argv.slice(2).filter((a) => !a.startsWith("--"));

  const productsRaw = fs.readFileSync(PRODUCTS_JSON_PATH, "utf8");
  const productsData = JSON.parse(productsRaw);
  const allMetals = productsData.metals || [];
  const metals = requestedMetals.length ? requestedMetals : allMetals;

  const unknown = metals.filter((m) => !allMetals.includes(m));
  if (unknown.length) {
    throw new Error(
      "Unknown metal(s): " + unknown.join(", ") + " — must be one of: " + allMetals.join(", ")
    );
  }

  console.log("auto-render — metal(s): " + metals.join(", "));

  const chromePath = findChrome();
  const server = await startServer();

  const gpuArgs =
    process.platform === "win32"
      ? ["--headless=new", "--use-angle=d3d11", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"]
      : ["--headless=new", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: gpuArgs
  });

  // Tracks in-place edits to the raw products.json TEXT (not a re-serialize
  // of the parsed object) so hand-aligned formatting elsewhere in the file
  // survives untouched.
  let productsText = productsRaw;

  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.error("  page error:", err.message));

    await page.goto("http://localhost:" + PORT + "/__render__.html", {
      waitUntil: "networkidle0",
      timeout: 30000
    });

    // Confirms this run actually used real GPU-accelerated WebGL (proper
    // MSAA) rather than silently falling back to a software rasterizer.
    const renderer = await page.evaluate(() => {
      var c = document.createElement("canvas");
      var gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return null;
      var dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    console.log("WebGL renderer: " + renderer);
    if (!renderer || /swiftshader|software/i.test(renderer)) {
      console.warn(
        "WARNING: this looks like software rendering, not a real GPU — output will still be " +
        "produced but without proper MSAA. Set CHROME_PATH to a Chrome build with GPU access if " +
        "that's unexpected."
      );
    }

    for (const metal of metals) {
      console.log("\n--- " + metal + " ---");

      for (const product of productsData.products) {
        const folder = path.dirname(product.model); // e.g. assets/products/furcula_ring
        const relOutPath = folder + "/" + slug(product.name) + "_icon_" + metal + ".webp";
        const absOutPath = path.join(ROOT, relOutPath);

        console.log("  icon: " + product.name + " (" + metal + ") -> " + relOutPath);
        await renderIcon(page, product, metal, absOutPath);

        const oldIconRelPath = product.icons && product.icons[metal];
        if (oldIconRelPath !== relOutPath) {
          const patched = updateProductMetalFieldInText(productsText, product, "icons", metal, relOutPath);
          if (patched) {
            productsText = patched;
            if (oldIconRelPath) {
              const oldAbs = path.join(ROOT, oldIconRelPath);
              if (path.resolve(oldAbs) !== path.resolve(absOutPath)) deleteIfExists(oldAbs);
            }
          } else {
            console.warn(
              "  could not find the icons." + metal + " line to update in data/products.json for " +
              product.name + " — set it by hand: " + relOutPath
            );
          }
        }

        const topShotRelPath = folder + "/" + slug(product.name) + "_top-shot_" + metal + ".webp";
        const topShotAbsPath = path.join(ROOT, topShotRelPath);

        console.log("  top shot: " + product.name + " (" + metal + ") -> " + topShotRelPath);
        await renderTopShot(page, product, metal, topShotAbsPath);

        const oldTopShotRelPath = product.assets && product.assets["top-shot"] && product.assets["top-shot"][metal];
        if (oldTopShotRelPath !== topShotRelPath) {
          const patched = updateProductMetalFieldInText(productsText, product, "top-shot", metal, topShotRelPath);
          if (patched) {
            productsText = patched;
            if (oldTopShotRelPath) {
              const oldAbs = path.join(ROOT, oldTopShotRelPath);
              if (path.resolve(oldAbs) !== path.resolve(topShotAbsPath)) deleteIfExists(oldAbs);
            }
          } else {
            console.warn(
              "  could not find the assets.top-shot." + metal + " line to update in data/products.json " +
              "for " + product.name + " — set it by hand: " + topShotRelPath
            );
          }
        }
      }

      const sampleRelPath = "assets/metal-sample_" + metal + ".webp";
      const sampleAbsPath = path.join(ROOT, sampleRelPath);
      console.log("  swatch -> " + sampleRelPath);
      await renderSwatch(page, metal, sampleAbsPath);
      // Superseded by the naming/format above, if a product ever gets
      // re-rendered under this tool for the first time.
      deleteIfExists(path.join(ROOT, "assets", "metal-swatch-" + metal + ".png"));
    }

    if (productsText !== productsRaw) {
      fs.writeFileSync(PRODUCTS_JSON_PATH, productsText, "utf8");
      console.log("\nUpdated data/products.json icon/top-shot paths.");
    }

    console.log("\nDone.");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
