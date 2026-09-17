/* ==========================================================================
   J&MV — shared 3D viewer construction (three.js + TrackballControls).
   Replaces the old <model-viewer>-based buildModelViewer(): same external
   contract (build a viewer for a product/metal, get back { el, applyMetal }
   plus a new setCameraOrbit for the render tooling — see
   scripts/auto-render.js), same window.EmjiveModelViewer global, so the two
   callers (js/main.js's homepage grid, js/product.js's carousel) barely
   change. The actual rotation feel — free pole-crossing rotation, release
   inertia, an idle "ease back to default pose" reset, a continuous
   up-vector leveling drift, and an idle "nudge" hint — was designed and
   tuned separately in what used to be test-viewer.html/js/test-viewer.js;
   this is that same behavior, generalized to be instanced (multiple
   simultaneous viewers on one page) and parameterized (any product, any
   container size, any camera-orbit angle) instead of hardcoded to one
   model at a fixed 420x420.

   An ES module (not a classic script like the rest of js/) specifically
   because it needs to import "three"/"three/addons/*" — Vite resolves
   these from the local npm "three" package (see dev-guidelines/tooling.md).
   js/main.js and js/product.js stay classic scripts; both only touch
   window.EmjiveModelViewer inside a fetch(...).then(...) callback, which
   always resolves after this module has finished executing and set the
   global, so there's no load-order race despite the different script
   timing (module scripts run deferred, classic scripts run inline).
   ========================================================================== */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";

