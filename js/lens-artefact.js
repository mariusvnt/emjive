/* ==========================================================================
   J&MV — the lab-lens

   Owns all three fixed layers of the lens (see css/style.css's lens block):
   the glass render itself, the magnified view inside it, and the label bar
   hanging off its right edge. Two independent inputs drive them:

     the hero's own geometry                 -> the glass fades in once the
                                                hero is behind us, and back
                                                out on scrolling up into it.
     window.EmjiveFocus (js/product-focus.js) -> which product is centered;
                                                drives the viewer and label.

   The magnified view is a duplicate of the product stack, drawn at
   --lens-mag about the screen's centre and clipped to the glass: one still
   per product, plus ONE live 3D viewer, positioned by the very same maths.

   Two rules shape everything below.

   1. The viewer is drawn where its PRODUCT is, not where the glass is. A
      model the visitor has set spinning therefore travels out of the glass
      under its own steam, still rendering and still spinning. An earlier
      design pinned it to the glass and swapped it for a still on the way
      out — but a still cannot roll, so any release inertia died the instant
      the swap happened.

   2. A swap between the live model and its still is only ever made when the
      two are indistinguishable: same product, same default pose, same size.
      That's why a departing model is first eased back to its default pose
      (returnToDefaultPose) and only handed over once it gets there, and why
      an arriving one is only shown once it has painted. Nothing is ever
      substituted while the difference could be seen.

   There is exactly ONE viewer for the life of the page, reused across
   products via handle.loadProduct(). It used to be built and disposed per
   product, which cost a new WebGL context plus a full HDR decode and PMREM
   generation every scroll step — ~180ms of blocked main thread, landing as
   a dropped frame mid-animation. Reusing the renderer keeps its environment
   map, leaving only the glTF load; and that load is deferred until the
   strip has stopped, so nothing heavy runs while anything is moving.
   ========================================================================== */

