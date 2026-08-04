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
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";

(function () {
  "use strict";

  var HDRI_SRC = "assets/hdri/studio_kontrast_04_1k.hdr";
  var DEFAULT_ORBIT = { rotation: 0, tilt: 75, zoom: 105 };
  var WORLD_UP = new THREE.Vector3(0, 1, 0);

  // PBR material presets applied to every mesh of a product's 3D model,
  // regardless of the model's own original materials/textures. Pick one
  // per product via the "metal" field in products.json (defaults to
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
  // cached/shared across instances despite each one using the exact same
  // source file: a PMREMGenerator's output texture is a GPU resource tied
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
  function loadEnvironment(renderer) {
    var pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    return new Promise(function (resolve, reject) {
      new HDRLoader().load(
        HDRI_SRC,
        function (hdrTexture) {
          var envMap = pmremGenerator.fromEquirectangular(hdrTexture).texture;
          hdrTexture.dispose();
          pmremGenerator.dispose();
          resolve(envMap);
        },
        undefined,
        // Without this, a failed HDRI request (network blip, server
        // hiccup) left this promise neither resolved nor rejected —
        // Promise.all([modelPromise, environmentPromise]) below then hung
        // forever with zero console output, so the model silently never
        // appeared and there was no way to tell why. Rejecting here at
        // least surfaces the failure and lets it fall through to the same
        // "poster stays as the fallback" behavior a model-load failure
        // already gets.
        function (err) {
          pmremGenerator.dispose();
          console.error("emjive: failed to load HDRI environment", HDRI_SRC, err);
          reject(err);
        }
      );
    });
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
  var allCancelNudgeFns = [];

  function suppressNudgeEverywhere() {
    interactionSuppressed = true;
    allCancelNudgeFns.forEach(function (cancel) {
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
  // at the bottom of this file. `options.onReady` (used only by
  // scripts/auto-render.js's render harness) fires once after the model
  // has loaded, been framed to its default pose, and painted one frame —
  // the direct replacement for the old model-viewer harness's
  // `load` event + `jumpCameraToGoal()` + settle-frame wait.
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.domElement.className = "emjive-3d-viewer__canvas";
    wrapper.appendChild(renderer.domElement);

    // Poster only matters pre-load, so this is fixed to whatever metal the
    // viewer is being built for — never needs to change after (by the time
    // a visitor could switch metals in the picker, the real model has
    // already loaded and the poster is long gone).
    var posterEl = null;
    var posterSrc = product.icons && product.icons[metalKey];
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

    // Not fired-and-forgotten: the environment load and the GLTF load
    // below are two independent async chains with no inherent ordering,
    // and Promise.all()'d together (see below) rather than racing —
    // otherwise the first frame (the one the render harness screenshots)
    // could get captured before the environment texture has actually
    // landed on the scene, rendering flat black.
    var environmentPromise = loadEnvironment(renderer).then(function (envMap) {
      scene.environment = envMap;
    });

    // Initial size read synchronously (before any async load resolves) so
    // the renderer/camera are correctly sized from the very first frame —
    // a ResizeObserver alone would leave both at a stale default until its
    // first callback, which could lose the race against the GLTF load.
    var currentWidth = 1;
    var currentHeight = 1;
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

    var defaultOrbit = product["camera-setup"] || DEFAULT_ORBIT;
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

    var modelPromise = new Promise(function (resolve, reject) {
      new GLTFLoader().load(
        product.model,
        function (gltf) {
          modelRoot = gltf.scene;
          applyMaterial();
          scene.add(modelRoot);
          resolve();
        },
        undefined,
        function (err) {
          console.error("emjive: failed to load model", product.model, err);
          reject(err);
        }
      );
    });

    Promise.all([modelPromise, environmentPromise]).then(function () {
      frameCamera(defaultOrbit);
      modelLoaded = true;

      renderer.render(scene, camera);
      if (posterEl) {
        posterEl.style.opacity = "0";
        posterEl.style.pointerEvents = "none";
      }

      scheduleIdleNudge();
      if (options.onReady) options.onReady();
    });

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
      if (interactionSuppressed || isStatic) return;
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
    if (!isStatic) {
      var suppressDragStartX = null;
      var suppressDragStartY = null;
      wrapper.addEventListener("pointerdown", function (e) {
        suppressDragStartX = e.clientX;
        suppressDragStartY = e.clientY;
      });
      wrapper.addEventListener("pointermove", function (e) {
        if (interactionSuppressed || suppressDragStartX === null) return;
        var dx = e.clientX - suppressDragStartX;
        var dy = e.clientY - suppressDragStartY;
        if (Math.sqrt(dx * dx + dy * dy) > 6) suppressNudgeEverywhere();
      });
      wrapper.addEventListener("pointerup", function () {
        suppressDragStartX = null;
        suppressDragStartY = null;
      });
    }

    var handle = {
      el: wrapper,
      applyMetal: function (newMetalKey) {
        currentMetal = newMetalKey;
        if (modelLoaded) applyMaterial();
      },
      setCameraOrbit: function (orbitConfig) {
        frameCamera(orbitConfig);
        renderer.render(scene, camera);
      },
      // Internal handles, unused by the interactive site — exist so
      // scripts/auto-render.js's render harness can add its own top-shot-
      // only lighting/shadow-plane setup without that scope leaking into
      // the shared production builder itself.
      scene: scene,
      camera: camera,
      renderer: renderer
    };

    // Static/harness mode never starts this loop — only explicit render()
    // calls happen (from the load callback above, and from
    // setCameraOrbit()), so nothing (release inertia, the leveling drift,
    // the idle nudge) can shift the framing between the harness's onReady
    // firing and its screenshot actually being taken a few ms later.
    if (isStatic) return handle;

    (function animate(now) {
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

        var s = preFrameUp.dot(WORLD_UP);
        tangentTowardUp.copy(WORLD_UP).addScaledVector(preFrameUp, -s);
        var driftRateThisFrame = 1 - Math.exp(-DRIFT_RATE * dt);
        driftDelta.copy(tangentTowardUp).multiplyScalar(driftRateThisFrame * s * (1 - poleAlignment));

        camera.up.add(driftDelta).normalize();
        camera.lookAt(controls.target);

        if (waitingForSettle && !isDragging) {
          var frameAngle = eyeDirectionPrev.angleTo(eyeDirection);
          if (frameAngle < SETTLE_ANGULAR_VELOCITY * dt) {
            waitingForSettle = false;
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

      renderer.render(scene, camera);
    })();

    return handle;
  }

  // Harness-only: builds a plain, dedicated metal material preview (a
  // cylinder, not any actual product) for scripts/auto-render.js's metal-
  // sample swatch bars. Deliberately not shaped like a product: the
  // swatch bars need a uniform, always-fully-filled material sample, not
  // an accidental close-up of one particular product's own curve — a
  // torus (the Disc ring, the original source for these) viewed edge-on
  // is always a thin diagonal band in a square frame, leaving empty
  // corners at any zoom, since its silhouette never exceeds a square
  // frame's bounds the way a solid convex shape's does. A cylinder
  // viewed from the side has a rectangular silhouette instead — sized
  // and framed here so it exceeds the square frame in both dimensions,
  // guaranteeing full coverage — while its continuous curvature still
  // catches a specular highlight arc across the surface from the shared
  // HDRI, the same quality the original ring close-ups had.
  function buildMaterialSwatch(metalKey, sizePx, options) {
    options = options || {};
    var wrapper = document.createElement("div");
    wrapper.className = "emjive-3d-viewer";

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
      });
    } catch (err) {
      // Same WebGL-context-budget failure mode as buildThreeViewer() above
      // — see its own comment. This harness-only builder has no icon
      // fallback to hand back, so callers (scripts/auto-render.js) just
      // get null instead of an uncaught throw, and decide what to do
      // themselves.
      console.error("emjive: could not create a WebGL context for the", metalKey, "swatch", err);
      return null;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(sizePx, sizePx, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.domElement.className = "emjive-3d-viewer__canvas";
    wrapper.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);

    var radius = 1;
    // Tall relative to its radius so the top/bottom edges always fall
    // well outside the frame regardless of the zoom factor below.
    var geometry = new THREE.CylinderGeometry(radius, radius, radius * 8, 96);
    var params = metalToStandardMaterialParams(metalKey);
    var mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: params.color, metalness: params.metalness, roughness: params.roughness })
    );
    scene.add(mesh);

    // Default cylinder orientation (axis along Y) already reads as "shiny
    // rod viewed from the side" for a camera looking down -Z — no rotation
    // needed. Distance is a fraction of the exact-tangent-fit distance
    // (where the frame edge exactly touches the cylinder's silhouette) —
    // below ~tan(fov/2) (~0.41 at this fov) the camera passes inside the
    // cylinder's own radius and renders nothing at all, so this must stay
    // above that floor. Closer (a smaller fraction) shows a narrower arc
    // of the curve — less of the grazing-angle edges where the HDRI's
    // brighter region blows out toward white — at the cost of some of the
    // curvature/highlight variation; 0.75 was picked by eye as the
    // balance between the two.
    var fovRad = (camera.fov * Math.PI) / 180;
    var distance = (radius / Math.tan(fovRad / 2)) * 0.75;
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);

    var environmentPromise = loadEnvironment(renderer).then(function (envMap) {
      scene.environment = envMap;
    });

    environmentPromise.then(function () {
      renderer.render(scene, camera);
      if (options.onReady) options.onReady();
    });
    return { el: wrapper, renderer: renderer, scene: scene, camera: camera };
  }

  window.EmjiveModelViewer = buildThreeViewer;
  window.EmjiveModelViewer.buildMaterialSwatch = buildMaterialSwatch;
})();