(function () {
  "use strict";

  // ---- Draco decoding -----------------------------------------------------
  //
  // ONE decoder instance for the whole page, shared by every viewer and
  // every GLTFLoader.load() call. This is not just a tidiness preference:
  // constructing a DRACOLoader per load is the single most-reported cause
  // of Draco failing specifically on iOS Safari (three.js#22445,
  // discourse#68835) — each instance spawns its own worker pool and its
  // own WASM heap, and iOS tears the page down long before desktop would.
  // Unlike loadEnvironment()'s PMREM texture (tied to one WebGLRenderer's
  // context), Draco decoding is plain WASM with no GPU context involved,
  // so one decoder can legitimately serve every model on the page.
  //
  // Self-hosted (not the Google CDN three.js's own examples default to) so
  // this stays a fully offline, no-external-request static site like the
  // rest of it — see assets.md for the assets/draco/ folder these three
  // files came from (verbatim, unmodified, copied from three's own npm
  // package). Only products actually using KHR_draco_mesh_compression ever
  // trigger a fetch of these; GLTFLoader ignores an attached DRACOLoader
  // entirely for a model that doesn't use the extension.
  var dracoLoader = new DRACOLoader();
  // Resolved against the document rather than left as the bare relative
  // string "assets/draco/". DRACOLoader hands these paths to a FileLoader
  // that resolves them against the *document* URL — fine today (every page
  // sits at the repo root) but silently wrong the moment a page moves into
  // a subdirectory, and wrong in a way that only shows up on Draco models.
  // new URL(..., document.baseURI) pins it once, here, instead.
  dracoLoader.setDecoderPath(new URL("assets/draco/", document.baseURI).href);
  // Default is 4. Every viewer on this site decodes exactly one model, and
  // the grid deliberately keeps only a handful alive at a time, so 4
  // workers can never be usefully busy — they'd just be 4 separate copies
  // of the Draco WASM heap (the decoder config, wasmBinary included, is
  // structured-cloned into each one). On a phone that is pure memory
  // pressure against the very budget the lazy grid exists to protect.
  // hardwareConcurrency is the usual proxy for "how much parallelism is
  // real here"; iPhones report 4-6 but have far less memory headroom than
  // that implies, so this is capped at 2 regardless.
  dracoLoader.setWorkerLimit(Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1)));

  // The decoder libraries (draco_wasm_wrapper.js + draco_decoder.wasm,
  // ~336KB together) are fetched lazily by DRACOLoader on the first decode
  // — which, left alone, lands them *inside* the first model's load, after
  // its .glb has already arrived. That's a wasted serial round trip on the
  // exact request path we care most about. Kicking preload() off as soon
  // as we know a model is coming overlaps it with the .glb fetch instead,
  // which is always the larger of the two. Guarded so a page that never
  // shows a 3D model (every page but index/product) never pays for it, and
  // so it's a no-op after the first call (preload() itself memoizes via
  // decoderPending, this just avoids the call entirely).
  var dracoPreloaded = false;
  function preloadDracoDecoder() {
    if (dracoPreloaded) return;
    dracoPreloaded = true;
    dracoLoader.preload();
  }

  // Also shared, for the same reason and with the same caveat as the
  // DRACOLoader above — a GLTFLoader holds no per-context state, so one
  // instance with the decoder attached once serves every load.
  var gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  // Fallback only, now — the real per-call choice is data/series.json's
  // top-level "hdris" map, resolved by the caller (js/main.js, js/product.js,
  // or scripts/auto-render.js) and passed in as options.hdri, exactly like
  // metalKey already is. Used whenever a caller omits options.hdri (this
  // module is deliberately series-unaware, and auto-render.js's headless
  // harness never loads js/series.js at all, so it can't be resolved here).
  var DEFAULT_HDRI_SRC = "assets/hdri/studio_kontrast_04_2k.hdr";
  var DEFAULT_ORBIT = { rotation: 0, tilt: 75, zoom: 105 };
  var WORLD_UP = new THREE.Vector3(0, 1, 0);

  // PBR material presets applied to every mesh of a product's 3D model,
  // regardless of the model's own original materials/textures. Pick one
  // per product via the "default-metal" field in products.json (defaults to
  // "steel" if omitted or unrecognized). Keys here should match the
  // top-level "metals" list in products.json — that list is the source
  // of truth for which metal names are valid, so keep the two in sync.
  // The single source of truth repo-wide (scripts/auto-render.js reuses
  // this exact module, not a separate copy).
  var METAL_PRESETS = {
    steel: { baseColorFactor: [120 / 255, 120 / 255, 135 / 255, 1], metallicFactor: 1.0, roughnessFactor: 0.15 },
    silver: { baseColorFactor: [240 / 255, 240 / 255, 240 / 255, 1], metallicFactor: 1.0, roughnessFactor: 0.09 },
    bronze: { baseColorFactor: [255 / 255, 156 / 255, 41 / 255, 1], metallicFactor: 0.95, roughnessFactor: 0.08 }
  };

  function metalToStandardMaterialParams(metalKey) {
    var preset = METAL_PRESETS[metalKey] || METAL_PRESETS.steel;
    return {
      color: new THREE.Color(preset.baseColorFactor[0], preset.baseColorFactor[1], preset.baseColorFactor[2]),
      metalness: preset.metallicFactor,
      roughness: preset.roughnessFactor
    };
  }

  // { rotation, tilt, zoom } -> radians + a percent (100% = the distance
  // that exactly frames the model's bounding sphere for the camera's fov).
  // rotation spins left/right, tilt is up/down (90 = eye-level), zoom is
  // that same radius expressed as a percent — descriptive names for what
  // used to be a single "<theta>deg <phi>deg <radius%>" string (matching
  // model-viewer's old camera-orbit attribute convention, which this
  // whole viewer replaced).
  function parseOrbitConfig(config) {
    var cfg = config || DEFAULT_ORBIT;
    var theta = typeof cfg.rotation === "number" ? cfg.rotation : 0;
    var phi = typeof cfg.tilt === "number" ? cfg.tilt : 75;
    var radiusPercent = typeof cfg.zoom === "number" ? cfg.zoom : 105;
    return {
      thetaRad: (theta * Math.PI) / 180,
      phiRad: (phi * Math.PI) / 180,
      radiusPercent: radiusPercent
    };
  }

  // Builds a bare primitive mesh in place of a loaded GLTF model — used
  // when options.primitive is passed to buildThreeViewer (scene-tool.html's
  // swatch-scene mode, and scripts/auto-render.js's swatch renderer).
  // Deliberately no material here: applyMaterial()'s mesh traversal (below)
  // assigns one right after, same as it does for a loaded GLTF's meshes.
  // Sized/shaped only roughly like the old buildMaterialSwatch()'s cylinder
  // (tall relative to its radius) — exact framing is no longer a fixed
  // formula, it's whatever camera orbit the scene-tool/data field says, so
  // precise proportions matter far less than they used to.
  function buildPrimitiveMesh(name) {
    var geometry =
      name === "box" ? new THREE.BoxGeometry(2, 2, 2) :
      name === "sphere" ? new THREE.SphereGeometry(1, 64, 64) :
      name === "torus" ? new THREE.TorusGeometry(1, 0.4, 32, 100) :
      new THREE.CylinderGeometry(1, 1, 8, 96); // "cylinder", and the default for an unrecognized name
    return new THREE.Mesh(geometry);
  }

  function parseTargetString(str) {
    if (!str) return null;
    var parts = str.trim().split(/\s+/).map(parseFloat);
    if (parts.length < 3 || parts.some(function (n) { return isNaN(n); })) return null;
    return new THREE.Vector3(parts[0], parts[1], parts[2]);
  }

  // Standard parametric cubic-bezier evaluator (control points (x1,y1)/(x2,y2),
  // implicit endpoints (0,0)/(1,1)) — Newton-Raphson to solve for the curve
  // parameter at a given time-fraction x, same approach browsers use for CSS's
  // own cubic-bezier() timing functions.
  function cubicBezierEase(t, x1, y1, x2, y2) {
    function componentAt(u, a, b) {
      var v = 1 - u;
      return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u;
    }
    var u = t;
    for (var i = 0; i < 8; i++) {
      var x = componentAt(u, x1, x2) - t;
      var dx = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
      if (Math.abs(dx) < 1e-6) break;
      u = Math.max(0, Math.min(1, u - x / dx));
    }
    return componentAt(u, y1, y2);
  }

  // Spherical linear interpolation between two unit vectors. Unlike
  // lerpVectors+normalize (nlerp), this sweeps at constant angular velocity
  // and doesn't pass close to the origin for large-angle/near-antipodal
  // pairs — needed because free-spinning across a pole can leave the
  // camera almost anywhere before a rollback has to reorient it.
  function slerpVectors(out, a, b, t) {
    var cosTheta = THREE.MathUtils.clamp(a.dot(b), -1, 1);
    var theta = Math.acos(cosTheta);
    if (theta < 1e-4) return out.copy(b);
    var sinTheta = Math.sin(theta);
    if (sinTheta < 1e-4) return out.lerpVectors(a, b, t).normalize();
    return out
      .copy(a)
      .multiplyScalar(Math.sin((1 - t) * theta) / sinTheta)
      .addScaledVector(b, Math.sin(t * theta) / sinTheta);
  }

  // ---- HDRI environment, loaded fresh for every viewer instance. NOT
  // cached/shared across instances despite two instances often using the
  // same source file (any two viewers showing series that picked the same
  // hdris key): a PMREMGenerator's output texture is a GPU resource tied
  // to the specific WebGLRenderer/context that built it, and every
  // buildThreeViewer() call constructs its own renderer. A cross-instance
  // cache (an earlier version of this file had one, keyed only on the
  // source file, not the renderer) silently handed later instances a
  // texture handle from a DIFFERENT context — invalid there, and since
  // this scene has zero THREE.Light objects (lighting is 100% via
  // scene.environment), every mesh's PBR shading collapsed to solid black
  // for every viewer except whichever one happened to build the cached
  // texture first. Reproduced concretely on the homepage grid (several
  // simultaneous instances, several real WebGL contexts) — a single page
  // with only one viewer (e.g. product.html's carousel) never showed it,
  // since there's only ever one context for the cache to coincidentally
  // "work" against there. Loading it per-instance means the homepage
  // grid's several simultaneous viewers each independently fetch+decode
  // the HDRI and run PMREM generation — a modest, one-time-per-instance
  // cost (not a per-frame one), and normal HTTP caching keeps the repeat
  // fetches of the same file cheap after the first.
  //
  // hdriSrc is the caller-resolved path (data/series.json's "hdris" map,
  // looked up via that series' "hdri" key — see js/series.js's hdriPath()),
  // falling back to DEFAULT_HDRI_SRC when omitted or unresolved.
  // The PIXELS, though, are plain CPU-side data with no context affinity at
  // all — and decoding a 2K RGBE .hdr into half-floats is genuinely
  // expensive main-thread work (tens of ms), which the comment above was
  // quietly signing every viewer up to repeat from scratch. This caches the
  // decode (and the fetch) per source file, keyed on the URL and shared by
  // an in-flight promise so N simultaneous viewers asking for the same HDRI
  // during one scroll trigger exactly one decode between them. Each viewer
  // still gets its own throwaway DataTexture wrapper around that one shared
  // pixel buffer, so the per-renderer GPU upload/dispose lifecycle below is
  // exactly what it was before — only the redundant decoding is gone. A
  // failed load evicts its own entry so a later viewer can retry rather
  // than inheriting a permanently-rejected promise.
  var hdrSourceCache = {};
  var hdrLoadsInFlight = 0;

  function loadHdrSource(src) {
    if (!hdrSourceCache[src]) {
      hdrLoadsInFlight++;
      hdrSourceCache[src] = new Promise(function (resolve, reject) {
        new HDRLoader().load(src, resolve, undefined, reject);
      }).then(
        function (texture) {
          hdrLoadsInFlight--;
          return texture;
        },
        function (err) {
          hdrLoadsInFlight--;
          // Evicted so a later viewer can retry rather than inheriting a
          // permanently-rejected promise.
          delete hdrSourceCache[src];
          throw err;
        }
      );
    }
    return hdrSourceCache[src];
  }

  // What this cache actually costs is invisible in a heap profile, because a
  // DataTexture's pixels live in an external ArrayBuffer rather than the JS
  // heap: Bones' studio_kontrast_04_2k.hdr is 5.9MB on the wire and decodes
  // to 2048 x 1024 half-float RGBA — ~16.8MB — held at module scope for the
  // life of the document. Worth every byte while viewers are being built and
  // rebuilt during a scroll (it's what stops N simultaneous viewers decoding
  // the same file N times), and worth nothing at all once the page is frozen
  // or backgrounded, which on iOS is precisely when the memory is wanted
  // elsewhere. Rebuilding it costs one re-decode on the next viewer built
  // after the visitor returns, by which point they're looking at an icon
  // fading into a model anyway.
  //
  // Guarded on in-flight loads rather than cancelling them: clearing the map
  // mid-load doesn't stop the decode (its awaiters hold the promise
  // directly), it just guarantees the next caller starts a second one.
  function releaseHdrSources() {
    if (hdrLoadsInFlight > 0) return;
    hdrSourceCache = {};
  }

  window.addEventListener("pagehide", releaseHdrSources);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") releaseHdrSources();
  });

  function loadEnvironment(renderer, hdriSrc) {
    var src = hdriSrc || DEFAULT_HDRI_SRC;
    var pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    return loadHdrSource(src).then(
      function (sourceTexture) {
        // A fresh DataTexture per call, sharing sourceTexture's pixel
        // buffer by reference rather than copying it. It exists only long
        // enough for PMREM to upload it into THIS renderer's context and
        // is disposed immediately after — disposing a DataTexture frees
        // the GPU copy, never the JS typed array behind it, so the cached
        // source survives untouched for the next viewer.
        var image = sourceTexture.image;
        var equirect = new THREE.DataTexture(image.data, image.width, image.height, sourceTexture.format, sourceTexture.type);
        equirect.colorSpace = sourceTexture.colorSpace;
        equirect.magFilter = sourceTexture.magFilter;
        equirect.minFilter = sourceTexture.minFilter;
        equirect.generateMipmaps = sourceTexture.generateMipmaps;
        equirect.flipY = sourceTexture.flipY;
        equirect.needsUpdate = true;

        // The whole render target, not just its .texture. PMREMGenerator
        // hands ownership of the target to the caller — pmremGenerator
        // .dispose() below frees only the generator's own scratch
        // resources — so disposing the texture alone would leave the
        // target's framebuffer behind with nothing holding a reference
        // that could ever free it.
        var renderTarget = pmremGenerator.fromEquirectangular(equirect);
        equirect.dispose();
        pmremGenerator.dispose();
        return renderTarget;
      },
      // Without this, a failed HDRI request (network blip, server hiccup)
      // left this promise neither resolved nor rejected —
      // Promise.all([modelPromise, environmentPromise]) below then hung
      // forever with zero console output, so the model silently never
      // appeared and there was no way to tell why. Rejecting here at least
      // surfaces the failure and lets it fall through to the same "poster
      // stays as the fallback" behavior a model-load failure already gets.
      function (err) {
        pmremGenerator.dispose();
        console.error("emjive: failed to load HDRI environment", src, err);
        throw err;
      }
    );
  }

  // ---- session-wide idle-nudge suppression: once the visitor has really
  // dragged any one viewer (this page, or an earlier one this session),
  // every viewer's idle "nudge" hint stops scheduling itself — they've
  // already learned it's draggable. sessionStorage (not localStorage) so
  // it's remembered for revisits within the same browsing session but
  // doesn't permanently disable it for a brand new visit days later. ----
  var INTERACTION_SEEN_KEY = "emjive_model_interacted";
  var interactionSuppressed = false;
  try {
    interactionSuppressed = sessionStorage.getItem(INTERACTION_SEEN_KEY) === "1";
  } catch (e) {
    // sessionStorage unavailable (private browsing, etc.) — just falls
    // back to per-page-load behavior instead of remembering across nav.
  }
  // Every LIVE viewer's cancelNudge, so the first real drag anywhere can
  // silence the hint everywhere at once. Entries MUST be removed on
  // dispose() — see unregisterCancelNudge below. A cancelNudge is a
  // closure over its whole buildThreeViewer() invocation, so holding one
  // holds that viewer's scene, renderer and fully decoded model geometry
  // with it; while this array only ever grew, every viewer the homepage
  // grid had ever built stayed in memory for the life of the page, however
  // diligently dispose() freed its GPU-side resources. Measured on the
  // Bones grid, that was ~1GB of unreclaimable JS heap per three passes of
  // scrolling the page end to end — a straight line up until the tab died,
  // which on iOS Safari means the page reloading itself.
  var allCancelNudgeFns = [];

  function unregisterCancelNudge(cancel) {
    var i = allCancelNudgeFns.indexOf(cancel);
    if (i !== -1) allCancelNudgeFns.splice(i, 1);
  }

  function suppressNudgeEverywhere() {
    interactionSuppressed = true;
    // Copied before iterating: a cancel() implementation is free to
    // unregister itself, which would otherwise shift the array out from
    // under this loop and skip entries.
    allCancelNudgeFns.slice().forEach(function (cancel) {
      cancel();
    });
    try {
      sessionStorage.setItem(INTERACTION_SEEN_KEY, "1");
    } catch (e) {
      // Ignore — worst case it just won't be remembered on the next page.
    }
  }

  var POST_INERTIA_PAUSE = 420; // ms of stillness once it's actually stopped, before easing back
  var ROLLBACK_DURATION = 1200; // ms
  var ROLLBACK_BEZIER = [0.65, 0, 0.35, 1]; // gentle at both ends, unhurried
  var IDLE_NUDGE_DELAY = 3000; // ms of no interaction before the nudge plays
  var NUDGE_ANGLE_RAD = (15 * Math.PI) / 180;
  var HAND_OFFSETS = [0, -40, 40]; // px, index-matched to the 3 nudge waypoints
  var DRIFT_RATE = 1.5; // 1/second, continuous up-leveling rate
  var SETTLE_ANGULAR_VELOCITY = 0.024; // rad/s treated as "spin has stopped"
  var REF_DT = 1 / 60;
  // Progressive-braking tuning: plain exponential decay (a single constant
  // lambda) keeps slowing at the same PROPORTIONAL rate forever, which
  // means its absolute motion gets imperceptibly slow well before it's
  // actually at rest — reads as trailing off rather than stopping. Below
  // PROGRESSIVE_BOOST_SPEED (rad/s), lambda ramps up smoothly toward
  // PROGRESSIVE_BOOST_MAX times its baseline value as speed approaches
  // zero, so the last bit of a spin brakes harder and stops crisply
  // instead of coasting forever. At/above this speed, feel is unchanged.
  var PROGRESSIVE_BOOST_SPEED = 0.5; // rad/s
  var PROGRESSIVE_BOOST_MAX = 4;

  // Builds a three.js viewer for a product and returns a handle so callers
  // (the homepage grid, and the product detail page's carousel) can swap
  // its metal finish later without reloading the .glb or losing whatever
  // camera angle the visitor left it at. Exposed as window.EmjiveModelViewer
  // at the bottom of this file. `options.onReady` fires once after the model
  // has loaded, been framed to its default pose, and painted one frame —
  // for scripts/auto-render.js's render harness it's the direct replacement
  // for the old model-viewer harness's `load` event + `jumpCameraToGoal()` +
  // settle-frame wait; js/main.js's grid uses the same hook to time its
  // icon -> model crossfade off the real "there is something to see now"
  // moment. `options.onError` is its counterpart for a model/HDRI that
  // never arrives, so a caller can restore its own fallback instead of
  // leaving an empty box.
  function buildThreeViewer(product, metalKey, options) {
    options = options || {};
    // `transparentBackground`/`static` only exist for
    // scripts/auto-render.js's render harness — never set by the
    // interactive site. `static` skips the idle-nudge hint and the
    // continuous animate loop entirely (only explicit render() calls, from
    // the initial load and from setCameraOrbit()), so nothing can shift
    // the framing between the harness's onReady firing and its screenshot
    // actually being taken a few ms later.
    var isStatic = !!options.static;
    // Tool-only (scene-tool.html), never set by the interactive site or by
    // scripts/auto-render.js's harness. Wants the OPPOSITE trade-off from
    // `static`: full interactive dragging (unlike static, which never
    // starts the animate loop at all, so a drag would be visually dead),
    // but with the two "auto-correcting" behaviors below (release inertia,
    // the ease-back-to-default reset) switched off — the whole point is
    // manually setting a pose and having it stay exactly there so it can
    // be read back and saved.
    var isFreeOrbit = !!options.freeOrbit;
    // `transparentBackground` used to also gate the renderer's own alpha
    // (the interactive site rendered opaque, near-black, on purpose — see
    // git history) but that traded a real bug (a solid black square behind
    // every model until/unless it exactly fills its frame) for a subtler
    // one (semi-transparent edge pixels reading slightly off under ACES
    // tone mapping when later composited over a page background). The
    // black square is worse, so both the interactive site and the render
    // harness (scripts/auto-render.js) now render with a genuinely
    // transparent canvas; this flag is kept only to gate
    // `preserveDrawingBuffer`, still harness-only — needed for an
    // external screenshot readback of the canvas; the interactive site
    // never reads its own canvas back.
    var preserveBuffer = !!options.transparentBackground;

    var wrapper = document.createElement("div");
    wrapper.className = "emjive-3d-viewer";

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: preserveBuffer
      });
    } catch (err) {
      // A browser's per-page WebGL context budget is finite — once it's
      // exhausted (several simultaneous viewers, bfcache-retained
      // contexts from earlier navigations, a weak/mobile GPU), this
      // constructor throws synchronously. Left uncaught, this used to
      // blow up the caller's whole products.forEach loop (js/main.js)
      // mid-iteration, silently dropping every remaining product — no
      // model AND no icon fallback, since callers only build the icon
      // fallback when this function returns null, not when it throws.
      // Returning null instead lets both js/main.js and js/product.js
      // fall back to the plain icon image, same as a product with no
      // "model" field at all.
      console.error("emjive: could not create a WebGL context for", product.name, err);
      return null;
    }
    // Canvas backing-store memory is width * height * pixelRatio^2 * 4
    // bytes, doubled again by antialias: true's multisample buffer — and
    // iOS Safari enforces a hard TOTAL canvas budget across the whole
    // page, not a per-canvas one, killing the tab ("A problem repeatedly
    // occurred") once every canvas added together crosses it. The homepage
    // grid is the only place several viewers are alive at once, so it's
    // the only caller that lowers this (see js/main.js); a phone's DPR 3
    // capped at 2 still meant each card carried 2.25x the pixels of a
    // DPR-1.5 one, for a ~400px box where the difference is invisible.
    var maxPixelRatio = typeof options.maxPixelRatio === "number" ? options.maxPixelRatio : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.domElement.className = "emjive-3d-viewer__canvas";
    wrapper.appendChild(renderer.domElement);

    // Poster only matters pre-load, so this is fixed to whatever metal the
    // viewer is being built for — never needs to change after (by the time
    // a visitor could switch metals in the picker, the real model has
    // already loaded and the poster is long gone). Uses fallback-img, not
    // icons — icons is cropped/re-centered for use as a flat thumbnail
    // elsewhere (see js/main.js, js/product.js) and doesn't match the
    // model's actual default framing, which produced a visible "jump" the
    // instant the real model swapped in. fallback-img is the model's own
    // default-orbit capture saved as-is (see scripts/auto-render.js), so it
    // lines up with the live canvas's first frame instead.
    // options.poster: false opts out entirely — for a caller that already
    // has its own image sitting behind the viewer and does its own
    // crossfade (js/main.js's grid cards, where the card's icon is already
    // on screen). Running both there would mean fading the model in over a
    // poster that's simultaneously fading out over the icon: three images
    // of the same ring, two of them semi-transparent, for half a second.
    var posterEl = null;
    var posterSrc = options.poster === false
      ? null
      : product.assets && product.assets["fallback-img"] && product.assets["fallback-img"][metalKey];
    if (posterSrc) {
      posterEl = document.createElement("img");
      posterEl.className = "emjive-3d-viewer__poster";
      posterEl.src = posterSrc;
      posterEl.alt = "";
      wrapper.appendChild(posterEl);
    }

    // A <div>, not an <img> — its visible pixels come entirely from the
    // backdrop-filter invert clipped to the SVG's mask shape (see the CSS
    // rule), not from any fill/stroke painted by the element itself.
    var nudgeHandEl = document.createElement("div");
    nudgeHandEl.className = "emjive-3d-viewer__nudge-hand";
    wrapper.appendChild(nudgeHandEl);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);

    // Declared up here, not down by dispose(), because both async load
    // chains below have to be able to read it. js/main.js's grid disposes
    // a viewer the moment its card scrolls clear — which routinely happens
    // while that card's .glb (tens of MB) and HDRI are still in flight, so
    // "was I torn down before this arrived?" is the normal case during a
    // fast scroll, not an edge case.
    var isDisposed = false;

    // options.onError is meant to fire at most once — see reportError()
    // below — but it now has two independent triggers (the load/HDRI
    // failure path further down, and a WebGL context loss that can happen
    // well after a successful load, see handleContextLost). Without this
    // guard, a context loss arriving after an already-rejected load promise
    // (or vice versa) would call a caller's onError twice.
    var hasErrored = false;
    function reportError() {
      if (isDisposed || hasErrored) return;
      hasErrored = true;
      if (options.onError) options.onError();
    }

    // iOS Safari silently reclaims WebGL contexts under memory pressure —
    // independent of, and often well after, a model's own successful load
    // (several simultaneous viewers on the homepage grid, or just the page
    // being backgrounded and foregrounded again). Nothing else in this file
    // would ever notice: modelLoaded stays true, the poster/icon crossfade
    // already finished, and the render-on-demand loop below only redraws on
    // camera motion, so a lost context just leaves the canvas permanently
    // blank with every piece of this module's own state insisting
    // everything is fine. Not attempting real restoration here (re-
    // uploading textures/geometry into a webglcontextrestored context) —
    // deliberately NOT calling event.preventDefault(), which per spec means
    // the browser won't try to restore it — since iOS Safari's own
    // memory-pressure losses are frequently never restorable anyway, and
    // this site already has a proven, always-available fallback for "can't
    // show the 3D model": the same static icon a product with no model at
    // all gets. reportError() routes there via options.onError exactly like
    // a load failure does.
    function handleContextLost() {
      console.error("emjive: WebGL context lost for", product.name);
      reportError();
    }
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost, false);

    // Frees a loaded model's own GPU buffers. Split out of dispose()
    // because the late-arrival paths below need exactly the same teardown
    // for a model that showed up after the viewer was already gone —
    // without it, everything a fast scroll started but didn't finish
    // leaked its full decoded geometry, which is precisely the memory the
    // lazy grid exists to cap.
    function disposeObject3D(root) {
      if (!root) return;
      root.traverse(function (node) {
        if (!node.isMesh) return;
        if (node.geometry) node.geometry.dispose();
        var material = node.material;
        if (!material) return;
        if (Array.isArray(material)) material.forEach(function (m) { m.dispose(); });
        else material.dispose();
      });
    }

    // Not fired-and-forgotten: the environment load and the GLTF load
    // below are two independent async chains with no inherent ordering,
    // and Promise.all()'d together (see below) rather than racing —
    // otherwise the first frame (the one the render harness screenshots)
    // could get captured before the environment texture has actually
    // landed on the scene, rendering flat black.
    // Held separately from scene.environment (which is only the target's
    // .texture) so dispose() can free the whole render target — see
    // loadEnvironment's own comment.
    var environmentTarget = null;
    var environmentPromise = loadEnvironment(renderer, options.hdri).then(function (renderTarget) {
      // Arriving after teardown: the PMREM target is real GPU memory on a
      // renderer that's already been released, so it has to be freed here
      // rather than attached to a scene nothing will ever draw again.
      if (isDisposed) {
        renderTarget.dispose();
        return;
      }
      environmentTarget = renderTarget;
      scene.environment = renderTarget.texture;
    });

    // Initial size read synchronously (before any async load resolves) so
    // the renderer/camera are correctly sized from the very first frame —
    // a ResizeObserver alone would leave both at a stale default until its
    // first callback, which could lose the race against the GLTF load.
    var currentWidth = 1;
    var currentHeight = 1;
    // Set by anything that changes what the canvas should show WITHOUT
    // moving the camera — a resize, a metal swap. Declared here rather
    // than beside the rest of the animate-loop state because applySize()
    // is called synchronously below, well before that block. Consumed (and
    // cleared) once per frame by the animate loop.
    var needsRender = false;
    // `controls` isn't constructed yet the first time applySize() runs
    // (see below) — referencing it here is safe regardless, since `var`
    // hoists the declaration and this function isn't CALLED until after
    // that first synchronous invocation returns.
    function applySize(w, h) {
      w = Math.max(1, w);
      h = Math.max(1, h);
      if (w === currentWidth && h === currentHeight) return;
      currentWidth = w;
      currentHeight = h;
      renderer.setSize(w, h, false); // false: don't fight the existing CSS sizing
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // A resize repaints nothing by itself, and the render-on-demand loop
      // keys off camera MOTION — which a resize isn't — so an idle viewer
      // would keep showing the pre-resize frame stretched to the new box
      // until something else happened to move. See needsRender's own
      // comment down in the animate loop.
      needsRender = true;
      // TrackballControls caches the element's screen rect itself
      // (.screen.width/left/etc, read via handleResize()) rather than
      // measuring it fresh on every pointer event — it only does this
      // once, in its own constructor. At construction time below, `wrapper`
      // is still a detached <div> (the caller hasn't appended it to the
      // page yet), so that first read is always 0x0 — and with
      // screen.width stuck at 0, _getMouseOnCircle() divides by zero on
      // every drag, producing NaN deltas that (NaN being falsy) silently
      // no-op the whole rotation, forever. Re-syncing it here, on every
      // real resize (including the first one after the wrapper actually
      // lands in the document and gets a real size), is what makes
      // dragging work at all.
      if (controls) controls.handleResize();
    }
    var initialRect = wrapper.getBoundingClientRect();
    applySize(initialRect.width || 1, initialRect.height || 1);

    var resizeObserver = new ResizeObserver(function (entries) {
      var box = entries[0].contentRect;
      applySize(box.width, box.height);
    });
    resizeObserver.observe(wrapper);

    var controls = new TrackballControls(camera, renderer.domElement);
    // Rotation only — matches the old disable-zoom behavior.
    controls.noZoom = true;
    controls.noPan = true;
    // Lower = a given drag distance produces less rotation — decouples the
    // motion from a direct 1:1 pointer mapping so it reads as heavier/more
    // deliberate rather than instantly following the cursor.
    controls.rotateSpeed = 0.5;
    // TrackballControls already decays into a spin on release rather than
    // stopping dead. This seed value assumes ~60fps; the actual per-frame
    // factor is re-derived every frame from SPIN_DECAY_LAMBDA + real dt
    // below, so spin-down feels the same at 60Hz vs. 120Hz+ displays
    // (TrackballControls.update() itself takes no delta-time argument).
    controls.dynamicDampingFactor = 0.04032;
    var SPIN_DECAY_LAMBDA = (-0.5 * Math.log(1 - controls.dynamicDampingFactor)) / REF_DT;
    // three.js's own built-in "no momentum" flag — under freeOrbit, rotation
    // only ever tracks the pointer's current position, never coasts on
    // release. Simpler and more robust than fighting the decay math below
    // (dynamicDampingFactor/SPIN_DECAY_LAMBDA) to approximate a dead stop.
    if (isFreeOrbit) controls.staticMoving = true;

    var defaultOrbit = product["3d-viewer-camera-default"] || DEFAULT_ORBIT;
    var explicitTarget = parseTargetString(product.cameraTarget);

    var defaultCameraPosition = new THREE.Vector3();
    var defaultCameraUp = new THREE.Vector3();
    var defaultRadius = 0;
    var nudgeWaypoints = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

    // Positions the camera instantly (no animation) at the given orbit,
    // re-measuring the model's current bounding sphere each time — used
    // both for the initial default framing and as the direct replacement
    // for model-viewer's jumpCameraToGoal()+camera-orbit combo in
    // scripts/auto-render.js's top-shot render path.
    function frameCamera(orbitConfig) {
      if (!modelRoot) return;
      var orbit = parseOrbitConfig(orbitConfig);
      var box = new THREE.Box3().setFromObject(modelRoot);
      var sphere = box.getBoundingSphere(new THREE.Sphere());
      var target = explicitTarget || sphere.center;
      var fovRad = (camera.fov * Math.PI) / 180;
      var distance = (sphere.radius / Math.sin(fovRad / 2)) * (orbit.radiusPercent / 100);
      // Tightened from the constructor's generic 0.01/1000 now that the
      // real scene scale is known — that wide a near:far span concentrates
      // depth-buffer precision too close to the camera, risking z-fighting
      // on the double-sided thin ring-band geometry.
      camera.near = Math.max(0.01, distance - sphere.radius * 2);
      camera.far = distance + sphere.radius * 4;
      var offset = new THREE.Vector3(
        distance * Math.sin(orbit.phiRad) * Math.sin(orbit.thetaRad),
        distance * Math.cos(orbit.phiRad),
        distance * Math.sin(orbit.phiRad) * Math.cos(orbit.thetaRad)
      );

      controls.target.copy(target);
      camera.position.copy(target).add(offset);
      camera.up.copy(WORLD_UP);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      controls.update();

      defaultCameraPosition.copy(camera.position);
      defaultCameraUp.copy(camera.up);
      defaultRadius = camera.position.distanceTo(controls.target);

      // Idle-nudge waypoints: the default eye direction, and that same
      // direction rotated +/- NUDGE_ANGLE_RAD around world-up. up doesn't
      // enter into it — a left/right yaw around the vertical axis doesn't
      // change what "level" means.
      nudgeWaypoints[0].copy(defaultCameraPosition).sub(controls.target).normalize();
      nudgeWaypoints[1].copy(nudgeWaypoints[0]).applyAxisAngle(WORLD_UP, NUDGE_ANGLE_RAD);
      nudgeWaypoints[2].copy(nudgeWaypoints[0]).applyAxisAngle(WORLD_UP, -NUDGE_ANGLE_RAD);
    }

    // currentMetal is read by applyMaterial(), and also by applyMetal()
    // once the model has already loaded — this is what lets a metal
    // switch after load re-run the same material assignment.
    var currentMetal = metalKey;
    var modelRoot = null;
    var modelLoaded = false;

    function applyMaterial() {
      if (!modelRoot) return;
      var params = metalToStandardMaterialParams(currentMetal);
      modelRoot.traverse(function (node) {
        if (!node.isMesh) return;
        // Always a fresh material, never mutating whatever the GLTF's own
        // mesh already had (GLTFLoader produces MeshStandardMaterial by
        // default, so a "reuse if already the right type" shortcut would
        // silently keep the artist's original textures/maps and skip the
        // DoubleSide fix below on every model). The band's geometry is
        // thin/open enough that some angles look straight through a
        // back-culled face into the inside — rendering both sides fixes
        // it, applied unconditionally to every mesh.
        node.material = new THREE.MeshStandardMaterial({
          color: params.color,
          metalness: params.metalness,
          roughness: params.roughness,
          side: THREE.DoubleSide
        });
      });
    }

    // options.primitive (scene-tool.html's swatch-scene mode, and
    // scripts/auto-render.js's swatch renderer) swaps a loaded GLTF for a
    // bare primitive mesh — everything downstream (frameCamera's bounding-
    // sphere measurement, applyMaterial's mesh traversal, controls, the
    // animate loop, freeOrbit, dispose) is already agnostic to how
    // modelRoot was built, so this is the only branch needed. `product` in
    // this mode can be a minimal stub (just "3d-viewer-camera-default" and
    // "name") — product.assets is never touched on this path.
    var modelPromise;
    if (options.primitive) {
      modelRoot = buildPrimitiveMesh(options.primitive);
      applyMaterial();
      scene.add(modelRoot);
      modelPromise = Promise.resolve();
    } else {
      // Overlaps the Draco decoder's own ~336KB fetch with this model's
      // (always larger) download instead of letting it serialize after it.
      // Safe to call for a non-Draco model too — GLTFLoader simply never
      // asks the decoder for anything.
      preloadDracoDecoder();
      modelPromise = new Promise(function (resolve, reject) {
        gltfLoader.load(
          product.assets.model,
          function (gltf) {
            // Same late-arrival case as the environment above, and the
            // more expensive of the two: this is the fully decoded
            // geometry of a model that can be tens of MB on the wire and
            // several times that in memory. Freed immediately rather than
            // added to a scene belonging to a released renderer.
            if (isDisposed) {
              disposeObject3D(gltf.scene);
              resolve();
              return;
            }
            modelRoot = gltf.scene;
            applyMaterial();
            scene.add(modelRoot);
            resolve();
          },
          undefined,
          function (err) {
            console.error("emjive: failed to load model", product.assets.model, err);
            reject(err);
          }
        );
      });
    }

    Promise.all([modelPromise, environmentPromise])
      .then(function () {
        // Both halves already free their own late arrivals above; this
        // guard is what stops the rest of the ready path from running on a
        // torn-down viewer — frameCamera() and especially
        // renderer.render() against a context that forceContextLoss() has
        // already killed, which is what filled the console with repeating
        // "THREE.WebGLRenderer: Context Lost" on every fast scroll.
        if (isDisposed) return;

        frameCamera(defaultOrbit);
        modelLoaded = true;

        renderer.render(scene, camera);
        if (posterEl) {
          posterEl.style.opacity = "0";
          posterEl.style.pointerEvents = "none";
        }

        scheduleIdleNudge();
        if (options.onReady) options.onReady();
      })
      // Previously absent, which made any model/HDRI failure an unhandled
      // promise rejection — noisy, and on a page with several viewers,
      // repeating. Both branches already logged the real cause on their
      // way to rejecting, so there's nothing to add here: the viewer just
      // stops at "poster still showing", the same degraded state a product
      // with no model at all gets. reportError() (shared with
      // handleContextLost above) is what actually calls options.onError,
      // letting a caller (the grid, the product-page carousel) put its own
      // static icon back instead of leaving a dead box.
      .catch(reportError);

    // ---- idle reset / nudge / drift state (per-instance) ----
    var isDragging = false;
    var waitingForSettle = false;
    var pauseTimeoutId = null;
    var resetTweenActive = false;
    var resetTweenStartTime = 0;
    var resetTweenFromPosition = new THREE.Vector3();
    var resetTweenFromUp = new THREE.Vector3();
    var nudgeActive = false;
    var nudgePhase = 0;
    var nudgePhaseStartTime = 0;
    var idleTimeoutId = null;
    var lastFrameTime = null;
    var lastAngularSpeed = 0; // rad/s, previous frame's spin rate — see PROGRESSIVE_BOOST_* above

    var eyeDirection = new THREE.Vector3();
    var eyeDirectionPrev = new THREE.Vector3();
    var preFrameUp = new THREE.Vector3();
    var tangentTowardUp = new THREE.Vector3();
    var driftDelta = new THREE.Vector3();
    var fromDirection = new THREE.Vector3();
    var toDirection = new THREE.Vector3();
    var tweenDirection = new THREE.Vector3();

    function cancelReturnToPose() {
      waitingForSettle = false;
      resetTweenActive = false;
      if (pauseTimeoutId) {
        clearTimeout(pauseTimeoutId);
        pauseTimeoutId = null;
      }
    }

    function clearIdleTimer() {
      if (idleTimeoutId) {
        clearTimeout(idleTimeoutId);
        idleTimeoutId = null;
      }
    }

    function cancelNudge() {
      nudgeActive = false;
      clearIdleTimer();
      nudgeHandEl.style.opacity = "0";
    }
    allCancelNudgeFns.push(cancelNudge);

    function scheduleIdleNudge() {
      clearIdleTimer();
      if (interactionSuppressed || isStatic || isFreeOrbit) return;
      idleTimeoutId = setTimeout(function () {
        idleTimeoutId = null;
        nudgePhase = 0;
        nudgePhaseStartTime = performance.now();
        nudgeActive = true;
      }, IDLE_NUDGE_DELAY);
    }

    controls.addEventListener("start", function () {
      isDragging = true;
      cancelReturnToPose();
      cancelNudge();
    });
    controls.addEventListener("end", function () {
      isDragging = false;
      waitingForSettle = true;
    });

    // Detected via our own pointer tracking (not TrackballControls' "start"
    // event, which fires on any pointerdown regardless of movement) so a
    // bare tap/click doesn't count as "they've discovered it's draggable" —
    // only a real drag past a small threshold suppresses the nudge. Skipped
    // entirely in static/harness mode — headless, nothing to ever suppress.
    //
    // Registered through wrapperListeners rather than directly, so
    // dispose() can take them off again. This matters far more than it
    // looks: each of these handlers is a closure over the whole
    // buildThreeViewer() invocation — renderer, scene, controls, the
    // decoded model — and a listener on an element is reachable from that
    // element. As long as anything anywhere still referenced this
    // wrapper's <div> (and something does: three.js's own WebGL context
    // teardown keeps the canvas reachable for a while after
    // forceContextLoss), every viewer the grid had ever built stayed
    // fully in memory, disposed or not. Measured on the Bones grid before
    // this: 26 live WebGLRenderers after two scroll passes with zero
    // viewers actually on screen, growing linearly with every further
    // pass.
    var wrapperListeners = [];
    function addWrapperListener(type, handler) {
      wrapperListeners.push([type, handler]);
      wrapper.addEventListener(type, handler);
    }

    // Same idea for listeners this viewer has to put on shared objects
    // (document/window) rather than on its own DOM. These are the ones it
    // would be easiest to leak — nothing about a document-level listener
    // goes away when the wrapper is removed from the page — and each is a
    // closure over this whole invocation, exactly like the wrapper
    // listeners above. Populated further down (see the render-on-demand
    // block); torn down in dispose() alongside them.
    var globalListeners = [];
    function addGlobalListener(targetEl, type, handler) {
      globalListeners.push([targetEl, type, handler]);
      targetEl.addEventListener(type, handler);
    }

    if (!isStatic) {
      var suppressDragStartX = null;
      var suppressDragStartY = null;
      addWrapperListener("pointerdown", function (e) {
        suppressDragStartX = e.clientX;
        suppressDragStartY = e.clientY;
      });
      addWrapperListener("pointermove", function (e) {
        if (interactionSuppressed || suppressDragStartX === null) return;
        var dx = e.clientX - suppressDragStartX;
        var dy = e.clientY - suppressDragStartY;
        if (Math.sqrt(dx * dx + dy * dy) > 6) suppressNudgeEverywhere();
      });
      addWrapperListener("pointerup", function () {
        suppressDragStartX = null;
        suppressDragStartY = null;
      });
    }

    var handle = {
      el: wrapper,
      applyMetal: function (newMetalKey) {
        currentMetal = newMetalKey;
        if (modelLoaded) applyMaterial();
        // The camera hasn't moved, so the render-on-demand loop below
        // would otherwise skip every frame and leave the old finish on
        // screen indefinitely — this is the "something changed that isn't
        // camera motion" signal it watches for.
        needsRender = true;
      },
      setCameraOrbit: function (orbitConfig) {
        frameCamera(orbitConfig);
        renderer.render(scene, camera);
      },
      // Internal handles, unused by the interactive site — exist so
      // scripts/auto-render.js's render harness can add its own top-shot-
      // only lighting/shadow-plane setup without that scope leaking into
      // the shared production builder itself. `target` (scene-tool.html
      // only) is the live orbit-center Vector3 controls.target itself —
      // mutated in place via .copy(), never reassigned, so exposing the
      // reference once here stays correct for as long as the handle lives.
      scene: scene,
      camera: camera,
      renderer: renderer,
      target: controls.target,
      // Teardown for any caller that builds-and-replaces a viewer
      // mid-session — scene-tool.html, and js/main.js's grid, which
      // disposes a card's viewer as soon as it scrolls clear. Without it,
      // rebuilding mid-session would leak: the animate loop keeps
      // recursing on a detached canvas forever, TrackballControls' own
      // window-level keydown/keyup listeners are never released, and the
      // ResizeObserver is never disconnected. Idempotent — a double
      // dispose (or a dispose racing a caller's own cleanup) is a no-op
      // rather than a second forceContextLoss() on a dead context.
      dispose: function () {
        if (isDisposed) return;
        isDisposed = true;
        cancelReturnToPose();
        clearIdleTimer();
        // The one piece of teardown that isn't about GPU resources, and
        // the one that was missing: without it this viewer's cancelNudge
        // — and through it the entire closure, model geometry included —
        // stays reachable from the module-level registry forever. See the
        // comment on allCancelNudgeFns.
        unregisterCancelNudge(cancelNudge);
        // Same reasoning as the registry above, for the DOM side — see
        // wrapperListeners' own comment. controls.dispose() below only
        // covers TrackballControls' own listeners, not these.
        wrapperListeners.forEach(function (pair) {
          wrapper.removeEventListener(pair[0], pair[1]);
        });
        wrapperListeners.length = 0;
        // The document/window ones matter more than the wrapper ones: the
        // shared targets they're attached to outlive this viewer by the
        // whole page, so a missed removal here retains the entire closure
        // (renderer, scene, decoded model) for good.
        globalListeners.forEach(function (triple) {
          triple[0].removeEventListener(triple[1], triple[2]);
        });
        globalListeners.length = 0;
        // Same closure-retention concern as wrapperListeners above, just on
        // the canvas rather than the wrapper — handleContextLost is a
        // closure over this entire buildThreeViewer() invocation too.
        renderer.domElement.removeEventListener("webglcontextlost", handleContextLost, false);
        resizeObserver.disconnect();
        controls.dispose();
        // Beyond the renderer/controls/observer teardown above, the loaded
        // model's own GPU buffers and the environment's PMREM texture are
        // real GPU memory too, tied to THIS renderer's context — freeing
        // just the renderer/controls left both to linger until GC. Needed
        // now that js/main.js's grid lazily builds/disposes a viewer per
        // card on scroll rather than building one, page-lifetime — without
        // a real teardown here, repeated build/dispose cycles would leak
        // exactly the GPU memory this whole lazy scheme exists to cap.
        // Anything still in flight at this point is freed by the
        // isDisposed branches in the two load callbacks instead.
        disposeObject3D(modelRoot);
        if (environmentTarget) environmentTarget.dispose();
        scene.environment = null;
        renderer.dispose();
        // renderer.dispose() alone frees the renderer's own bookkeeping
        // (shader program cache, render lists) but doesn't reliably return
        // the underlying WebGL context to the browser — forceContextLoss
        // does, and is what actually frees up a slot against the browser's
        // finite per-page WebGL context budget (js/main.js's grid can hit
        // this repeatedly now, unlike the old build-once-per-page-load
        // caller this method was originally written for).
        if (renderer.forceContextLoss) renderer.forceContextLoss();
      }
    };

    // Static/harness mode never starts this loop — only explicit render()
    // calls happen (from the load callback above, and from
    // setCameraOrbit()), so nothing (release inertia, the leveling drift,
    // the idle nudge) can shift the framing between the harness's onReady
    // firing and its screenshot actually being taken a few ms later.
    if (isStatic) return handle;

    // ---- render-on-demand bookkeeping ---------------------------------
    // The pose the canvas currently SHOWS, as opposed to the pose the
    // camera currently holds. Every frame below updates the camera, then
    // only actually draws if the two have diverged by more than a
    // sub-pixel amount (or if needsRender flags a non-camera change).
    //
    // This loop used to end in an unconditional renderer.render(), so a
    // viewer that had finished loading and was sitting perfectly still
    // still issued a full WebGL draw 60+ times a second, forever, for as
    // long as it existed. On the homepage that's every live card in the
    // grid at once, permanently — a constant GPU/battery/thermal draw for
    // pixels identical to the ones already on screen, and on a phone the
    // thermal throttling that causes makes the *next* real interaction
    // worse. Comparing angles rather than world-space distances keeps the
    // threshold meaningful regardless of how large a given model is.
    //
    // The catch, and it is not hypothetical: skipping redundant draws is
    // only safe while the canvas actually KEEPS what was last drawn into
    // it. Every viewer here is created with preserveDrawingBuffer: false
    // (the default; only auto-render.js's harness sets it true), which
    // explicitly licenses the browser to throw the drawing buffer away
    // after compositing it — and iOS Safari genuinely does, under memory
    // pressure, on tab/app backgrounding, and on a bfcache restore. No
    // webglcontextlost fires for this: the context stays perfectly alive,
    // only the pixels are gone, so handleContextLost's icon fallback never
    // triggers either. The old unconditional per-frame render hid this
    // completely by repainting within ~16ms of any discard; with
    // render-on-demand, an idle viewer that has settled never draws again,
    // and the blank canvas is permanent until the page is reloaded. On
    // this site the easiest way to hit it is the most ordinary navigation
    // there is: tap a product, press Back, and every model on the restored
    // homepage is gone.
    //
    // So: flag a redraw on each documented occasion the buffer can come
    // back empty. needsRender (rather than a direct render() call) so the
    // repaint lands in the normal animate-loop path — on a bfcache restore
    // or a tab return, rAF is paused at the moment these fire, and drawing
    // straight into a context the compositor isn't servicing yet is how
    // you get a frame that's silently dropped anyway.
    function requestRepaint() {
      needsRender = true;
    }
    // Tab/app switch return. Fires on the way out too (visibilityState
    // "hidden"), which is harmless — the flag just sits set until the loop
    // resumes, which is exactly when it's wanted.
    addGlobalListener(document, "visibilitychange", requestRepaint);
    // Back/forward bfcache restore — the case above that this site hits
    // most. Not gated on event.persisted: a normal load fires pageshow too,
    // where the flag is redundant rather than wrong (the load path renders
    // once itself), and the gate would only add a way to get this wrong.
    addGlobalListener(window, "pageshow", requestRepaint);
    // If the browser DOES restore a genuinely lost context, three.js
    // re-initializes its GL state automatically, but nothing asks for the
    // first frame back. Costs one listener to not leave that blank.
    addGlobalListener(renderer.domElement, "webglcontextrestored", requestRepaint);

    var renderedEye = new THREE.Vector3();
    var renderedUp = new THREE.Vector3();
    // Its own scratch vector rather than reusing eyeDirection: that one is
    // the else-branch's frame-to-frame angular-speed state (it's read via
    // eyeDirectionPrev at the top of the next frame), and writing to it
    // from here — which also runs during the nudge/reset tweens, where the
    // else branch isn't maintaining it — would quietly feed a bogus dt
    // into lastAngularSpeed on the first frame after a tween ends.
    var currentEye = new THREE.Vector3();
    var hasRenderedOnce = false;
    // ~0.006 degrees: far below one pixel of movement at any canvas size
    // this site uses, so nothing perceptible is ever skipped. Also smaller
    // than SETTLE_ANGULAR_VELOCITY * dt, so a release always registers as
    // settled (arming the ease-back-to-default) BEFORE drawing stops —
    // never the other way round, which would strand the camera wherever
    // the inertia happened to fade out.
    var STILL_ANGLE_EPSILON = 1e-4;

    function drawIfChanged() {
      currentEye.copy(camera.position).sub(controls.target).normalize();
      var changed = needsRender ||
                    !hasRenderedOnce ||
                    currentEye.angleTo(renderedEye) > STILL_ANGLE_EPSILON ||
                    camera.up.angleTo(renderedUp) > STILL_ANGLE_EPSILON;
      if (!changed) return;

      needsRender = false;
      hasRenderedOnce = true;
      renderedEye.copy(currentEye);
      renderedUp.copy(camera.up);
      renderer.render(scene, camera);
    }

    (function animate(now) {
      if (isDisposed) return; // torn down mid-session (scene-tool.html) — stop recursing for good
      requestAnimationFrame(animate);

      // requestAnimationFrame hands us a real timestamp, so dt is measured
      // rather than assumed — everything below scales with it instead of
      // running at a fixed per-frame rate. Clamped so a backgrounded-tab
      // resume (or a long GC pause) doesn't apply minutes of decay/drift in
      // one jump.
      var dt = lastFrameTime === null ? REF_DT : Math.min((now - lastFrameTime) / 1000, 1 / 15);
      lastFrameTime = now;

      if (!modelLoaded) {
        return; // nothing to render/animate yet — poster is showing
      }

      if (nudgeActive) {
        var nt = Math.min(1, (performance.now() - nudgePhaseStartTime) / ROLLBACK_DURATION);
        var neased = cubicBezierEase(nt, ROLLBACK_BEZIER[0], ROLLBACK_BEZIER[1], ROLLBACK_BEZIER[2], ROLLBACK_BEZIER[3]);

        slerpVectors(tweenDirection, nudgeWaypoints[nudgePhase], nudgeWaypoints[(nudgePhase + 1) % 3], neased);
        camera.position.copy(tweenDirection).multiplyScalar(defaultRadius).add(controls.target);
        camera.up.copy(defaultCameraUp);
        camera.lookAt(controls.target);

        var handFrom = HAND_OFFSETS[nudgePhase];
        var handTo = HAND_OFFSETS[(nudgePhase + 1) % 3];
        var handOffsetPx = handFrom + (handTo - handFrom) * neased;
        nudgeHandEl.style.opacity = "1";
        // The source art's index-fingertip isn't at the image's own center
        // (it's the pointer's *tip* that needs to land on the model's
        // center, not the icon's bounding-box middle) — a fixed 40px
        // downward nudge past the normal center-anchor closes that gap.
        nudgeHandEl.style.transform = "translate(-50%, -50%) translateY(20px) translateX(" + handOffsetPx + "px)";

        if (nt >= 1) {
          nudgePhase++;
          if (nudgePhase >= 3) {
            nudgeActive = false;
            nudgeHandEl.style.opacity = "0";
            scheduleIdleNudge();
          } else {
            nudgePhaseStartTime = performance.now();
          }
        }
      } else if (resetTweenActive) {
        var t = Math.min(1, (performance.now() - resetTweenStartTime) / ROLLBACK_DURATION);
        var eased = cubicBezierEase(t, ROLLBACK_BEZIER[0], ROLLBACK_BEZIER[1], ROLLBACK_BEZIER[2], ROLLBACK_BEZIER[3]);

        fromDirection.copy(resetTweenFromPosition).sub(controls.target).normalize();
        toDirection.copy(defaultCameraPosition).sub(controls.target).normalize();
        slerpVectors(tweenDirection, fromDirection, toDirection, eased);
        camera.position.copy(tweenDirection).multiplyScalar(defaultRadius).add(controls.target);

        slerpVectors(camera.up, resetTweenFromUp, defaultCameraUp, eased);
        camera.lookAt(controls.target);
        if (t >= 1) {
          resetTweenActive = false;
          scheduleIdleNudge();
        }
      } else {
        // Both the spin's own momentum (TrackballControls rotating .up
        // right along with the eye) and the leveling drift want to move
        // .up this frame. Taking drift's delta from .up as it stood BEFORE
        // this frame's momentum update, then adding it to .up as
        // controls.update() leaves it, means drift isn't reacting to (and
        // partially undoing) whatever momentum just did.
        preFrameUp.copy(camera.up);
        var slowness = 1 - Math.min(1, lastAngularSpeed / PROGRESSIVE_BOOST_SPEED);
        var lambdaThisFrame = SPIN_DECAY_LAMBDA * (1 + slowness * PROGRESSIVE_BOOST_MAX);
        controls.dynamicDampingFactor = 1 - Math.exp(-2 * lambdaThisFrame * dt);
        controls.update();

        eyeDirectionPrev.copy(eyeDirection);
        eyeDirection.copy(camera.position).sub(controls.target).normalize();
        lastAngularSpeed = eyeDirectionPrev.angleTo(eyeDirection) / dt;

        var poleAlignment = Math.abs(eyeDirection.dot(WORLD_UP));

        // freeOrbit skips this leveling-drift correction entirely — the
        // whole point is that camera.up (and therefore the framing) stays
        // exactly wherever the drag left it, with no auto-correction ever
        // nudging it back toward level.
        if (!isFreeOrbit) {
          var s = preFrameUp.dot(WORLD_UP);
          tangentTowardUp.copy(WORLD_UP).addScaledVector(preFrameUp, -s);
          var driftRateThisFrame = 1 - Math.exp(-DRIFT_RATE * dt);
          driftDelta.copy(tangentTowardUp).multiplyScalar(driftRateThisFrame * s * (1 - poleAlignment));
          camera.up.add(driftDelta).normalize();
        }
        camera.lookAt(controls.target);

        if (waitingForSettle && !isDragging) {
          var frameAngle = eyeDirectionPrev.angleTo(eyeDirection);
          if (frameAngle < SETTLE_ANGULAR_VELOCITY * dt) {
            waitingForSettle = false;
            // freeOrbit skips arming the ease-back-to-default reset too —
            // combined with staticMoving above (no coasting) and the drift
            // skip just above (no up-vector correction), the camera simply
            // stays exactly where the drag left it once released.
            if (!isFreeOrbit) {
              pauseTimeoutId = setTimeout(function () {
                pauseTimeoutId = null;
                resetTweenFromPosition.copy(camera.position);
                resetTweenFromUp.copy(camera.up);
                resetTweenStartTime = performance.now();
                resetTweenActive = true;
              }, POST_INERTIA_PAUSE);
            }
          }
        }
      }

      drawIfChanged();
    })();

    return handle;
  }

  window.EmjiveModelViewer = buildThreeViewer;
  // Tool-only (scene-tool.html) — a live reference to the module's one
  // METAL_PRESETS object, not a copy. applyMetal()/buildThreeViewer's own
  // material application always re-reads METAL_PRESETS[metalKey] fresh on
  // every call, so the tool's shader-tuning sliders can mutate this object
  // in place (color/metalness/roughness for whichever metal is selected)
  // and just re-invoke applyMetal()/rebuild to preview the change — no
  // separate override-parameter mechanism needed. Never read by the
  // interactive site or by scripts/auto-render.js.
  window.EmjiveModelViewer.METAL_PRESETS = METAL_PRESETS;
})();