(function () {
  "use strict";

  var glass = document.getElementById("lensArtefact");
  var viewerHost = document.getElementById("lensViewer");
  var magHost = document.getElementById("lensMag");
  var labelEl = document.getElementById("lensLabel");
  var labelName = document.getElementById("lensLabelName");
  var labelType = document.getElementById("lensLabelType");

  if (!glass) return;

  /* ---- the glass ---------------------------------------------------------- */

  // Measured off the hero slot directly rather than subscribed to
  // window.EmjiveHero. EmjiveHero publishes how far past the hero's own
  // trigger point the page has scrolled, but that trigger is calibrated to
  // something else entirely — the frontier band clearing the fixed header,
  // which happens while the whole revealed x-ray hand is still filling the
  // screen. Keying the lens to it made the glass appear over the hero
  // artwork. The hero's bottom edge crossing the middle of the screen is
  // the real "the hero is behind us now" moment, and being a plain
  // measurement it's symmetric for free: scrolling back up toward the x-ray
  // hand hides the glass again at exactly the same point.
  var heroSlot = document.getElementById("seriesHero");
  var glassTicking = false;
  var glassWasPast = false;

  function syncGlass() {
    glassTicking = false;
    // No hero on this page (or the bundle failed to load, leaving the slot
    // empty): nothing to stay clear of, so the lens is simply available.
    var past = !heroSlot || heroSlot.getBoundingClientRect().bottom <= window.innerHeight / 2;
    glass.classList.toggle("is-visible", past);
    // The magnified view appears and disappears WITH the glass, never per
    // product — it isn't a reveal, it's the magnification itself.
    if (viewerHost) viewerHost.classList.toggle("is-visible", past);

    // Belt and suspenders: js/product-focus.js has its own, separate
    // boundary for "have we left the strip" (card-geometry-based, since it
    // has no notion of the hero at all), which should agree with this one
    // but — observed on phones, where the narrow-screen CSS scales the
    // whole lens system by a different factor than the hero's own layout —
    // can occasionally disagree by a frame or two, leaving the label/viewer
    // shown a beat into the hero. This measurement is the simpler and more
    // direct one for "are we clear of the hero", so on the transition back
    // into it, it forces the label/viewer closed regardless of what focus
    // state product-focus.js currently thinks it's in.
    if (glassWasPast && !past) leaveGrid();
    glassWasPast = past;

    if (past) layoutLens();
  }

  function requestGlassSync() {
    if (glassTicking) return;
    glassTicking = true;
    requestAnimationFrame(syncGlass);
  }

  window.addEventListener("scroll", requestGlassSync, { passive: true });
  window.addEventListener("resize", requestGlassSync);
  // The hero arrives at runtime and changes the slot's height when it does,
  // so the first correct measurement can only happen after that.
  if (window.EmjiveSeries && window.EmjiveSeries.ready) {
    window.EmjiveSeries.ready.then(requestGlassSync, requestGlassSync);
  }
  syncGlass();

  /* ---- the magnified view + label ---------------------------------------- */

  if (!viewerHost || !magHost || !labelEl || !window.EmjiveFocus) return;

  // Read from CSS rather than duplicated here: --lens-mag also sizes the
  // stills' boxes and the live viewer's box, and the three only agree —
  // which is the whole basis of the invisible handoff — if they're one
  // number.
  var MAGNIFICATION = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--lens-mag")
  ) || 1.25;
  // The label's two phases, which must match the durations css/style.css
  // gives .lens-label's transform and .lens-label__text's opacity.
  var LABEL_TEXT_MS = 150;
  var LABEL_BAR_MS = 350;
  // How long a departing model gets to ease back to its default pose —
  // after which it is indistinguishable from its still and can be handed
  // over silently. It has to arrive there well before it leaves the glass
  // (measured at ~600ms into an 850ms scroll), because from the moment the
  // product starts moving, part of its plain un-magnified icon is emerging
  // from behind the disc — and that icon is always the default pose.
  // Anything slower and the two disagree in plain sight; anything much
  // faster reads as a snap rather than a continuation of the motion.
  var DEPART_RESET_MS = 450;
  var DRAG_THRESHOLD = 6;

  var magItems = [];      // [{ img, figure, product }] — one per visible product
  var viewer = null;      // the page's one and only viewer handle
  var owner = null;       // the entry the viewer is currently drawn at
  var shown = false;      // is the viewer visible (and so covering its still)
  var viewerHref = "#";   // where a click on the live model navigates
  var pending = null;     // product waiting to be loaded once the strip stops
  var loadToken = 0;      // guards against a stale load resolving late
  var departTimer = null;
  var labelTimer = null;

  /* ---- geometry ----------------------------------------------------------- */

  // The lens mapping, in one line: a point at viewport offset d from the
  // screen's centre appears at MAGNIFICATION * d from the glass's centre.
  // Applied to a real, measured icon box, in the glass's own coordinates.
  function magnifiedBox(figure, disc) {
    var box = figure.getBoundingClientRect();
    var w = box.width * MAGNIFICATION;
    var h = box.height * MAGNIFICATION;
    var x = disc / 2 + (box.left + box.width / 2 - window.innerWidth / 2) * MAGNIFICATION;
    var y = disc / 2 + (box.top + box.height / 2 - window.innerHeight / 2) * MAGNIFICATION;
    return { w: w, h: h, left: x - w / 2, top: y - h / 2, centre: y };
  }

  function place(el, b) {
    var s = el.style;
    s.width = b.w + "px";
    s.height = b.h + "px";
    s.left = b.left + "px";
    s.top = b.top + "px";
  }

  // Runs on every scroll frame (via syncGlass) — this is what makes the
  // glass magnify continuously as products travel through it, rather than
  // only once one has settled.
  function layoutLens() {
    var disc = viewerHost.offsetWidth;
    if (!disc) return;

    for (var i = 0; i < magItems.length; i++) {
      var item = magItems[i];
      var b = magnifiedBox(item.figure, disc);
      // Nowhere near the glass — skip the style writes rather than laying
      // out every product of a long series on every frame.
      if (b.centre + b.h / 2 < 0 || b.centre - b.h / 2 > disc) {
        if (item.img.style.display !== "none") item.img.style.display = "none";
        continue;
      }
      item.img.style.display = "";
      place(item.img, b);
    }

    // Drawn at its product's position, not the glass's — see rule 1 above.
    if (viewer && owner) place(viewer.el, magnifiedBox(owner.figure, disc));

    syncStills();
  }

  // A still is hidden only while the live viewer is actually covering it —
  // otherwise the product would be drawn twice, once rendered and once as
  // its capture.
  function syncStills() {
    for (var i = 0; i < magItems.length; i++) magItems[i].img.style.visibility = "";
    if (shown && owner) owner.img.style.visibility = "hidden";
  }

  /* ---- the stack ---------------------------------------------------------- */

  function buildMagnifiedStack() {
    // The entries these referenced are gone; the viewer itself survives.
    hideViewer();
    owner = null;
    pending = null;
    loadToken++;

    magItems = [];
    magHost.innerHTML = "";
    var entries = window.EmjiveFocus.entries();
    for (var i = 0; i < entries.length; i++) {
      var figure = entries[i].el.querySelector(".product-card__figure");
      var source = figure && figure.querySelector("img");
      if (!source) continue;
      var img = document.createElement("img");
      // The card's own already-loaded src, so the duplicate stack costs no
      // extra requests.
      img.src = source.src;
      img.alt = "";
      magHost.appendChild(img);
      magItems.push({ img: img, figure: figure, product: entries[i].product });
    }
    layoutLens();
  }

  function itemFor(product) {
    for (var i = 0; i < magItems.length; i++) {
      if (magItems[i].product === product) return magItems[i];
    }
    return null;
  }

  /* ---- the viewer --------------------------------------------------------- */

  function showViewer() {
    if (!viewer || !owner) return;
    shown = true;
    viewer.el.style.visibility = "visible";
    viewer.el.style.pointerEvents = "auto";
    layoutLens();
  }

  function hideViewer() {
    shown = false;
    if (viewer) {
      viewer.el.style.visibility = "hidden";
      viewer.el.style.pointerEvents = "none";
    }
    syncStills();
  }

  // A real click (near-zero pointer movement between down and up) opens the
  // product; a drag past DRAG_THRESHOLD is left alone, since that's
  // TrackballControls rotating the model. Distance-based rather than a plain
  // "click" listener because a click still fires at the end of a rotate-drag
  // as long as the pointer lifts over the same element, which would
  // otherwise navigate away every time someone just wanted to spin the
  // model. Reads viewerHref live rather than closing over one product —
  // the viewer outlives every product it shows.
  function wireModelClickNavigation(el) {
    var startX = 0;
    var startY = 0;
    el.addEventListener("pointerdown", function (e) {
      startX = e.clientX;
      startY = e.clientY;
    });
    el.addEventListener("pointerup", function (e) {
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) <= DRAG_THRESHOLD) window.location.href = viewerHref;
    });
  }

  // Deliberately called only once the strip has stopped. The still on screen
  // is identical to what the live render will be, so there is nothing to
  // gain by racing — and everything to lose, since a glTF load is the one
  // remaining piece of blocking work and running it mid-scroll is what put a
  // dropped frame in the middle of the animation.
  function loadPending() {
    var product = pending;
    if (!product) return;
    var entry = itemFor(product);
    if (!entry) return;
    if (!product.assets || !product.assets.model || !window.EmjiveModelViewer) return;
    pending = null;

    var token = ++loadToken;
    viewerHref = window.EmjiveSeries
      ? window.EmjiveSeries.productHref(product, window.EmjiveSeries.slug)
      : "#";

    if (viewer) {
      owner = entry;
      layoutLens(); // position it, still hidden, before it paints
      viewer.loadProduct(product, product["default-metal"]).then(function (ok) {
        if (!ok || token !== loadToken) return;
        showViewer();
      }, function () { /* load failed — the still simply stays */ });
      return;
    }

    // First product of the session: the only time a renderer, a WebGL
    // context and a PMREM'd environment map get built. Every later product
    // reuses all three through loadProduct() above.
    var built = window.EmjiveModelViewer(product, product["default-metal"], {
      hdri: window.EmjiveSeries && window.EmjiveSeries.hdriPath(window.EmjiveSeries.slug),
      onReady: function () {
        if (token !== loadToken) return;
        // No setCameraOrbit(): the product's own default orbit is exactly
        // the pose fallback-img was captured at, and the magnification comes
        // from rendering that pose into a larger box (see the CSS).
        // Overriding the camera here is what would break the match.
        showViewer();
      }
    });
    // Returns null rather than throwing when the browser won't grant a
    // context; the stills simply stay, for every product.
    if (!built) return;

    viewer = built;
    owner = entry;
    viewer.el.style.visibility = "hidden";
    viewer.el.style.pointerEvents = "none";
    viewerHost.appendChild(viewer.el);
    wireModelClickNavigation(viewer.el);
    layoutLens();
  }

  /* ---- the label ---------------------------------------------------------- */

  function setLabelContent(product) {
    labelEl.href = window.EmjiveSeries
      ? window.EmjiveSeries.productHref(product, window.EmjiveSeries.slug)
      : "#";
    labelName.textContent = product.name || "";
    labelType.textContent = product.category ? "." + product.category.toLowerCase() : "";
  }

  // Phase 1 of a change: drop the text, then send the bar off the right of
  // the screen, then hand over to `then` (if there's a next product). Runs as
  // one timer chain rather than CSS transition-delays so a fast scroll
  // through several products can cancel it cleanly at any point.
  function retractLabel(then) {
    if (labelTimer) clearTimeout(labelTimer);

    // Already parked off-screen — nothing to retract, so don't make the
    // first product of the session wait out an animation that isn't running.
    if (!labelEl.classList.contains("is-in")) {
      if (then) then();
      return;
    }

    labelEl.classList.remove("is-labelled");
    labelTimer = setTimeout(function () {
      labelEl.classList.remove("is-in");
      labelTimer = then ? setTimeout(then, LABEL_BAR_MS) : null;
    }, LABEL_TEXT_MS);
  }

  // Phase 2: content is set while the bar is still off-screen, so nothing is
  // ever seen changing in place; then the bar slides back in and only
  // afterwards does the text fade up on it.
  function presentLabel(product) {
    setLabelContent(product);
    labelEl.classList.add("is-in");
    if (labelTimer) clearTimeout(labelTimer);
    labelTimer = setTimeout(function () {
      labelEl.classList.add("is-labelled");
    }, LABEL_BAR_MS);
  }

  /* ---- wiring ------------------------------------------------------------- */

  // Shared by the two ways "no product is focused any more" can happen:
  // js/product-focus.js resolving there itself (its own boundary, normally
  // in agreement with the glass's), and syncGlass()'s belt-and-suspenders
  // override above (the glass's own boundary, taken as authoritative when
  // the two disagree). Same departure treatment either way — the outgoing
  // model eases home rather than being cut, per the rule at the top of this
  // file — this just skips straight to it without a next product queued.
  function leaveGrid() {
    if (departTimer) clearTimeout(departTimer);
    if (shown && viewer) {
      if (viewer.returnToDefaultPose) viewer.returnToDefaultPose(DEPART_RESET_MS);
      departTimer = setTimeout(hideViewer, DEPART_RESET_MS);
    }
    pending = null;
    retractLabel();
  }

  window.EmjiveFocus.onChange(function (product) {
    if (!product) {
      leaveGrid();
      return;
    }

    if (departTimer) clearTimeout(departTimer);
    if (shown && viewer) {
      // Send the outgoing model home. It stays visible and rendering the
      // whole way — travelling out of the glass with its product, spinning
      // down into its default pose — and is only handed back to its still
      // once it gets there, at which point the two are identical and the
      // handover cannot be seen. Hiding it any earlier is the abrupt stop
      // this whole arrangement exists to avoid.
      if (viewer.returnToDefaultPose) viewer.returnToDefaultPose(DEPART_RESET_MS);
      departTimer = setTimeout(hideViewer, DEPART_RESET_MS);
    }

    pending = product;
    retractLabel(function () { presentLabel(product); });
  });

  window.EmjiveFocus.onSettled(function () {
    loadPending();
  });

  // js/product-focus.js listens for this too, and — being loaded first (see
  // index.html) — has already refreshed its own entries by the time this
  // runs, so EmjiveFocus.entries() is current here.
  window.addEventListener("emjive:grid-changed", buildMagnifiedStack);
  // And the warm-cache case product-focus.js guards against: if the grid
  // rendered before these scripts ran, the event is already gone, but its
  // entries are there to be read.
  buildMagnifiedStack();
})();
